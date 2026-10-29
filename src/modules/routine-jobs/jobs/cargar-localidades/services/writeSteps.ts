import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import { buildSequenceRepairSql, runTransaction, type TransactionMessages } from "../../shared/transaction";
import { applyStepLabel, classifyStepLabel, LOCALITY_STEP } from "../domain/plannedSteps";
import { toSourceReport, toTargetApplyOutcome, toTargetClassification } from "../domain/reportMapping";
import { buildSourceReportSql, buildUnmatchedPadronsSql } from "../domain/sourceSql";
import { buildTargetReport, expectedUpdateCount, targetLabelOf } from "../domain/targetReport";
import { buildApplySql, buildClassifySql } from "../domain/targetSql";
import type {
  CargarLocalidadesParams,
  LocalityLayouts,
  SourceReport,
  TargetApplyOutcome,
  TargetClassification,
  LocalityTargetLayout,
  TargetReport,
} from "../types";

export interface WriteOutcome {
  source: SourceReport;
  targets: TargetReport[];
  targetsModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
}

interface TransactionBody {
  source: SourceReport;
  targets: TargetReport[];
}

const LOCALITY_TRANSACTION: TransactionMessages = {
  jobLabel: "carga de localidades",
  untouched: "Las tablas de localidades no fueron modificadas.",
  unverified: "No se pudo revertir la transacción: verifique las tablas de localidades.",
};

async function readSourceReport(session: RunSession, layouts: LocalityLayouts): Promise<SourceReport> {
  const result = await session.query(buildSourceReportSql(layouts));
  // One pg client: report queries must not overlap.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const unmatched = await session.query(buildUnmatchedPadronsSql(layouts));
  return toSourceReport(result.rows[0] ?? {}, unmatched.rows);
}

async function readClassification(
  session: RunSession,
  layouts: LocalityLayouts,
  target: LocalityTargetLayout,
  params: CargarLocalidadesParams
): Promise<TargetClassification> {
  const result = await session.query(buildClassifySql(layouts, target, params.options));
  return toTargetClassification(result.rows[0] ?? {});
}

async function readApply(
  session: RunSession,
  layouts: LocalityLayouts,
  target: LocalityTargetLayout,
  params: CargarLocalidadesParams
): Promise<TargetApplyOutcome> {
  const result = await session.query(buildApplySql(layouts, target, params.options));
  return toTargetApplyOutcome(result.rows[0] ?? {});
}

function assertCountsMatch(
  label: string,
  classification: TargetClassification,
  apply: TargetApplyOutcome,
  updateGeometries: boolean
): void {
  if (apply.inserted !== classification.counts.inserted) {
    throw new Error(
      `Las localidades insertadas (${apply.inserted}) no coinciden con las nuevas del análisis (${classification.counts.inserted}) en ${label}.`
    );
  }
  const expectedUpdated = expectedUpdateCount(classification, updateGeometries);
  if (apply.updated !== expectedUpdated) {
    throw new Error(
      `Las geometrías actualizadas (${apply.updated}) no coinciden con las esperadas (${expectedUpdated}) en ${label}.`
    );
  }
}

async function classifyTargets(
  session: RunSession,
  layouts: LocalityLayouts,
  params: CargarLocalidadesParams,
  timer: StepTimer
): Promise<TargetClassification[]> {
  const classifications: TargetClassification[] = [];
  for (const target of layouts.targets) {
    // Ordered reads on one transactional connection: one classification per target, in plan order.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    const classification = await timer.run(classifyStepLabel(targetLabelOf(target)), () =>
      readClassification(session, layouts, target, params)
    );
    classifications.push(classification);
  }
  return classifications;
}

async function repairSequences(session: RunSession, layouts: LocalityLayouts): Promise<void> {
  for (const target of layouts.targets) {
    await session.query(buildSequenceRepairSql(target));
  }
}

async function applyTargets(
  session: RunSession,
  layouts: LocalityLayouts,
  params: CargarLocalidadesParams,
  classifications: readonly TargetClassification[],
  timer: StepTimer
): Promise<TargetApplyOutcome[]> {
  const applies: TargetApplyOutcome[] = [];
  for (const [index, target] of layouts.targets.entries()) {
    const label = targetLabelOf(target);
    // Ordered writes on one transactional connection: each apply is checked before the next target.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    const apply = await timer.run(applyStepLabel(label), () => readApply(session, layouts, target, params));
    assertCountsMatch(label, classifications[index], apply, params.options.updateGeometries);
    applies.push(apply);
  }
  return applies;
}

async function analyzeTargets(session: RunSession, layouts: LocalityLayouts): Promise<void> {
  for (const target of layouts.targets) {
    await session.query(buildAnalyzeStatement(target.schema, target.table));
  }
}

function buildTargetReports(
  layouts: LocalityLayouts,
  classifications: readonly TargetClassification[],
  applies: readonly TargetApplyOutcome[],
  params: CargarLocalidadesParams
): TargetReport[] {
  return layouts.targets.map((target, index) =>
    buildTargetReport({
      target,
      classification: classifications[index],
      apply: applies[index],
      updateGeometries: params.options.updateGeometries,
    })
  );
}

async function runTransactionBody(
  session: RunSession,
  params: CargarLocalidadesParams,
  layouts: LocalityLayouts,
  timer: StepTimer
): Promise<TransactionBody> {
  const source = await timer.run(LOCALITY_STEP.RESOLVE, () => readSourceReport(session, layouts));
  // Ordered reads on the transaction's snapshot: the analysis follows the source report step.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const classifications = await classifyTargets(session, layouts, params, timer);
  // Ordered: sequences are repaired after the analysis and before any insert of the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  await timer.run(LOCALITY_STEP.SEQUENCES, () => repairSequences(session, layouts));
  const applies = await applyTargets(session, layouts, params, classifications, timer);
  await timer.run(LOCALITY_STEP.ANALYZE, () => analyzeTargets(session, layouts));
  const targets = await timer.run(LOCALITY_STEP.REPORT, () =>
    Promise.resolve(buildTargetReports(layouts, classifications, applies, params))
  );
  return { source, targets };
}

export async function runWriteTransaction(
  session: RunSession,
  params: CargarLocalidadesParams,
  layouts: LocalityLayouts,
  timer: StepTimer
): Promise<WriteOutcome> {
  const outcome = await runTransaction(
    session,
    {
      dryRun: params.dryRun,
      secret: params.config.password,
      timer,
      steps: { commit: LOCALITY_STEP.COMMIT, rollback: LOCALITY_STEP.ROLLBACK },
      messages: LOCALITY_TRANSACTION,
    },
    () => runTransactionBody(session, params, layouts, timer)
  );
  return { ...outcome.body, targetsModified: outcome.targetsModified, outcomeUnknown: outcome.outcomeUnknown, commitError: outcome.commitError };
}
