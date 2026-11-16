import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import { buildEjesAnalysisSql } from "../domain/analysisSql";
import { EJES_STEP } from "../domain/plannedSteps";
import { buildCreateRenumberTableSql, LOAD_TEMP, tmp } from "../domain/loadSelectionSql";
import { buildCreateMergeTableSql, buildCreatePlainTableSql, buildCreateSplitTableSql } from "../domain/removalSql";
import { buildCreateHeldTableSql } from "../domain/renumberSql";
import { toEjesAnalysis, toEjesStagingReport } from "../domain/reportMapping";
import { buildStagingChecksSql } from "../domain/stagingSql";
import type { EjesAnalysis, EjesLayouts, EjesStagingReport } from "../types";

export interface EjesAnalysisBody {
  staging: EjesStagingReport;
  analysis: EjesAnalysis;
}

const LOAD_SINK_TABLE_SQL: readonly string[] = [
  buildCreateRenumberTableSql(LOAD_TEMP.RENUM),
  buildCreateHeldTableSql(LOAD_TEMP.HELD),
  buildCreateMergeTableSql(LOAD_TEMP.MERGE),
  buildCreatePlainTableSql(LOAD_TEMP.PLAIN),
  buildCreateSplitTableSql(LOAD_TEMP.SPLIT),
];

export async function readStagingReport(session: RunSession, layouts: EjesLayouts): Promise<EjesStagingReport> {
  return toEjesStagingReport((await session.query(buildStagingChecksSql(layouts))).rows[0] ?? {});
}

export async function readAnalysis(session: RunSession, layouts: EjesLayouts): Promise<EjesAnalysis> {
  return toEjesAnalysis((await session.query(buildEjesAnalysisSql(layouts))).rows[0] ?? {});
}

/** The real run's analysis: the renumbered, held, merged and plain pairs are kept in the temp tables the load reads, so the load never classifies again. */
export async function readAnalysisForLoad(session: RunSession, layouts: EjesLayouts): Promise<EjesAnalysis> {
  for (const statement of LOAD_SINK_TABLE_SQL) {
    // One pg client: each sink table is created before the analysis writes into it.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(statement);
  }
  const sinks = {
    renumbered: tmp(LOAD_TEMP.RENUM),
    skipped: tmp(LOAD_TEMP.HELD),
    merged: tmp(LOAD_TEMP.MERGE),
    plain: tmp(LOAD_TEMP.PLAIN),
    split: tmp(LOAD_TEMP.SPLIT),
  };
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
