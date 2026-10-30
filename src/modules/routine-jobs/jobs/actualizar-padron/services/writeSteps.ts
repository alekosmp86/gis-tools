import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import { runAddressMasterLinkPass } from "../../shared/addressMasterLinkPass";
import { PADRON_SUBJECT_SPEC } from "../../shared/addressMasterLinkSpec";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import {
  buildSequenceRepairSql,
  runTransaction,
  type TransactionMessages,
  type TransactionOutcome,
} from "../../shared/transaction";
import { ADDRESS_MASTER_PASS_STEPS, STEP } from "../domain/plannedSteps";
import {
  buildAddressMasterReport,
  buildPadronTargetReport,
  toPadronApplyOutcome,
  toPadronClassification,
  toReportView,
  type ReportView,
} from "../domain/reportMapping";
import { buildReportSql } from "../domain/reportSql";
import { buildPadronApplySql, buildPadronClassifySql } from "../domain/targetSql";
import type {
  ActualizarAddressMasterReport,
  ActualizarPadronOptions,
  ActualizarTargetReport,
  PadronApplyOutcome,
  PadronClassification,
  PadronLayouts,
  ActualizarPadronParams,
} from "../types";

export interface PadronWriteOutcome {
  source: ReportView;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
  targetModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
}

interface PadronTransactionBody {
  source: ReportView;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
}

const PADRON_TRANSACTION: TransactionMessages = {
  jobLabel: "actualización de padrones",
  untouched: "Las tablas de destino no fueron modificadas.",
  unverified: "No se pudo revertir la transacción: verifique las tablas de destino.",
};

async function readSourceReport(session: RunSession, layouts: PadronLayouts): Promise<ReportView> {
  const result = await session.query(buildReportSql(layouts));
  return toReportView(result.rows[0]);
}

async function readClassification(
  session: RunSession,
  layouts: PadronLayouts,
  options: ActualizarPadronOptions
): Promise<PadronClassification> {
  const result = await session.query(buildPadronClassifySql(layouts, options));
  return toPadronClassification(result.rows[0] ?? {});
}

async function readApply(session: RunSession, layouts: PadronLayouts, options: ActualizarPadronOptions): Promise<PadronApplyOutcome> {
  const result = await session.query(buildPadronApplySql(layouts, options));
  return toPadronApplyOutcome(result.rows[0] ?? {});
}

function assertCountsMatch(target: WritableTargetLayout, classification: PadronClassification, apply: PadronApplyOutcome): void {
  const label = `${target.schema}.${target.table}`;
  if (apply.inserted !== classification.counts.inserted) {
    throw new Error(
      `Los padrones insertados (${apply.inserted}) no coinciden con los nuevos del análisis (${classification.counts.inserted}) en ${label}.`
    );
  }
  if (apply.updated !== classification.counts.updates) {
    throw new Error(
      `Las geometrías actualizadas (${apply.updated}) no coinciden con las esperadas (${classification.counts.updates}) en ${label}.`
    );
  }
  if (apply.paired !== classification.counts.pairs) {
    throw new Error(
      `Las claves actualizadas (${apply.paired}) no coinciden con los pares aplicables del análisis (${classification.counts.pairs}) en ${label}.`
    );
  }
}

/** Links the target's padrones without a dirección maestra; it sees the rows the upsert inserted, in the same transaction. */
async function runAddressMasterStage(
  session: RunSession,
  layouts: PadronLayouts,
  timer: StepTimer
): Promise<ActualizarAddressMasterReport | undefined> {
  const { addressMaster } = layouts;
  if (addressMaster === undefined) return undefined;
  // Ordered: the address master sequence is repaired before its inserts of the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  await timer.run(STEP.ADDRESS_SEQUENCES, () => session.query(buildSequenceRepairSql(addressMaster)));
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const pass = await runAddressMasterLinkPass(
    session,
    { subject: layouts.target, addressMaster },
    PADRON_SUBJECT_SPEC,
    ADDRESS_MASTER_PASS_STEPS,
    timer
  );
  return buildAddressMasterReport(addressMaster, pass);
}

async function analyzeTargets(session: RunSession, layouts: PadronLayouts): Promise<void> {
  await session.query(buildAnalyzeStatement(layouts.target.schema, layouts.target.table));
  if (layouts.addressMaster !== undefined) {
    await session.query(buildAnalyzeStatement(layouts.addressMaster.schema, layouts.addressMaster.table));
  }
}

async function runTransactionBody(
  session: RunSession,
  params: ActualizarPadronParams,
  layouts: PadronLayouts,
  timer: StepTimer
): Promise<PadronTransactionBody> {
  const source = await timer.run(STEP.RESOLVE, () => readSourceReport(session, layouts));
  // Ordered reads on the transaction's snapshot: the analysis follows the source report step.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const classification = await timer.run(STEP.CLASSIFY, () => readClassification(session, layouts, params.options));
  // Ordered: the sequence is repaired after the analysis and before the insert of the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  await timer.run(STEP.SEQUENCES, () => session.query(buildSequenceRepairSql(layouts.target)));
  const apply = await timer.run(STEP.APPLY, () => readApply(session, layouts, params.options));
  assertCountsMatch(layouts.target, classification, apply);
  const addressMaster = await runAddressMasterStage(session, layouts, timer);
  await timer.run(STEP.ANALYZE, () => analyzeTargets(session, layouts));
  const target = await timer.run(STEP.REPORT, () =>
    Promise.resolve(
      buildPadronTargetReport({
        target: layouts.target,
        classification,
        apply,
        updateGeometries: params.options.updateGeometries,
      })
    )
  );
  return { source, target, addressMaster };
}

export async function runPadronWriteTransaction(
  session: RunSession,
  params: ActualizarPadronParams,
  layouts: PadronLayouts,
  timer: StepTimer
): Promise<PadronWriteOutcome> {
  const outcome: TransactionOutcome<PadronTransactionBody> = await runTransaction(
    session,
    {
      dryRun: params.dryRun,
      secret: params.config.password,
      timer,
      steps: { commit: STEP.COMMIT, rollback: STEP.ROLLBACK },
      messages: PADRON_TRANSACTION,
    },
    () => runTransactionBody(session, params, layouts, timer)
  );
  return {
    ...outcome.body,
    targetModified: outcome.targetsModified,
    outcomeUnknown: outcome.outcomeUnknown,
    commitError: outcome.commitError,
  };
}
