import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { numberOf } from "../../shared/rowMapping";
import { buildSequenceRepairSql, runTransaction, type TransactionMessages } from "../../shared/transaction";
import { EJES_TABLE_ROLE } from "../constants";
import { ejesBlockersOf } from "../domain/blockers";
import {
  changedSummaryKeys,
  skippedRowsOf,
  toEjesLoadPlan,
  toLoadRenumberedRow,
  toSurplusRow,
  type EjesLoadPlan,
} from "../domain/loadMapping";
import {
  buildAnalyzeTempSql,
  buildCopyTableSql,
  buildCreateWayInputSql,
  buildExistTableSql,
  buildLoadCountsSql,
  buildMultiPartCountSql,
  buildNewTableSql,
  buildNewWaysSql,
  buildPairTableSql,
  buildRenumberedListSql,
  buildRenumTableSql,
  buildStateTableSql,
  buildSurplusListSql,
  buildSurplusTableSql,
  buildWayTableSql,
  LOAD_TEMP,
} from "../domain/loadSelectionSql";
import {
  buildAnalyzeLoadedSql,
  buildInsertMastersSql,
  buildInsertSectionsSql,
  buildInsertWaysSql,
  buildLockSql,
  buildLockTimeoutSql,
  buildMovePointsSql,
  buildRenumberSectionsSql,
  buildUpdateFontSql,
  buildUpdateGeometrySql,
  buildUpdateIdcalleSql,
  buildUpdateTypeSql,
  WRITTEN_ALIAS,
} from "../domain/loadWriteSql";
import { buildInsertWayInputSql, newWayOf } from "../domain/loadWays";
import { assertEjesRealRunEnabled } from "../domain/realRunSwitch";
import { EJES_STEP } from "../domain/plannedSteps";
import { buildRevertInsertsSql, buildRevertPointsSql, buildRevertSectionsSql } from "../domain/revertSql";
import type { EjesAnalysis, EjesLoadContext, EjesLoadReport, EjesParams, EjesStagingReport, EjesSummary } from "../types";
import { writeEjesRevertBackup } from "./ejesRevertBackup";
import { readAnalysis, readStagingReport } from "./readEjesAnalysis";

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

const EJES_PERSIST_TRANSACTION: TransactionMessages = {
  jobLabel: "carga de ejes de calles",
  untouched: "Ninguna tabla fue modificada.",
  unverified: "No se pudo revertir la transacción: verifique las tablas de destino.",
};

const ANALYSIS_CHANGED_MESSAGE = "Los ejes de origen o los tramos de destino cambiaron desde el análisis; vuelva a analizar.";

const multiPartMessage = (count: number): string =>
  `${count} ${count === 1 ? "tramo tiene" : "tramos tienen"} una geometría que sigue en varias partes después de ST_LineMerge.`;

function assertWritten(label: string, written: number, expected: number): void {
  if (written !== expected) {
    throw new Error(`Las filas escritas en ${label} (${written}) no coinciden con las esperadas (${expected}).`);
  }
}

function assertSummaryMatches(summary: EjesSummary | undefined, analysis: EjesAnalysis): void {
  if (summary === undefined || changedSummaryKeys(summary, analysis.counts).length > 0) throw new Error(ANALYSIS_CHANGED_MESSAGE);
}

async function writtenBy(session: RunSession, sql: string): Promise<number> {
  return numberOf((await session.query(sql)).rows[0]?.[WRITTEN_ALIAS]);
}

async function repairSequences(session: RunSession, context: EjesLoadContext): Promise<void> {
  for (const role of [EJES_TABLE_ROLE.ROAD_SECTION, EJES_TABLE_ROLE.CIRCULATION_WAY, EJES_TABLE_ROLE.ADDRESS_MASTER] as const) {
    // One pg client: each repair runs before the next.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(buildSequenceRepairSql(context.targets[role]));
  }
}

async function createSelection(session: RunSession, context: EjesLoadContext): Promise<void> {
  const { layouts } = context;
  const statements = [
    buildCopyTableSql(layouts),
    buildAnalyzeTempSql(LOAD_TEMP.COPY),
    buildRenumTableSql(layouts),
    buildExistTableSql(layouts),
    buildPairTableSql(),
    buildStateTableSql(layouts),
  ];
  for (const statement of statements) {
    // One pg client: each table is built from the previous ones.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(statement);
  }
  const multiPart = numberOf((await session.query(buildMultiPartCountSql())).rows[0]?.multi_part);
  if (multiPart > 0) throwIfIssues([multiPartMessage(multiPart)]);
}

async function createWays(session: RunSession, context: EjesLoadContext): Promise<void> {
  const ways = (await session.query(buildNewWaysSql(context.layouts))).rows.map(newWayOf);
  await session.query(buildCreateWayInputSql());
  for (const statement of buildInsertWayInputSql(ways)) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(statement);
  }
  await session.query(buildWayTableSql(context));
}

/** Everything the writes and the revert file need is built first, from the tables as locked: ids are taken here, nothing is written yet. */
async function prepareLoad(session: RunSession, context: EjesLoadContext): Promise<EjesLoadPlan> {
  await createSelection(session, context);
  await session.query(buildNewTableSql(context));
  await createWays(session, context);
  await session.query(buildSurplusTableSql(context.layouts));
  await session.query(buildRevertSectionsSql(context, context.layouts));
  await session.query(buildRevertPointsSql(context, context.layouts));
  await session.query(buildRevertInsertsSql(context));
  return toEjesLoadPlan((await session.query(buildLoadCountsSql())).rows[0] ?? {});
}

async function writeWays(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  if (plan.counts.waysCreated === 0) return;
  assertWritten("las vías de circulación", await writtenBy(session, buildInsertWaysSql(context)), plan.counts.waysCreated);
}

async function writeSections(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  if (plan.counts.inserted === 0) return;
  assertWritten("las direcciones maestras", await writtenBy(session, buildInsertMastersSql(context)), plan.counts.mastersCreated);
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
  if (plan.counts.renumbered === 0) return;
  assertWritten("el reftramo de los tramos renumerados", await writtenBy(session, buildRenumberSectionsSql(context)), plan.counts.renumbered);
  if (plan.counts.pointsMoved === 0) return;
  // Ordered: the points move after their section took the new reftramo, in the same transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  assertWritten("los puntos de acceso movidos", await writtenBy(session, buildMovePointsSql(context, context.layouts)), plan.counts.pointsMoved);
}

async function analyzeChanged(session: RunSession, context: EjesLoadContext, plan: EjesLoadPlan): Promise<void> {
  const { counts } = plan;
  const changed = [
    counts.inserted + counts.updated + counts.renumbered > 0 ? EJES_TABLE_ROLE.ROAD_SECTION : undefined,
    counts.waysCreated > 0 ? EJES_TABLE_ROLE.CIRCULATION_WAY : undefined,
    counts.mastersCreated > 0 ? EJES_TABLE_ROLE.ADDRESS_MASTER : undefined,
    counts.pointsMoved > 0 ? EJES_TABLE_ROLE.ACCESS_POINT : undefined,
  ];
  for (const role of changed) {
    if (role === undefined) continue;
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(buildAnalyzeLoadedSql(context, role));
  }
}

async function readLoadLists(session: RunSession): Promise<Pick<EjesLoadReport, "surplus" | "renumbered">> {
  const surplus = (await session.query(buildSurplusListSql(DETAIL_LIST_LIMIT))).rows.map(toSurplusRow);
  // One pg client: the lists are read in turn.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const renumbered = (await session.query(buildRenumberedListSql(DETAIL_LIST_LIMIT))).rows.map(toLoadRenumberedRow);
  return { surplus, renumbered };
}

async function persistBody(
  session: RunSession,
  params: EjesParams,
  context: EjesLoadContext,
  timer: StepTimer
): Promise<EjesPersistBody> {
  await timer.run(EJES_STEP.LOCK, async () => {
    await session.query(buildLockTimeoutSql());
    await session.query(buildLockSql(context));
  });
  const staging = await timer.run(EJES_STEP.STAGING, () => readStagingReport(session, context.layouts));
  throwIfIssues(ejesBlockersOf(staging));
  // Ordered: a blocker aborts the run before the classification and the backup.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const analysis = await timer.run(EJES_STEP.ANALYZE, () => readAnalysis(session, context.layouts));
  assertSummaryMatches(params.summary, analysis);
  await timer.run(EJES_STEP.SEQUENCES, () => repairSequences(session, context));
  // Ordered: the ids come from the repaired sequences.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const plan = await timer.run(EJES_STEP.SELECT, () => prepareLoad(session, context));
  // One transaction on one pg client: the lists are read before the backup, never alongside it.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const lists = await readLoadLists(session);
  // Ordered: the backup is written and verified before the first write.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const backup = await timer.run(EJES_STEP.BACKUP, () =>
    writeEjesRevertBackup(session, params.tables[EJES_TABLE_ROLE.ROAD_SECTION], plan.counts)
  );
  await timer.run(EJES_STEP.WAYS, () => writeWays(session, context, plan));
  await timer.run(EJES_STEP.SECTIONS, () => writeSections(session, context, plan));
  await timer.run(EJES_STEP.UPDATES, () => writeUpdates(session, context, plan));
  await timer.run(EJES_STEP.RENUMBER, () => writeRenumbered(session, context, plan));
  await timer.run(EJES_STEP.ANALYZE_TABLES, () => analyzeChanged(session, context, plan));
  return {
    staging,
    analysis,
    load: {
      counts: plan.counts,
      surplus: lists.surplus,
      surplusTotal: plan.surplusTotal,
      renumbered: lists.renumbered,
      skipped: skippedRowsOf(analysis),
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
  assertEjesRealRunEnabled();
  const outcome = await runTransaction(
    session,
    {
      dryRun: false,
      secret: params.config.password,
      timer,
      steps: { commit: EJES_STEP.COMMIT, rollback: EJES_STEP.COMMIT },
      messages: EJES_PERSIST_TRANSACTION,
    },
    () => persistBody(session, params, context, timer)
  );
  return {
    ...outcome.body,
    targetModified: outcome.targetsModified,
    outcomeUnknown: outcome.outcomeUnknown,
    commitError: outcome.commitError,
  };
}
