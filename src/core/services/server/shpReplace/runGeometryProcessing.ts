import {
  AreaMode,
  BASE_TABLE,
  UNIFIED_TABLE,
  buildBaseTableSql,
  buildConflictCountSql,
  buildConflictSamplesSql,
  buildGroupStatsSql,
  buildIncompatibleGeometryCountSql,
  buildInvalidCountSql,
  buildLargestGroupsSql,
  buildNullKeyCountSql,
  buildOverlapCountSql,
  buildOverlapInputSql,
  buildOverlapSamplesSql,
  buildRepairSql,
  buildUnifySql,
  type ProcessingLayout,
} from "@/core/services/server/shpReplace/geometryProcessingSql";
import { geometryTypeLabelOf } from "@/core/services/geometryReportNotices";
import { stageColumnName } from "@/core/services/server/shpReplace/replaceSql";
import { createStepClock, ProcessingStep } from "@/core/services/server/shpReplace/shpReplaceSteps";
import type { ShpQuerySession } from "@/core/services/server/shpReplace/shpReplaceTypes";
import {
  OverlapPolicy,
  type AttributeConflictSample,
  type GeometryProcessingOptions,
  type GeometryProcessingReport,
  type GroupKeyValues,
  type LargestGroup,
  type OverlapSample,
  type StepTiming,
} from "@/core/types/geometryProcessing";

export interface GeometryProcessingInput {
  readonly processing: GeometryProcessingOptions;
  readonly stageFields: readonly string[];
  readonly mappedFields: readonly string[];
  readonly sourceSrid: number;
  readonly geographic: boolean;
  readonly targetSingleGeometryType: string | null;
  readonly onStep: (label: string) => void;
  readonly now?: () => number;
}

type ProcessingReportCore = Omit<GeometryProcessingReport, "stepTimings" | "processingMs">;

interface ProcessingStepsOutcome {
  readonly workTable: string;
  readonly report: ProcessingReportCore;
}

export interface GeometryProcessingOutcome {
  readonly workTable: string;
  readonly report: GeometryProcessingReport;
}

interface ProcessingContext {
  readonly processing: GeometryProcessingOptions;
  readonly layout: ProcessingLayout;
  readonly comparedColumns: readonly string[];
  readonly dbfNameByColumn: ReadonlyMap<string, string>;
  readonly areaMode: AreaMode;
  readonly targetTypeLabel: string | null;
  readonly onStep: (label: string) => void;
}

interface ValidityStats {
  readonly invalidBefore: number;
  readonly insertedInvalid: number;
  readonly incompatibleGeometryRows: number;
}

interface UnifyStats {
  readonly groups: number;
  readonly rowsMerged: number;
  readonly largestGroups: ReadonlyArray<LargestGroup>;
  readonly attributeConflicts: number;
  readonly attributeConflictSamples: ReadonlyArray<AttributeConflictSample>;
  readonly nullKeyRows: number;
}

interface RepairStats {
  readonly repaired: number;
  readonly emptyAfterRepair: number;
}

interface OverlapStats {
  readonly overlapCount: number;
  readonly overlapSamples: ReadonlyArray<OverlapSample>;
  readonly overlapSkippedInvalid: number;
}

type SqlRow = Record<string, unknown>;

const LARGEST_GROUPS_LIMIT = 10;
const SAMPLE_LIMIT = 20;

const EMPTY_UNIFY_STATS: UnifyStats = {
  groups: 0,
  rowsMerged: 0,
  largestGroups: [],
  attributeConflicts: 0,
  attributeConflictSamples: [],
  nullKeyRows: 0,
};

const EMPTY_REPAIR_STATS: RepairStats = { repaired: 0, emptyAfterRepair: 0 };

const EMPTY_OVERLAP_STATS: OverlapStats = { overlapCount: 0, overlapSamples: [], overlapSkippedInvalid: 0 };

const toText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

const toTextArray = (value: unknown): Array<string | null> => (Array.isArray(value) ? value.map(toText) : []);

const dbfNameOf = (context: ProcessingContext, stageColumn: string): string =>
  context.dbfNameByColumn.get(stageColumn) ?? stageColumn;

function stageColumnOf(stageFields: readonly string[], field: string): string {
  const index = stageFields.indexOf(field);
  if (index < 0) {
    throw new Error(`El campo "${field}" no está en la tabla temporal de procesamiento.`);
  }
  return stageColumnName(index);
}

function buildProcessingContext(input: GeometryProcessingInput): ProcessingContext {
  const { processing, stageFields, mappedFields } = input;
  const keyFields = processing.unify.enabled ? processing.unify.keyFields : [];
  const keyFieldSet = new Set(keyFields);
  return {
    processing,
    layout: {
      stageFields: stageFields.map((_field, index) => stageColumnName(index)),
      keyFields: keyFields.map((field) => stageColumnOf(stageFields, field)),
      sourceSrid: input.sourceSrid,
    },
    comparedColumns: mappedFields
      .filter((field) => !keyFieldSet.has(field))
      .map((field) => stageColumnOf(stageFields, field)),
    dbfNameByColumn: new Map(stageFields.map((field, index) => [stageColumnName(index), field])),
    areaMode: input.geographic ? AreaMode.GEOGRAPHY : AreaMode.PLANAR,
    targetTypeLabel: input.targetSingleGeometryType === null ? null : geometryTypeLabelOf(input.targetSingleGeometryType),
    onStep: input.onStep,
  };
}

async function runStatements(session: ShpQuerySession, statements: readonly string[]): Promise<void> {
  for (const statement of statements) {
    await session.query(statement);
  }
}

async function firstRow(session: ShpQuerySession, sql: string): Promise<SqlRow> {
  const result = await session.query(sql);
  return result.rows[0] ?? {};
}

async function countFirst(session: ShpQuerySession, sql: string): Promise<number> {
  const row = await firstRow(session, sql);
  return Number(Object.values(row)[0] ?? 0);
}

async function rowsOf(session: ShpQuerySession, sql: string): Promise<SqlRow[]> {
  const result = await session.query(sql);
  return result.rows;
}

function keyValuesOf(
  context: ProcessingContext,
  row: SqlRow,
  prefix: string
): GroupKeyValues {
  return Object.fromEntries(
    context.layout.keyFields.map((column) => [dbfNameOf(context, column), toText(row[`${prefix}${column}`])])
  );
}

function toLargestGroup(context: ProcessingContext, row: SqlRow): LargestGroup {
  return { key: keyValuesOf(context, row, ""), size: Number(row.size) };
}

function toConflictSample(context: ProcessingContext, row: SqlRow): AttributeConflictSample {
  const columns = context.comparedColumns
    .map((column, index) => ({
      column: dbfNameOf(context, column),
      distinctValues: toTextArray(row[`distinct_${index}`]),
      keptValue: toText(row[`first_${index}`]),
    }))
    .filter((sample) => sample.distinctValues.length > 1);
  return { key: keyValuesOf(context, row, ""), columns };
}

function toOverlapSample(context: ProcessingContext, row: SqlRow): OverlapSample {
  return {
    recA: Number(row.rec_a),
    recB: Number(row.rec_b),
    area: Number(row.area),
    keyA: keyValuesOf(context, row, "a_"),
    keyB: keyValuesOf(context, row, "b_"),
  };
}

async function runConflicts(
  session: ShpQuerySession,
  context: ProcessingContext
): Promise<Pick<UnifyStats, "attributeConflicts" | "attributeConflictSamples">> {
  const { layout, comparedColumns } = context;
  if (comparedColumns.length === 0) {
    return { attributeConflicts: 0, attributeConflictSamples: [] };
  }
  const attributeConflicts = await countFirst(session, buildConflictCountSql(layout, comparedColumns));
  // One transactional connection: queries serialize and a failure aborts the transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const rows = await rowsOf(session, buildConflictSamplesSql(layout, comparedColumns, SAMPLE_LIMIT));
  return {
    attributeConflicts,
    attributeConflictSamples: rows.map((row) => toConflictSample(context, row)),
  };
}

async function runUnify(session: ShpQuerySession, context: ProcessingContext): Promise<UnifyStats> {
  const { layout } = context;
  context.onStep(ProcessingStep.UNIFY);
  await runStatements(session, [buildUnifySql(layout)]);
  const groupRow = await firstRow(session, buildGroupStatsSql(layout));
  // One transactional connection: queries serialize and a failure aborts the transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const largestRows = await rowsOf(session, buildLargestGroupsSql(layout, LARGEST_GROUPS_LIMIT));
  const conflicts = await runConflicts(session, context);
  // One transactional connection: queries serialize and a failure aborts the transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const nullKeyRows = await countFirst(session, buildNullKeyCountSql(layout));
  return {
    groups: Number(groupRow.groups ?? 0),
    rowsMerged: Number(groupRow.rows_merged ?? 0),
    largestGroups: largestRows.map((row) => toLargestGroup(context, row)),
    ...conflicts,
    nullKeyRows,
  };
}

async function runRepair(session: ShpQuerySession, workTable: string): Promise<RepairStats> {
  const [repairUpdate, repairNull] = buildRepairSql(workTable);
  const repaired = (await session.query(repairUpdate)).rowCount;
  const emptyAfterRepair = (await session.query(repairNull)).rowCount;
  return { repaired, emptyAfterRepair };
}

async function countIncompatible(session: ShpQuerySession, context: ProcessingContext, workTable: string): Promise<number> {
  if (context.targetTypeLabel === null) return 0;
  return countFirst(session, buildIncompatibleGeometryCountSql(workTable));
}

async function runOverlaps(
  session: ShpQuerySession,
  context: ProcessingContext,
  workTable: string,
  insertedInvalid: number
): Promise<OverlapStats> {
  const { layout, processing, areaMode } = context;
  const { minAreaM2 } = processing.overlaps;
  context.onStep(ProcessingStep.OVERLAPS);
  await runStatements(session, buildOverlapInputSql(workTable));
  const overlapCount = await countFirst(session, buildOverlapCountSql(minAreaM2, areaMode));
  // One transactional connection: queries serialize and a failure aborts the transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const rows = await rowsOf(session, buildOverlapSamplesSql(layout, workTable, minAreaM2, areaMode, SAMPLE_LIMIT));
  return {
    overlapCount,
    overlapSamples: rows.map((row) => toOverlapSample(context, row)),
    overlapSkippedInvalid: insertedInvalid,
  };
}

function isBlocking(processing: GeometryProcessingOptions, overlapCount: number): boolean {
  return (
    processing.overlaps.enabled && processing.overlaps.policy === OverlapPolicy.BLOCK && overlapCount > 0
  );
}

function assembleReport(
  context: ProcessingContext,
  validity: ValidityStats,
  unify: UnifyStats,
  repair: RepairStats,
  overlaps: OverlapStats
): ProcessingReportCore {
  return {
    invalidBefore: validity.invalidBefore,
    repaired: repair.repaired,
    emptyAfterRepair: repair.emptyAfterRepair,
    groups: unify.groups,
    rowsMerged: unify.rowsMerged,
    largestGroups: unify.largestGroups,
    attributeConflicts: unify.attributeConflicts,
    attributeConflictSamples: unify.attributeConflictSamples,
    nullKeyRows: unify.nullKeyRows,
    overlapCount: overlaps.overlapCount,
    overlapSamples: overlaps.overlapSamples,
    overlapSkippedInvalid: overlaps.overlapSkippedInvalid,
    insertedInvalid: validity.insertedInvalid,
    incompatibleGeometryRows: validity.incompatibleGeometryRows,
    incompatibleTargetType: validity.incompatibleGeometryRows > 0 ? context.targetTypeLabel : null,
    wouldBlock: isBlocking(context.processing, overlaps.overlapCount),
  };
}

function sumRepairStats(first: RepairStats, second: RepairStats): RepairStats {
  return {
    repaired: first.repaired + second.repaired,
    emptyAfterRepair: first.emptyAfterRepair + second.emptyAfterRepair,
  };
}

async function runBaseRepair(session: ShpQuerySession, context: ProcessingContext): Promise<RepairStats> {
  if (!context.processing.repair.enabled) return EMPTY_REPAIR_STATS;
  context.onStep(ProcessingStep.REPAIR);
  return runRepair(session, BASE_TABLE);
}

async function runUnifiedRepair(session: ShpQuerySession, context: ProcessingContext): Promise<RepairStats> {
  const { processing } = context;
  if (!processing.repair.enabled || !processing.unify.enabled) return EMPTY_REPAIR_STATS;
  context.onStep(ProcessingStep.REPAIR_UNIFIED);
  return runRepair(session, UNIFIED_TABLE);
}

async function runProcessingSteps(
  session: ShpQuerySession,
  input: GeometryProcessingInput
): Promise<ProcessingStepsOutcome> {
  const context = buildProcessingContext(input);
  const { processing, layout } = context;
  context.onStep(ProcessingStep.CONVERT);
  await runStatements(session, [buildBaseTableSql(layout)]);
  const invalidBefore = await countFirst(session, buildInvalidCountSql(BASE_TABLE));
  // One transactional connection: queries serialize and a failure aborts the transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const baseRepair = await runBaseRepair(session, context);
  const workTable = processing.unify.enabled ? UNIFIED_TABLE : BASE_TABLE;
  const unify = processing.unify.enabled ? await runUnify(session, context) : EMPTY_UNIFY_STATS;
  const repair = sumRepairStats(baseRepair, await runUnifiedRepair(session, context));
  context.onStep(ProcessingStep.VALIDITY);
  const incompatibleGeometryRows = await countIncompatible(session, context, workTable);
  // One transactional connection: queries serialize and a failure aborts the transaction.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const insertedInvalid = await countFirst(session, buildInvalidCountSql(workTable));
  const overlaps = processing.overlaps.enabled
    ? await runOverlaps(session, context, workTable, insertedInvalid)
    : EMPTY_OVERLAP_STATS;
  const validity: ValidityStats = { invalidBefore, insertedInvalid, incompatibleGeometryRows };
  return {
    workTable,
    report: assembleReport(context, validity, unify, repair, overlaps),
  };
}

const sumTimingsMs = (timings: ReadonlyArray<StepTiming>): number =>
  timings.reduce((total, timing) => total + timing.ms, 0);

export async function runGeometryProcessing(
  session: ShpQuerySession,
  input: GeometryProcessingInput
): Promise<GeometryProcessingOutcome> {
  const clock = createStepClock(input.now);
  const outcome = await runProcessingSteps(session, {
    ...input,
    onStep: (label) => {
      clock.start(label);
      input.onStep(label);
    },
  });
  const stepTimings = clock.finish();
  return {
    workTable: outcome.workTable,
    report: { ...outcome.report, stepTimings, processingMs: sumTimingsMs(stepTimings) },
  };
}
