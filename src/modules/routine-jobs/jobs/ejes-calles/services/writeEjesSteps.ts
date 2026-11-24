import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { numberOf } from "../../shared/rowMapping";
import { buildSequenceRepairSql, runTransaction, type TransactionMessages } from "../../shared/transaction";
import { EJES_TABLE_ROLE } from "../constants";
import { assertManualSplitsApply, assertMoveTargetsExist, assertTwinPicksExist, prepareAccepted, createRemovalPlans, writeRemovals } from "./removalLoad";
import { ANALYSIS_CHANGED_MESSAGE, assertRenamesAccepted, assertWritten, runInOrder, writtenBy } from "./writeStatements";
import { ejesBlockersOf } from "../domain/blockers";
import {
  changedSummaryKeys,
  fingerprintChanged,
  NO_ACCEPTED,
  toEjesLoadPlan,
  toLoadRenumberedRow,
  toSkipCount,
  toSkippedRow,
  toSurplusRow,
  type EjesLoadPlan,
} from "../domain/loadMapping";
import {
  buildAnalyzeTempSql,
  buildCopyTableSql,
  buildCreateWayInputSql,
  buildCreateWayRenameInputSql,
  buildExistTableSql,
  buildLoadCountsSql,
  buildMultiPartCountSql,
  buildNewTableSql,
  buildNewWaysSql,
  buildRenamedWaysSql,
  buildPairTableSql,
  buildHeldCopiesSql,
  buildRenumberedListSql,
  buildStateTableSql,
  buildSurplusListSql,
  buildSurplusTableSql,
  buildWayTableSql,
  buildWayRenameOldSql,
  LOAD_TEMP,
} from "../domain/loadSelectionSql";
import {
  buildAnalyzeLoadedSql,
  buildInsertMastersSql,
  buildInsertSectionsSql,
  buildInsertWaysSql,
  buildRenameWaysSql,
  buildLockSql,
  buildLockTimeoutSql,
  buildMovePointsSql,
  buildRenumberSectionsSql,
  buildUpdateFontSql,
  buildUpdateGeometrySql,
  buildUpdateIdcalleSql,
  buildUpdateTypeSql,
} from "../domain/loadWriteSql";
import { acceptedRenamesOf, buildInsertWayInputSql, buildInsertWayRenameInputSql, newWayOf } from "../domain/loadWays";
import { buildSkippedListSql, buildSkippedReasonCountsSql } from "../domain/removalPlanSql";
import { EJES_STEP } from "../domain/plannedSteps";
import {
  buildRevertCreatedVerticesSql,
  buildRevertInsertsSql,
  buildRevertMastersSql,
  buildRevertPointsSql,
  buildRevertPointWaysSql,
  buildRevertWayRenamesSql,
  buildRevertRestoredSectionsSql,
  buildRevertRestoredVerticesSql,
  buildRevertSectionsSql,
} from "../domain/revertSql";
import type {
  EjesAccepted,
  EjesAnalysis,
  EjesLoadContext,
  EjesLoadCounts,
  EjesLoadReport,
  EjesParams,
  EjesStagingReport,
  EjesSummary,
} from "../types";
import { discardEjesRevertBackup, writeEjesRevertBackup } from "./ejesRevertBackup";
import { readAnalysisForLoad, readStagingReport } from "./readEjesAnalysis";
import { writeSplitPoints } from "./splitLoad";
import { createTopologyInputs, writeTopology } from "./topologyLoad";

export interface EjesPersistBody {
  staging: EjesStagingReport;
  analysis: EjesAnalysis;
  load: EjesLoadReport;
}

export interface EjesPersistOutcome extends EjesPersistBody {
  targetModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
}

type LoadLists = Pick<EjesLoadReport, "surplus" | "renumbered" | "skipped" | "skippedTotal" | "skippedByReason">;

const EJES_PERSIST_TRANSACTION: TransactionMessages = {
  jobLabel: "carga de ejes de calles",
  untouched: "Ninguna tabla fue modificada.",
  unverified: "No se pudo revertir la transacción: verifique las tablas de destino.",
};


const multiPartMessage = (count: number): string =>
  `${count} ${count === 1 ? "tramo tiene" : "tramos tienen"} una geometría que sigue en varias partes después de ST_LineMerge.`;

function summaryDifferencesOf(summary: EjesSummary, analysis: EjesAnalysis): string[] {
  const counts = changedSummaryKeys(summary, analysis.counts).map((name) => {
    const key = name as keyof EjesSummary["counts"];
    return `${key}: ${summary.counts[key]} -> ${analysis.counts[key]}`;
  });
  return fingerprintChanged(summary, analysis.fingerprint) ? [...counts, "huella del archivo de ejes"] : counts;
}

function assertSummaryMatches(summary: EjesSummary | undefined, analysis: EjesAnalysis): void {
  if (summary === undefined) throw new Error(ANALYSIS_CHANGED_MESSAGE);
  const differences = summaryDifferencesOf(summary, analysis);
  if (differences.length > 0) throw new Error(`${ANALYSIS_CHANGED_MESSAGE} Cambió: ${differences.join("; ")}.`);
}

async function repairSequences(session: RunSession, context: EjesLoadContext): Promise<void> {
  for (const role of [
    EJES_TABLE_ROLE.ROAD_SECTION,
    EJES_TABLE_ROLE.CIRCULATION_WAY,
    EJES_TABLE_ROLE.ADDRESS_MASTER,
    EJES_TABLE_ROLE.VERTICES,
  ] as const) {
    // One pg client: each repair runs before the next.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(buildSequenceRepairSql(context.targets[role]));
  }
}

async function createSelection(session: RunSession, context: EjesLoadContext): Promise<void> {
  const { layouts } = context;
  await runInOrder(session, [
    buildCopyTableSql(layouts),
    buildHeldCopiesSql(),
    buildAnalyzeTempSql(LOAD_TEMP.COPY),
    buildExistTableSql(layouts),
    buildPairTableSql(),
    buildStateTableSql(layouts),
  ]);
}

async function assertSingleParts(session: RunSession): Promise<void> {
  const multiPart = numberOf((await session.query(buildMultiPartCountSql())).rows[0]?.multi_part);
  if (multiPart > 0) throwIfIssues([multiPartMessage(multiPart)]);
}

async function createWays(session: RunSession, context: EjesLoadContext, accepted: EjesAccepted): Promise<void> {
  const ways = (await session.query(buildNewWaysSql(context.layouts))).rows.map(newWayOf);
  await session.query(buildCreateWayInputSql());
  for (const statement of buildInsertWayInputSql(ways)) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(statement);
  }
  await session.query(buildWayTableSql(context));
  const candidates = (await session.query(buildRenamedWaysSql(context.layouts))).rows;
  assertRenamesAccepted(candidates, (accepted.renamedStreets ?? []).length);
  await session.query(buildCreateWayRenameInputSql());
  for (const statement of buildInsertWayRenameInputSql(acceptedRenamesOf(candidates))) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(statement);
  }
  await session.query(buildWayRenameOldSql(context));
}

/** Everything the writes and the revert file need is built first, from the tables as locked: ids are taken here, nothing is written yet. */
async function prepareLoad(session: RunSession, context: EjesLoadContext, accepted: EjesAccepted): Promise<EjesLoadPlan> {
  await createSelection(session, context);
  await createRemovalPlans(session, context);
  await assertMoveTargetsExist(session, context.layouts);
  await assertSingleParts(session);
  await session.query(buildNewTableSql(context));
  await createTopologyInputs(session, context);
  await createWays(session, context, accepted);
  await session.query(buildSurplusTableSql(context));
  await runInOrder(session, [
    buildRevertSectionsSql(context, context.layouts),
    buildRevertPointsSql(context, context.layouts),
    buildRevertPointWaysSql(context, context.layouts),
    buildRevertWayRenamesSql(context),
    buildRevertInsertsSql(context),
    buildRevertMastersSql(context),
    buildRevertRestoredSectionsSql(context),
    buildRevertRestoredVerticesSql(context),
    buildRevertCreatedVerticesSql(context),
  ]);
  return toEjesLoadPlan((await session.query(buildLoadCountsSql())).rows[0] ?? {});
}

async function writeWays(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  if (plan.counts.waysCreated > 0) {
    assertWritten("las vías de circulación", await writtenBy(session, buildInsertWaysSql(context)), plan.counts.waysCreated);
  }
  if (plan.counts.waysRenamed > 0) {
    // Ordered: the renames follow the inserts inside the same transaction.
    // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
    assertWritten("los nombres de las vías de circulación", await writtenBy(session, buildRenameWaysSql(context)), plan.counts.waysRenamed);
  }
}

async function writeSections(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  if (plan.counts.inserted === 0) return;
  assertWritten("las direcciones maestras", await writtenBy(session, buildInsertMastersSql(context)), plan.counts.inserted);
  // Ordered: both inserts use the ids taken before the backup.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  assertWritten("los tramos nuevos", await writtenBy(session, buildInsertSectionsSql(context)), plan.counts.inserted);
}

async function writeUpdates(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  const updates: Array<[string, string, number]> = [
    ["la calle de los tramos", buildUpdateIdcalleSql(context), plan.attr.idcalle],
    ["el tipo de los tramos", buildUpdateTypeSql(context), plan.attr.type],
    ["la fuente de los tramos", buildUpdateFontSql(context), plan.attr.font],
    ["la geometría de los tramos", buildUpdateGeometrySql(context), plan.attr.geom],
  ];
  for (const [label, sql, expected] of updates) {
    if (expected === 0) continue;
    // One transaction on one pg client: the updates run in order.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    assertWritten(label, await writtenBy(session, sql), expected);
  }
}

async function writeRenumbered(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  if (plan.counts.renumbered > 0) {
    assertWritten("el reftramo de los tramos renumerados", await writtenBy(session, buildRenumberSectionsSql(context)), plan.counts.renumbered);
  }
  if (plan.movedPoints === 0) return;
  // Ordered: the points move after their sections took the new reftramo, in the same transaction; merged and twin-loser points follow their new section.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  assertWritten("los puntos de acceso movidos", await writtenBy(session, buildMovePointsSql(context)), plan.movedPoints);
}

async function analyzeChanged(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  const { counts } = plan;
  const changed = [
    counts.inserted + counts.updated + counts.renumbered + counts.deleted > 0 ? EJES_TABLE_ROLE.ROAD_SECTION : undefined,
    counts.waysCreated + counts.waysRenamed > 0 ? EJES_TABLE_ROLE.CIRCULATION_WAY : undefined,
    counts.inserted + plan.deletedMasters > 0 ? EJES_TABLE_ROLE.ADDRESS_MASTER : undefined,
    counts.pointsMoved > 0 ? EJES_TABLE_ROLE.ACCESS_POINT : undefined,
    counts.verticesCreated + counts.verticesDeleted > 0 ? EJES_TABLE_ROLE.VERTICES : undefined,
  ];
  for (const role of changed) {
    if (role === undefined) continue;
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(buildAnalyzeLoadedSql(context, role));
  }
}

async function readLoadLists(session: RunSession): Promise<LoadLists> {
  const surplus = (await session.query(buildSurplusListSql(DETAIL_LIST_LIMIT))).rows.map(toSurplusRow);
  // One pg client: the lists are read in turn.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const renumbered = (await session.query(buildRenumberedListSql(DETAIL_LIST_LIMIT))).rows.map(toLoadRenumberedRow);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const skipped = (await session.query(buildSkippedListSql(DETAIL_LIST_LIMIT))).rows.map(toSkippedRow);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const skippedByReason = (await session.query(buildSkippedReasonCountsSql())).rows.map(toSkipCount);
  const skippedTotal = skippedByReason.reduce((total, entry) => total + entry.count, 0);
  return { surplus, renumbered, skipped, skippedTotal, skippedByReason };
}

/** The writes, the topology and the ANALYZE of the changed tables. Any failure here is followed by a rollback, so the backup is discarded first. */
async function writeChanges(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan, timer: StepTimer): Promise<EjesLoadCounts> {
  await timer.run(EJES_STEP.WAYS, () => writeWays(session, context, plan));
  await timer.run(EJES_STEP.SECTIONS, () => writeSections(session, context, plan));
  await timer.run(EJES_STEP.UPDATES, () => writeUpdates(session, context, plan));
  await timer.run(EJES_STEP.RENUMBER, () => writeRenumbered(session, context, plan));
  await timer.run(EJES_STEP.SPLIT_POINTS, () => writeSplitPoints(session, context, plan));
  await timer.run(EJES_STEP.REMOVE, () => writeRemovals(session, context, plan));
  const topology = await timer.run(EJES_STEP.TOPOLOGY, () => writeTopology(session, context));
  const counts = { ...plan.counts, ...topology };
  await timer.run(EJES_STEP.ANALYZE_TABLES, () => analyzeChanged(session, context, { ...plan, counts }));
  return counts;
}

async function persistBody(
  session: RunSession,
  params: EjesParams,
  context: EjesLoadContext,
  timer: StepTimer,
  accepted: EjesAccepted
): Promise<EjesPersistBody> {
  await timer.run(EJES_STEP.LOCK, async () => {
    await session.query(buildLockTimeoutSql());
    await session.query(buildLockSql(context));
  });
  const staging = await timer.run(EJES_STEP.STAGING, () => readStagingReport(session, context.layouts));
  throwIfIssues(ejesBlockersOf(staging));
  // Ordered: a blocker aborts the run before the classification and the backup.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const analysis = await timer.run(EJES_STEP.ANALYZE, () =>
    readAnalysisForLoad(session, context.layouts, accepted.twinPicks, accepted.manualSplits)
  );
  assertSummaryMatches(params.summary, analysis);
  assertManualSplitsApply(analysis);
  await prepareAccepted(session, accepted);
  await assertTwinPicksExist(session, context.layouts);
  await timer.run(EJES_STEP.SEQUENCES, () => repairSequences(session, context));
  // Ordered: the ids come from the repaired sequences.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const plan = await timer.run(EJES_STEP.SELECT, () => prepareLoad(session, context, accepted));
  // One transaction on one pg client: the lists are read before the backup, never alongside it.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const lists = await readLoadLists(session);
  // Ordered: the backup is written and verified before the first write.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const backup = await timer.run(EJES_STEP.BACKUP, () =>
    writeEjesRevertBackup(session, params.tables[EJES_TABLE_ROLE.ROAD_SECTION], plan.counts)
  );
  let counts: EjesLoadCounts;
  try {
    counts = await writeChanges(session, context, plan, timer);
  } catch (error: unknown) {
    await discardEjesRevertBackup(backup);
    throw error;
  }
  return {
    staging,
    analysis,
    load: {
      counts,
      surplus: lists.surplus,
      surplusTotal: plan.surplusTotal,
      renumbered: lists.renumbered,
      skipped: lists.skipped,
      skippedTotal: lists.skippedTotal,
      skippedByReason: lists.skippedByReason,
      backup,
    },
  };
}

export async function runEjesPersistTransaction(
  session: RunSession,
  params: EjesParams,
  context: EjesLoadContext,
  timer: StepTimer
): Promise<EjesPersistOutcome> {
  const accepted = params.accepted ?? NO_ACCEPTED;
  const outcome = await runTransaction(
    session,
    {
      dryRun: false,
      secret: params.config.password,
      timer,
      steps: { commit: EJES_STEP.COMMIT, rollback: EJES_STEP.COMMIT },
      messages: EJES_PERSIST_TRANSACTION,
    },
    () => persistBody(session, params, context, timer, accepted)
  );
  return {
    ...outcome.body,
    targetModified: outcome.targetsModified,
    outcomeUnknown: outcome.outcomeUnknown,
    commitError: outcome.commitError,
  };
}
