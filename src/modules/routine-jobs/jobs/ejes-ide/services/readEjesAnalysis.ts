import type { StepTimer } from "../../cargar-padrones/services/runSteps";
import type { RunSession } from "../../cargar-padrones/types";
import { buildAnalysisWorkMemSql, buildEjesAnalysisSql } from "../domain/analysisSql";
import { EJES_STEP } from "../domain/plannedSteps";
import { buildCreateRenumberTableSql, LOAD_TEMP, tmp } from "../domain/loadSelectionSql";
import { buildCreateMergeTableSql, buildCreatePlainTableSql, buildCreateSplitTableSql } from "../domain/removalSql";
import { buildCreateDroppedTableSql, buildCreateHeldTableSql } from "../domain/renumberSql";
import { buildCreateSplitPointTableSql } from "../domain/splitPointSql";
import { buildCreateGeoTwinTableSql } from "../domain/geoTwinSql";
import { toEjesAnalysis, toEjesStagingReport } from "../domain/reportMapping";
import { buildStagingChecksSql } from "../domain/stagingSql";
import type { EjesAnalysis, EjesLayouts, EjesManualSplit, EjesStagingReport, EjesTwinPick } from "../types";

export interface EjesAnalysisBody {
  staging: EjesStagingReport;
  analysis: EjesAnalysis;
}

const LOAD_SINK_TABLE_SQL: readonly string[] = [
  buildCreateRenumberTableSql(LOAD_TEMP.RENUM),
  buildCreateHeldTableSql(LOAD_TEMP.HELD),
  buildCreateDroppedTableSql(LOAD_TEMP.DROPPED),
  buildCreateMergeTableSql(LOAD_TEMP.MERGE),
  buildCreatePlainTableSql(LOAD_TEMP.PLAIN),
  buildCreateSplitTableSql(LOAD_TEMP.SPLIT),
  buildCreateSplitPointTableSql(LOAD_TEMP.SPLIT_PTS),
  buildCreateGeoTwinTableSql(LOAD_TEMP.GEO_TWIN),
];

export async function readStagingReport(session: RunSession, layouts: EjesLayouts): Promise<EjesStagingReport> {
  return toEjesStagingReport((await session.query(buildStagingChecksSql(layouts))).rows[0] ?? {});
}

async function readAnalysis(
  session: RunSession,
  layouts: EjesLayouts,
  twinPicks: readonly EjesTwinPick[] = [],
  manualSplits: readonly EjesManualSplit[] = []
): Promise<EjesAnalysis> {
  await session.query(buildAnalysisWorkMemSql());
  return toEjesAnalysis((await session.query(buildEjesAnalysisSql(layouts, undefined, twinPicks, manualSplits))).rows[0] ?? {});
}

/** The real run's analysis: the renumbered, held, merged and plain pairs are kept in the temp tables the load reads, so the load never classifies again. */
export async function readAnalysisForLoad(
  session: RunSession,
  layouts: EjesLayouts,
  twinPicks: readonly EjesTwinPick[],
  manualSplits: readonly EjesManualSplit[]
): Promise<EjesAnalysis> {
  for (const statement of LOAD_SINK_TABLE_SQL) {
    // One pg client: each sink table is created before the analysis writes into it.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await session.query(statement);
  }
  const sinks = {
    renumbered: tmp(LOAD_TEMP.RENUM),
    skipped: tmp(LOAD_TEMP.HELD),
    dropped: tmp(LOAD_TEMP.DROPPED),
    merged: tmp(LOAD_TEMP.MERGE),
    plain: tmp(LOAD_TEMP.PLAIN),
    split: tmp(LOAD_TEMP.SPLIT),
    splitPoints: tmp(LOAD_TEMP.SPLIT_PTS),
    geoTwins: tmp(LOAD_TEMP.GEO_TWIN),
  };
  await session.query(buildAnalysisWorkMemSql());
  return toEjesAnalysis((await session.query(buildEjesAnalysisSql(layouts, sinks, twinPicks, manualSplits))).rows[0] ?? {});
}

/** The staging checks and the classification, on the transaction's own snapshot. */
export async function readStagingAndAnalysis(
  session: RunSession,
  layouts: EjesLayouts,
  timer: StepTimer,
  twinPicks: readonly EjesTwinPick[],
  manualSplits: readonly EjesManualSplit[]
): Promise<EjesAnalysisBody> {
  const staging = await timer.run(EJES_STEP.STAGING, () => readStagingReport(session, layouts));
  // One pg client: the classification reads follow the staging checks.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const analysis = await timer.run(EJES_STEP.ANALYZE, () => readAnalysis(session, layouts, twinPicks, manualSplits));
  return { staging, analysis };
}
