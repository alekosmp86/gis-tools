import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import { buildEjesAnalysisSql } from "../domain/analysisSql";
import { EJES_STEP } from "../domain/plannedSteps";
import { buildCreateRenumberTableSql, LOAD_TEMP, tmp } from "../domain/loadSelectionSql";
import { toEjesAnalysis, toEjesStagingReport } from "../domain/reportMapping";
import { buildStagingChecksSql } from "../domain/stagingSql";
import type { EjesAnalysis, EjesLayouts, EjesStagingReport } from "../types";

export interface EjesAnalysisBody {
  staging: EjesStagingReport;
  analysis: EjesAnalysis;
}

export async function readStagingReport(session: RunSession, layouts: EjesLayouts): Promise<EjesStagingReport> {
  return toEjesStagingReport((await session.query(buildStagingChecksSql(layouts))).rows[0] ?? {});
}

export async function readAnalysis(session: RunSession, layouts: EjesLayouts): Promise<EjesAnalysis> {
  return toEjesAnalysis((await session.query(buildEjesAnalysisSql(layouts))).rows[0] ?? {});
}

/** The real run's analysis: the renumbered and the held pairs are kept in the temp tables the load reads, so the load never classifies again. */
export async function readAnalysisForLoad(session: RunSession, layouts: EjesLayouts): Promise<EjesAnalysis> {
  await session.query(buildCreateRenumberTableSql(LOAD_TEMP.RENUM));
  await session.query(buildCreateRenumberTableSql(LOAD_TEMP.HELD));
  const sinks = { renumbered: tmp(LOAD_TEMP.RENUM), skipped: tmp(LOAD_TEMP.HELD) };
  return toEjesAnalysis((await session.query(buildEjesAnalysisSql(layouts, sinks))).rows[0] ?? {});
}

/** The staging checks and the classification, on the transaction's own snapshot. */
export async function readStagingAndAnalysis(session: RunSession, layouts: EjesLayouts, timer: StepTimer): Promise<EjesAnalysisBody> {
  const staging = await timer.run(EJES_STEP.STAGING, () => readStagingReport(session, layouts));
  // One pg client: the classification reads follow the staging checks.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const analysis = await timer.run(EJES_STEP.ANALYZE, () => readAnalysis(session, layouts));
  return { staging, analysis };
}
