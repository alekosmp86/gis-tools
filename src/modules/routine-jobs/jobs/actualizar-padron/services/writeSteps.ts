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
import { nullableNumber, type Row } from "../../shared/rowMapping";
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
import { buildCaptureAddressMasterSql, buildCreateRevertTableSql, buildMaxAddressMasterIdSql } from "../domain/revertCapture";
import type { RevertAddressMaster } from "./revertScript";
import type {
  ActualizarAddressMasterReport,
  ActualizarPadronBackup,
  ActualizarPadronOptions,
  ActualizarTargetReport,
  PadronApplyOutcome,
  PadronClassification,
  PadronLayouts,
  ActualizarPadronParams,
} from "../types";
import { guardRevertStep, writeRevertBackup, type RevertBackupRequest } from "./revertBackup";

export interface PadronWriteOutcome {
  source: ReportView;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
  backup?: ActualizarPadronBackup;
  targetModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
}

interface PadronTransactionBody {
  source: ReportView;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
  backup?: ActualizarPadronBackup;
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

/** A real run first creates the revert table in the transaction, then captures the old values inside the same apply statement. */
async function applyPadronChanges(
  session: RunSession,
  params: ActualizarPadronParams,
  layouts: PadronLayouts
): Promise<PadronApplyOutcome> {
  const captureRevert = !params.dryRun;
  if (captureRevert) await guardRevertStep(() => session.query(buildCreateRevertTableSql()));
  const result = await session.query(buildPadronApplySql(layouts, params.options, { captureRevert }));
  return toPadronApplyOutcome(result.rows[0] ?? {});
}

/** A missing or non-numeric max id fails the backup (and so the run); it never falls back to 0, which would widen the address master rollback. */
function maxAddressMasterIdOf(row: Row | undefined): number {
  const maxId = nullableNumber(row?.max_id);
  if (maxId === null) throw new Error("No se pudo leer el máximo id de la tabla de direcciones maestras.");
  return maxId;
}

/** The unlinked destination rows are captured before the link pass, which links them. */
async function captureAddressMasterRevert(session: RunSession, layouts: PadronLayouts): Promise<RevertAddressMaster | undefined> {
  const { addressMaster } = layouts;
  if (addressMaster === undefined) return undefined;
  return guardRevertStep(async () => {
    await session.query(buildCaptureAddressMasterSql(layouts.target));
    const result = await session.query(buildMaxAddressMasterIdSql(addressMaster));
    return { layout: addressMaster, maxIdBefore: maxAddressMasterIdOf(result.rows[0]) };
  });
}

const revertRequestOf = (
  layouts: PadronLayouts,
  apply: PadronApplyOutcome,
  addressMaster: RevertAddressMaster | undefined
): RevertBackupRequest => ({
  target: layouts.target,
  addressMaster,
  expected: { inserted: apply.inserted, updated: apply.updated, paired: apply.paired },
});

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
  const apply = await timer.run(STEP.APPLY, () => applyPadronChanges(session, params, layouts));
  assertCountsMatch(layouts.target, classification, apply);
  const revertAddressMaster = params.dryRun ? undefined : await captureAddressMasterRevert(session, layouts);
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
  const backup = params.dryRun
    ? undefined
    : await timer.run(STEP.BACKUP, () =>
        writeRevertBackup(session, revertRequestOf(layouts, apply, revertAddressMaster))
      );
  return { source, target, addressMaster, backup };
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
