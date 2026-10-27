import { buildAnalyzeStatement, buildRepairSequenceStatement } from "@/core/services/sqlStatements";
import { sentence } from "../../cargar-padrones/domain/warnings";
import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import { parseSequenceName } from "../../actualizar-padron/domain/sequenceReference";
import { applyStepLabel, classifyStepLabel, LOCALITY_STEP } from "../domain/plannedSteps";
import { toSourceReport, toTargetApplyOutcome, toTargetClassification } from "../domain/reportMapping";
import { buildSourceReportSql } from "../domain/sourceSql";
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

const BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ";
const COMMIT_SQL = "COMMIT";
const ROLLBACK_SQL = "ROLLBACK";
const REDACTED = "***";

const errorMessageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const scrubSecret = (message: string, secret: string | undefined): string =>
  secret ? message.split(secret).join(REDACTED) : message;

async function rollbackQuietly(session: RunSession): Promise<boolean> {
  try {
    await session.query(ROLLBACK_SQL);
    return true;
  } catch {
    return false;
  }
}

function rollbackFailure(error: unknown, rolledBack: boolean, secret: string | undefined): Error {
  const reason = sentence(scrubSecret(errorMessageOf(error), secret));
  const outcome = rolledBack
    ? "Las tablas de localidades no fueron modificadas."
    : "No se pudo revertir la transacción: verifique las tablas de localidades.";
  return new Error(`No se pudo completar la carga de localidades: ${reason} ${outcome}`);
}

async function commitTransaction(session: RunSession, secret: string | undefined): Promise<string | undefined> {
  try {
    await session.query(COMMIT_SQL);
    return undefined;
  } catch (error: unknown) {
    return scrubSecret(errorMessageOf(error), secret);
  }
}

async function readSourceReport(session: RunSession, layouts: LocalityLayouts): Promise<SourceReport> {
  const result = await session.query(buildSourceReportSql(layouts));
  return toSourceReport(result.rows[0] ?? {});
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

function buildSequenceRepairSql(target: LocalityTargetLayout): string {
  const sequence = parseSequenceName(target.idSequence);
  if (sequence === undefined) {
    throw new Error(`La columna id de ${targetLabelOf(target)} no tiene secuencia: no se pueden asignar ids.`);
  }
  return buildRepairSequenceStatement(
    sequence.schema ?? target.schema,
    sequence.name,
    target.schema,
    target.table,
    [target.idColumn]
  );
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
  const secret = params.config.password;
  await session.query(BEGIN_SQL);
  let body: TransactionBody;
  try {
    body = await runTransactionBody(session, params, layouts, timer);
  } catch (error: unknown) {
    const rolledBack = await rollbackQuietly(session);
    throw rollbackFailure(error, rolledBack, secret);
  }
  if (params.dryRun) {
    await timer.run(LOCALITY_STEP.ROLLBACK, () => session.query(ROLLBACK_SQL));
    return { ...body, targetsModified: false, outcomeUnknown: false };
  }
  const commitError = await timer.run(LOCALITY_STEP.COMMIT, () => commitTransaction(session, secret));
  return {
    ...body,
    targetsModified: commitError === undefined,
    outcomeUnknown: commitError !== undefined,
    commitError,
  };
}
