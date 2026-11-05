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
import { sequenceStateWarnings } from "../../shared/targetPreflight";
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
  actualRemovalCountsOf,
  buildPadronTargetReport,
  NO_REASSIGN_CHANGED_OUTCOME,
  NO_REASSIGN_OUTCOME,
  plannedApplyOf,
  plannedRemovalOf,
  toPadronApplyOutcome,
  toPadronClassification,
  toPadronDeleteOutcome,
  toPadronReassignChangedOutcome,
  toPadronReassignOutcome,
  toReportView,
  type ReportView,
} from "../domain/reportMapping";
import { buildReportSql } from "../domain/reportSql";
import { buildCreateDeleteIdsTableSql } from "../domain/deleteIdsTable";
import { buildCreateInsertedIdsTableSql, buildCreateReassignIdsTableSql } from "../domain/reassignTables";
import { buildPadronReassignChangedSql } from "../domain/reassignChangedSql";
import { buildPadronReassignSql, reassignedTablesOf } from "../domain/reassignSql";
import type { ReferenceScan } from "../domain/referenceScan";
import { buildPadronApplySql, buildPadronClassifySql, type ClassifyStatementOptions } from "../domain/targetSql";
import { buildPadronDeleteSql } from "../domain/deleteSql";
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
  PadronDeleteOutcome,
  PadronGeometryChange,
  PadronLayouts,
  PadronReassignChangedOutcome,
  PadronReassignOutcome,
  ActualizarPadronParams,
  PlanSnapshot,
} from "../types";
import { guardRevertStep, writeRevertBackup, type RevertBackupRequest } from "./revertBackup";
import { scanReferenceTables } from "./referenceTables";

export interface PadronWriteOutcome {
  source: ReportView;
  target: ActualizarTargetReport;
  addressMaster?: ActualizarAddressMasterReport;
  backup?: ActualizarPadronBackup;
  snapshot: PlanSnapshot;
  pendingGeometryChanges: PadronGeometryChange[];
  sequenceWarnings: string[];
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
  sequenceWarnings: string[];
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

interface ClassifiedRun {
  classification: PadronClassification;
  scan: ReferenceScan;
}

/* AP-102 runs a fresh catalog scan both in an analysis and in the persist classify: the removal-eligibility counts and their
   digest entry (AP-105) must be identical whichever path computed them, so AP-90's plan-changed guard also covers deletions. */
async function readClassification(
  session: RunSession,
  layouts: PadronLayouts,
  options: ActualizarPadronOptions,
  classifyOptions: ClassifyStatementOptions
): Promise<ClassifiedRun> {
  const scan = await scanReferenceTables(session, layouts.target.schema, layouts.target.table, layouts.addressMaster !== undefined);
  const result = await session.query(buildPadronClassifySql(layouts, options, scan, classifyOptions));
  return { classification: toPadronClassification(result.rows[0] ?? {}), scan };
}

/** The analysis computes the deletable set inside its READ ONLY transaction (counts and a capped list only): nothing is written. */
function readAnalysisClassification(
  session: RunSession,
  layouts: PadronLayouts,
  options: ActualizarPadronOptions
): Promise<ClassifiedRun> {
  return readClassification(session, layouts, options, { report: true });
}

/** The persist classify also reads the removal-eligibility block (never gated by report): no replacement block and no missing-review lists.
    It first creates the session's temp table and writes the delete-eligible ids into it, set-based (AP-106). */
async function readPersistClassification(
  session: RunSession,
  layouts: PadronLayouts,
  options: ActualizarPadronOptions
): Promise<ClassifiedRun> {
  await session.query(buildCreateDeleteIdsTableSql());
  await session.query(buildCreateReassignIdsTableSql());
  return readClassification(session, layouts, options, { report: false, persistDeletable: true });
}

/** A real run first creates the revert table in the transaction, then captures the old values inside the same apply statement.
    When subdivided padrones are to be reassigned, the same statement keeps the ids it inserted: they are the receivers (AP-113). */
async function applyPadronChanges(
  session: RunSession,
  layouts: PadronLayouts,
  options: ActualizarPadronOptions,
  storeInsertedIds: boolean
): Promise<PadronApplyOutcome> {
  await guardRevertStep(() => session.query(buildCreateRevertTableSql()));
  if (storeInsertedIds) await session.query(buildCreateInsertedIdsTableSql());
  const result = await session.query(buildPadronApplySql(layouts, options, { captureRevert: true, storeInsertedIds }));
  return toPadronApplyOutcome(result.rows[0] ?? {});
}

/** AP-113: its own statement, after the apply and before the delete. With no subdivided padrón to reassign it runs nothing. */
async function reassignPadronAddresses(
  session: RunSession,
  layouts: PadronLayouts,
  scan: ReferenceScan,
  classification: PadronClassification
): Promise<PadronReassignOutcome> {
  if (classification.counts.subdividedDeleted === 0) return NO_REASSIGN_OUTCOME;
  const result = await session.query(buildPadronReassignSql(layouts, scan.tables));
  return toPadronReassignOutcome(result.rows[0] ?? {});
}

/** AP-122: its own statement, after the subdivided reassignment and before the delete. With no table AP-110 allows it runs nothing. */
async function reassignChangedPadronAddresses(
  session: RunSession,
  layouts: PadronLayouts,
  scan: ReferenceScan
): Promise<PadronReassignChangedOutcome> {
  if (reassignedTablesOf(scan.tables).length === 0) return NO_REASSIGN_CHANGED_OUTCOME;
  const result = await session.query(buildPadronReassignChangedSql(layouts, scan.tables));
  return toPadronReassignChangedOutcome(result.rows[0] ?? {});
}

/** AP-106: its own statement, after the apply, before the address master pass. Reads the digest-verified delete-eligible ids
    from the session's temp table and the same reference table list, re-checking only condition (c) for staleness. */
async function deletePadronRows(session: RunSession, layouts: PadronLayouts, scan: ReferenceScan): Promise<PadronDeleteOutcome> {
  const result = await session.query(buildPadronDeleteSql(layouts, scan.tables));
  return toPadronDeleteOutcome(result.rows[0] ?? {});
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
  deleteOutcome: PadronDeleteOutcome,
  reassignOutcome: PadronReassignOutcome,
  changedOutcome: PadronReassignChangedOutcome,
  addressMaster: RevertAddressMaster | undefined
): RevertBackupRequest => ({
  target: layouts.target,
  addressMaster,
  expected: {
    inserted: apply.inserted,
    updated: apply.updated,
    paired: apply.paired,
    removed: deleteOutcome.deleted,
    reassigned: reassignOutcome.moved + changedOutcome.moved,
    masterDeleted: deleteOutcome.masterDeleted,
  },
});

/** AP-113's count check, as AP-48: the rows moved must equal the referencing rows the classification counted, or the transaction rolls back. */
function assertReassignCountsMatch(
  target: WritableTargetLayout,
  classification: PadronClassification,
  reassignOutcome: PadronReassignOutcome
): void {
  if (reassignOutcome.moved !== classification.counts.reassigned) {
    throw new Error(
      `Las direcciones reasignadas (${reassignOutcome.moved}) no coinciden con las del análisis (${classification.counts.reassigned}) en ${target.schema}.${target.table}.`
    );
  }
}

/** AP-122's count check, as AP-48: the rows updated must equal the rows the statement selected, or the transaction rolls back. */
function assertReassignChangedCountsMatch(target: WritableTargetLayout, outcome: PadronReassignChangedOutcome): void {
  if (outcome.moved !== outcome.selected) {
    throw new Error(
      `Las direcciones reasignadas por cambio de forma de su padrón (${outcome.moved}) no coinciden con las seleccionadas (${outcome.selected}) en ${target.schema}.${target.table}.`
    );
  }
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

/** AP-106's own count check: the delete statement's reported deleted rows must equal the candidates it found still eligible. */
function assertDeleteCountsMatch(target: WritableTargetLayout, deleteOutcome: PadronDeleteOutcome): void {
  if (deleteOutcome.deleted !== deleteOutcome.surviving) {
    throw new Error(
      `Los padrones eliminados (${deleteOutcome.deleted}) no coinciden con los que seguían siendo eliminables (${deleteOutcome.surviving}) en ${target.schema}.${target.table}.`
    );
  }
}

interface AddressMasterStage {
  report: ActualizarAddressMasterReport | undefined;
  sequenceWarnings: string[];
}

/** Links the target's padrones without a dirección maestra; it sees the rows the upsert inserted, in the same transaction.
    The sequence state check runs once the link classification knows how many address masters it creates, before their insert. */
async function runAddressMasterStage(
  session: RunSession,
  layouts: PadronLayouts,
  params: ActualizarPadronParams,
  timer: StepTimer
): Promise<AddressMasterStage> {
  const { addressMaster } = layouts;
  const sequenceWarnings: string[] = [];
  if (addressMaster === undefined) return { report: undefined, sequenceWarnings };
  const { repairSequences } = params.options;
  // Ordered: the address master sequence is repaired before its inserts of the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  if (repairSequences) {
    await timer.run(STEP.ADDRESS_SEQUENCES, () => session.query(buildSequenceRepairSql(addressMaster)));
  }
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const pass = await runAddressMasterLinkPass(
    session,
    { subject: layouts.target, addressMaster },
    PADRON_SUBJECT_SPEC,
    ADDRESS_MASTER_PASS_STEPS,
    timer,
    async (classification) => {
      sequenceWarnings.push(
        ...(await sequenceStateWarnings(session, {
          target: addressMaster,
          inserts: classification.counts.created,
          repairSequences,
          dryRun: params.dryRun,
        }))
      );
    }
  );
  return { report: buildAddressMasterReport(addressMaster, pass), sequenceWarnings };
}

/** The analysis only classifies the links: the rows the padron insert will add are not in the destination yet, so they are not counted. */
async function runAddressMasterPlan(
  session: RunSession,
  layouts: PadronLayouts,
  params: ActualizarPadronParams,
  timer: StepTimer
): Promise<AddressMasterStage> {
  const { addressMaster } = layouts;
  if (addressMaster === undefined) return { report: undefined, sequenceWarnings: [] };
  const classification = await timer.run(ADDRESS_MASTER_PASS_STEPS.classify, () =>
    readAddressMasterClassification(session, { subject: layouts.target, addressMaster }, PADRON_SUBJECT_SPEC)
  );
  const sequenceWarnings = await sequenceStateWarnings(session, {
    target: addressMaster,
    inserts: classification.counts.created,
    repairSequences: params.options.repairSequences,
    dryRun: true,
  });
  return { report: buildAddressMasterReport(addressMaster, planAddressMasterPass(classification)), sequenceWarnings };
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
  const { classification, scan } = await timer.run(STEP.CLASSIFY, () => readAnalysisClassification(session, layouts, params.options));
  const targetSequenceWarnings = await sequenceStateWarnings(session, {
    target: layouts.target,
    inserts: classification.counts.inserted,
    repairSequences: params.options.repairSequences,
    dryRun: true,
  });
  // Ordered: the address master plan follows the padron classification.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const addressMaster = await runAddressMasterPlan(session, layouts, params, timer);
  // Ordered: the report step keeps its planned place after the link classification.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const target = await timer.run(STEP.REPORT, async () =>
    buildPadronTargetReport({
      target: layouts.target,
      classification,
      apply: plannedApplyOf(classification.counts),
      removal: plannedRemovalOf(classification),
      removalBlockedReason: scan.blockedReason,
      updateGeometries: params.options.updateGeometries,
    })
  );
  return {
    source,
    target,
    addressMaster: addressMaster.report,
    snapshot: snapshotOf(classification),
    pendingGeometryChanges: classification.pendingGeometryChanges,
    sequenceWarnings: [...targetSequenceWarnings, ...addressMaster.sequenceWarnings],
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
  const { classification, scan } = await timer.run(STEP.CLASSIFY, () =>
    readPersistClassification(session, layouts, params.options)
  );
  const snapshot = snapshotOf(classification);
  assertPlanStillValid(plan, snapshot);
  const targetSequenceWarnings = await sequenceStateWarnings(session, {
    target: layouts.target,
    inserts: classification.counts.inserted,
    repairSequences: params.options.repairSequences,
    dryRun: false,
  });
  // Ordered: the sequence is repaired after the classification and before the insert of the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  if (params.options.repairSequences) {
    await timer.run(STEP.SEQUENCES, () => session.query(buildSequenceRepairSql(layouts.target)));
  }
  const apply = await timer.run(STEP.APPLY, () =>
    applyPadronChanges(session, layouts, params.options, classification.counts.subdividedDeleted > 0)
  );
  assertCountsMatch(layouts.target, classification, apply);
  // Ordered: the reassignment needs the parts the apply inserted (AP-113).
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const reassignOutcome = await timer.run(STEP.REASSIGN, () => reassignPadronAddresses(session, layouts, scan, classification));
  assertReassignCountsMatch(layouts.target, classification, reassignOutcome);
  // Ordered: the padrones the apply reshaped are read after the subdivided reassignment and before the delete (AP-122).
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const changedOutcome = await timer.run(STEP.REASSIGN_CHANGED, () => reassignChangedPadronAddresses(session, layouts, scan));
  assertReassignChangedCountsMatch(layouts.target, changedOutcome);
  // Ordered: the delete statement needs the apply's inserts, geometry updates and applied pairs already in place (AP-106), and the references already moved.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const deleteOutcome = await timer.run(STEP.DELETE, () => deletePadronRows(session, layouts, scan));
  assertDeleteCountsMatch(layouts.target, deleteOutcome);
  const revertAddressMaster = await captureAddressMasterRevert(session, layouts);
  // Ordered: the revert capture reads the unlinked rows before the link pass links them.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const addressMaster = await runAddressMasterStage(session, layouts, params, timer);
  await timer.run(STEP.ANALYZE, () => analyzeTargets(session, layouts));
  const target = await timer.run(STEP.REPORT, async () =>
    buildPadronTargetReport({
      target: layouts.target,
      classification,
      apply,
      removal: actualRemovalCountsOf(classification, deleteOutcome, reassignOutcome, changedOutcome),
      removalBlockedReason: scan.blockedReason,
      updateGeometries: params.options.updateGeometries,
    })
  );
  // Ordered: the backup reads the revert rows this transaction wrote, after the report step.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const backup = await timer.run(STEP.BACKUP, () =>
    writeRevertBackup(session, revertRequestOf(layouts, apply, deleteOutcome, reassignOutcome, changedOutcome, revertAddressMaster))
  );
  return {
    source,
    target,
    addressMaster: addressMaster.report,
    backup,
    snapshot,
    pendingGeometryChanges: classification.pendingGeometryChanges,
    sequenceWarnings: [...targetSequenceWarnings, ...addressMaster.sequenceWarnings],
  };
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
