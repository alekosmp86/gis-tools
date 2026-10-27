import { buildAnalyzeStatement } from "@/core/services/sqlStatements";
import type { ClearMode } from "../../cargar-padrones/constants";
import { sentence } from "../../cargar-padrones/domain/warnings";
import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { PopulateLayouts } from "../domain/layouts";
import { STEP } from "../domain/plannedSteps";
import { buildClearStatement, buildPopulateSql } from "../domain/populateSql";
import type { ReportTotals, ReportView } from "../domain/reportMapping";
import type { RunSession } from "../types";
import { readSkippedReport } from "./readReport";

export interface LoadOutcome {
  written: number;
  report: ReportView;
}

const BEGIN_SQL = "BEGIN ISOLATION LEVEL REPEATABLE READ";
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

async function insertAccepted(session: RunSession, layouts: PopulateLayouts): Promise<number> {
  const result = await session.query(buildPopulateSql(layouts));
  return result.rowCount ?? 0;
}

function assertWrittenMatchesReport(written: number, totals: ReportTotals): void {
  const accepted = totals.rowsRead - totals.skipped;
  if (written !== accepted) {
    throw new Error(`Las filas insertadas (${written}) no coinciden con las filas aceptadas del informe (${accepted}).`);
  }
}

async function runLoadSteps(
  session: RunSession,
  layouts: PopulateLayouts,
  clearMode: ClearMode,
  timer: StepTimer
): Promise<LoadOutcome> {
  await timer.run(STEP.CLEAR, () => session.query(buildClearStatement(layouts.work, clearMode)));
  await timer.run(STEP.RESOLVE, () => Promise.resolve());
  const written = await timer.run(STEP.LOAD, () => insertAccepted(session, layouts));
  await timer.run(STEP.ANALYZE, () => session.query(buildAnalyzeStatement(layouts.work.schema, layouts.work.table)));
  const report = await timer.run(STEP.REPORT, () => readSkippedReport(session, layouts));
  assertWrittenMatchesReport(written, report.totals);
  return { written, report };
}

function rollbackFailure(error: unknown, rolledBack: boolean, secret: string | undefined): Error {
  const reason = sentence(scrubSecret(errorMessageOf(error), secret));
  const outcome = rolledBack
    ? "La tabla de trabajo no fue modificada."
    : "No se pudo revertir la transacción: verifique la tabla de trabajo.";
  return new Error(`No se pudo completar la actualización: ${reason} ${outcome}`);
}

/* Everything up to the report runs in one transaction; any failure before COMMIT rolls it back (AP-19). */
export async function runWriteTransaction(
  session: RunSession,
  clearMode: ClearMode,
  layouts: PopulateLayouts,
  timer: StepTimer,
  secret: string | undefined
): Promise<LoadOutcome> {
  try {
    await session.query(BEGIN_SQL);
    return await runLoadSteps(session, layouts, clearMode, timer);
  } catch (error: unknown) {
    const rolledBack = await rollbackQuietly(session);
    throw rollbackFailure(error, rolledBack, secret);
  }
}
