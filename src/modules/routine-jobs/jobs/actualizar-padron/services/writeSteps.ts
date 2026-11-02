import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import {
  planAddressMasterPass,
  readAddressMasterClassification,
  runAddressMasterLinkPass,
} from "../../shared/addressMasterLinkPass";
import { buildAddressMasterReport } from "../../shared/addressMasterLinkReport";
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
import { assertPlanStillValid, snapshotOf } from "../domain/plan";
import {
  buildPadronTargetReport,
  plannedApplyOf,
  toPadronApplyOutcome,
  toPadronClassification,
  toReportView,
  type ReportView,
} from "../domain/reportMapping";
import { buildReportSql } from "../domain/reportSql";
import { NO_REFERENCE_TABLES } from "../domain/replacementSql";
import { buildPadronApplySql, buildPadronClassifySql } from "../domain/targetSql";
import { buildCaptureAddressMasterSql, buildCreateRevertTableSql, buildMaxAddressMasterIdSql } from "../domain/revertCapture";
import type { RevertAddressMaster } from "./revertScript";
import type {
  ActualizarAddressMasterReport,
  ActualizarPadronBackup,
  ActualizarPadronOptions,
  ActualizarPlanRecord,
  ActualizarTargetReport,
  PadronApplyOutcome,
  PadronClassification,
  PadronGeometryChange,
  PadronLayouts,
  ActualizarPadronParams,
  PlanSnapshot,
} from "../types";
import { guardRevertStep, writeRevertBackup, type RevertBackupRequest } from "./revertBackup";
import { readReferenceTables } from "./referenceTables";

export interface PadronWriteOutcome {
  source: ReportView;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
  backup?: ActualizarPadronBackup;
  snapshot: PlanSnapshot;
  pendingGeometryChanges: PadronGeometryChange[];
  targetModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
}

interface PadronTransactionBody {
  source: ReportView;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
  backup?: ActualizarPadronBackup;
  snapshot: PlanSnapshot;
  pendingGeometryChanges: PadronGeometryChange[];
}

const PADRON_TRANSACTION: TransactionMessages = {
  jobLabel: "actualización de padrones",
  untouched: "Las tablas de destino no fueron modificadas.",
  unverified: "No se pudo revertir la transacción: verifique las tablas de destino.",
};

const TRANSACTION_STEPS = { commit: STEP.COMMIT, rollback: STEP.ROLLBACK };

async function readSourceReport(session: RunSession, layouts: PadronLayouts): Promise<ReportView> {
  const result = await session.query(buildReportSql(layouts));
  return toReportView(result.rows[0]);
}

async function readAnalysisClassification(
  session: RunSession,
  layouts: PadronLayouts,
  options: ActualizarPadronOptions
): Promise<PadronClassification> {
  const references = await readReferenceTables(session, layouts.target.schema);
  return readClassificationSql(session, buildPadronClassifySql(layouts, options, references));
}

/** The persist classify reads the counts, fingerprint and digest only: no replacement block and no reference probe. */
function readPersistClassification(
  session: RunSession,
  layouts: PadronLayouts,
  options: ActualizarPadronOptions
): Promise<PadronClassification> {
  return readClassificationSql(session, buildPadronClassifySql(layouts, options, NO_REFERENCE_TABLES, { report: false }));
}

async function readClassificationSql(session: RunSession, sql: string): Promise<PadronClassification> {
  const result = await session.query(sql);
  return toPadronClassification(result.rows[0] ?? {});
}

/** A real run first creates the revert table in the transaction, then captures the old values inside the same apply statement. */
async function applyPadronChanges(
  session: RunSession,
  layouts: PadronLayouts,
  options: ActualizarPadronOptions
): Promise<PadronApplyOutcome> {
  await guardRevertStep(() => session.query(buildCreateRevertTableSql()));
  const result = await session.query(buildPadronApplySql(layouts, options, { captureRevert: true }));
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

/** The analysis only classifies the links: the rows the padron insert will add are not in the destination yet, so they are not counted. */
async function runAddressMasterPlan(
  session: RunSession,
  layouts: PadronLayouts,
  timer: StepTimer
): Promise<ActualizarAddressMasterReport | undefined> {
  const { addressMaster } = layouts;
  if (addressMaster === undefined) return undefined;
  const classification = await timer.run(ADDRESS_MASTER_PASS_STEPS.classify, () =>
    readAddressMasterClassification(session, { subject: layouts.target, addressMaster }, PADRON_SUBJECT_SPEC)
  );
  return buildAddressMasterReport(addressMaster, planAddressMasterPass(classification));
}

async function analyzeTargets(session: RunSession, layouts: PadronLayouts): Promise<void> {
  await session.query(buildAnalyzeStatement(layouts.target.schema, layouts.target.table));
  if (layouts.addressMaster !== undefined) {
    await session.query(buildAnalyzeStatement(layouts.addressMaster.schema, layouts.addressMaster.table));
  }
}

async function runAnalysisBody(
  session: RunSession,
  params: ActualizarPadronParams,
  layouts: PadronLayouts,
  timer: StepTimer
): Promise<PadronTransactionBody> {
  const source = await timer.run(STEP.RESOLVE, () => readSourceReport(session, layouts));
  // Ordered reads on the transaction's snapshot: the analysis follows the source report step.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const classification = await timer.run(STEP.CLASSIFY, () => readAnalysisClassification(session, layouts, params.options));
  const addressMaster = await runAddressMasterPlan(session, layouts, timer);
  // Ordered: the report step keeps its planned place after the link classification.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const target = await timer.run(STEP.REPORT, async () =>
    buildPadronTargetReport({
      target: layouts.target,
      classification,
      apply: plannedApplyOf(classification.counts),
      updateGeometries: params.options.updateGeometries,
    })
  );
  return {
    source,
    target,
    addressMaster,
    snapshot: snapshotOf(classification),
    pendingGeometryChanges: classification.pendingGeometryChanges,
  };
}

/** The plan check runs before the first write: a refusal leaves the destination and its sequence untouched. */
async function runPersistBody(
  session: RunSession,
  params: ActualizarPadronParams,
  layouts: PadronLayouts,
  timer: StepTimer,
  plan: ActualizarPlanRecord
): Promise<PadronTransactionBody> {
  const source = await timer.run(STEP.RESOLVE, () => readSourceReport(session, layouts));
  // Ordered reads on the transaction's snapshot: the classification follows the source report step.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const classification = await timer.run(STEP.CLASSIFY, () => readPersistClassification(session, layouts, params.options));
  const snapshot = snapshotOf(classification);
  assertPlanStillValid(plan, snapshot);
  // Ordered: the sequence is repaired after the classification and before the insert of the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  await timer.run(STEP.SEQUENCES, () => session.query(buildSequenceRepairSql(layouts.target)));
  const apply = await timer.run(STEP.APPLY, () => applyPadronChanges(session, layouts, params.options));
  assertCountsMatch(layouts.target, classification, apply);
  const revertAddressMaster = await captureAddressMasterRevert(session, layouts);
  // Ordered: the revert capture reads the unlinked rows before the link pass links them.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const addressMaster = await runAddressMasterStage(session, layouts, timer);
  await timer.run(STEP.ANALYZE, () => analyzeTargets(session, layouts));
  const target = await timer.run(STEP.REPORT, async () =>
    buildPadronTargetReport({
      target: layouts.target,
      classification,
      apply,
      updateGeometries: params.options.updateGeometries,
    })
  );
  // Ordered: the backup reads the revert rows this transaction wrote, after the report step.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const backup = await timer.run(STEP.BACKUP, () =>
    writeRevertBackup(session, revertRequestOf(layouts, apply, revertAddressMaster))
  );
  return { source, target, addressMaster, backup, snapshot, pendingGeometryChanges: classification.pendingGeometryChanges };
}

const toWriteOutcome = (outcome: TransactionOutcome<PadronTransactionBody>): PadronWriteOutcome => ({
  ...outcome.body,
  targetModified: outcome.targetsModified,
  outcomeUnknown: outcome.outcomeUnknown,
  commitError: outcome.commitError,
});

/** The analysis runs in a READ ONLY transaction: nothing it does can reach the destination. */
export async function runAnalysisTransaction(
  session: RunSession,
  params: ActualizarPadronParams,
  layouts: PadronLayouts,
  timer: StepTimer
): Promise<PadronWriteOutcome> {
  const outcome = await runTransaction(
    session,
    {
      dryRun: true,
      readOnly: true,
      secret: params.config.password,
      timer,
      steps: TRANSACTION_STEPS,
      messages: PADRON_TRANSACTION,
    },
    () => runAnalysisBody(session, params, layouts, timer)
  );
  return toWriteOutcome(outcome);
}

export async function runPersistTransaction(
  session: RunSession,
  params: ActualizarPadronParams,
  layouts: PadronLayouts,
  timer: StepTimer,
  plan: ActualizarPlanRecord
): Promise<PadronWriteOutcome> {
  const outcome = await runTransaction(
    session,
    {
      dryRun: false,
      secret: params.config.password,
      timer,
      steps: TRANSACTION_STEPS,
      messages: PADRON_TRANSACTION,
    },
    () => runPersistBody(session, params, layouts, timer, plan)
  );
  return toWriteOutcome(outcome);
}
