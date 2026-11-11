import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { readUnsupportedSridCount } from "../../shared/tableFacts";
import { numberOf } from "../../shared/rowMapping";
import { runTransaction, type TransactionMessages } from "../../shared/transaction";
import { CENTROS_COLUMN } from "../constants";
import { stagingBlockersOf } from "../domain/blockers";
import { textColumnsOf } from "../domain/columnPlan";
import { CENTROS_STEP } from "../domain/plannedSteps";
import {
  buildAnalyzeFinalSql,
  buildDeleteFinalSql,
  buildInsertFromStagingSql,
  buildLockFinalSql,
} from "../domain/replaceSql";
import { compareWithFinal, toCentrosFinalCounts, toCentrosStagingReport } from "../domain/reportMapping";
import { buildFinalCountsSql, buildStagingChecksSql } from "../domain/stagingSql";
import type {
  CentrosBackup,
  CentrosComparison,
  CentrosFinalCounts,
  CentrosParams,
  CentrosResolved,
  CentrosStagingReport,
} from "../types";
import { writeCentrosRevertBackup } from "./revertBackup";

export interface CentrosOutcome {
  staging: CentrosStagingReport;
  comparison: CentrosComparison;
  deleted: number;
  inserted: number;
  backup?: CentrosBackup;
  targetModified: boolean;
  outcomeUnknown: boolean;
  commitError?: string;
}

interface TransactionBody {
  staging: CentrosStagingReport;
  comparison: CentrosComparison;
  deleted: number;
  inserted: number;
  backup?: CentrosBackup;
}

const CENTROS_TRANSACTION: TransactionMessages = {
  jobLabel: "carga de centros ANEP",
  untouched: "La tabla final de centros ANEP no fue modificada.",
  unverified: "No se pudo revertir la transacción: verifique la tabla final de centros ANEP.",
};

async function readStagingReport(session: RunSession, resolved: CentrosResolved): Promise<CentrosStagingReport> {
  const { layout, catalog } = resolved.staging;
  const checks = await session.query(buildStagingChecksSql(layout, textColumnsOf(catalog)));
  // One pg client: reads are awaited in turn, so they never overlap.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const unsupported = await readUnsupportedSridCount(session, layout, CENTROS_COLUMN.GEOM);
  return toCentrosStagingReport(checks.rows[0] ?? {}, unsupported);
}

async function readFinalCounts(session: RunSession, resolved: CentrosResolved): Promise<CentrosFinalCounts> {
  const result = await session.query(buildFinalCountsSql(resolved.final));
  return toCentrosFinalCounts(result.rows[0] ?? {});
}

async function readWrittenCount(session: RunSession, sql: string, alias: string): Promise<number> {
  const result = await session.query(sql);
  return numberOf(result.rows[0]?.[alias]);
}

async function readAnalysis(
  session: RunSession,
  resolved: CentrosResolved,
  timer: StepTimer
): Promise<{ staging: CentrosStagingReport; comparison: CentrosComparison; current: CentrosFinalCounts }> {
  const staging = await timer.run(CENTROS_STEP.STAGING, () => readStagingReport(session, resolved));
  // One pg client: reads are awaited in turn, so they never overlap.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const current = await timer.run(CENTROS_STEP.COMPARE, () => readFinalCounts(session, resolved));
  return { staging, current, comparison: compareWithFinal(current, staging) };
}

export function assertInsertedMatches(inserted: number, stagingRows: number): void {
  if (inserted !== stagingRows) {
    throw new Error(`Las filas insertadas (${inserted}) no coinciden con las filas de staging (${stagingRows}).`);
  }
}

async function replaceBody(session: RunSession, resolved: CentrosResolved, timer: StepTimer): Promise<TransactionBody> {
  await timer.run(CENTROS_STEP.LOCK, () => session.query(buildLockFinalSql(resolved.final)));
  const { staging, current, comparison } = await readAnalysis(session, resolved, timer);
  throwIfIssues(stagingBlockersOf(staging));
  // One transaction on one pg client: backup, delete and insert must run in order.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await, react-doctor/async-parallel
  const backup = await timer.run(CENTROS_STEP.BACKUP, () => writeCentrosRevertBackup(session, resolved.final, current.rows));
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await, react-doctor/async-parallel
  const deleted = await timer.run(CENTROS_STEP.DELETE, () =>
    readWrittenCount(session, buildDeleteFinalSql(resolved.final), "deleted")
  );
  const inserted = await timer.run(CENTROS_STEP.INSERT, () =>
    readWrittenCount(session, buildInsertFromStagingSql(resolved.staging, resolved.final, resolved.plan), "inserted")
  );
  assertInsertedMatches(inserted, staging.rows);
  await timer.run(CENTROS_STEP.ANALYZE, () => session.query(buildAnalyzeFinalSql(resolved.final)));
  return { staging, comparison, deleted, inserted, backup };
}

async function analysisBody(session: RunSession, resolved: CentrosResolved, timer: StepTimer): Promise<TransactionBody> {
  const { staging, comparison } = await readAnalysis(session, resolved, timer);
  return { staging, comparison, deleted: 0, inserted: 0 };
}

export async function runCentrosTransaction(
  session: RunSession,
  params: CentrosParams,
  resolved: CentrosResolved,
  timer: StepTimer
): Promise<CentrosOutcome> {
  const outcome = await runTransaction(
    session,
    {
      dryRun: params.dryRun,
      readOnly: params.dryRun,
      secret: params.config.password,
      timer,
      steps: { commit: CENTROS_STEP.COMMIT, rollback: CENTROS_STEP.COMMIT },
      messages: CENTROS_TRANSACTION,
    },
    () => (params.dryRun ? analysisBody(session, resolved, timer) : replaceBody(session, resolved, timer))
  );
  return {
    ...outcome.body,
    targetModified: outcome.targetsModified,
    outcomeUnknown: outcome.outcomeUnknown,
    commitError: outcome.commitError,
  };
}
