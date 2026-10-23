import {
  buildAnalyzeStatement,
  buildDeleteStatement,
  buildRepairSequenceStatement,
  buildResetSequenceStatement,
  quoteIdentifier,
  resolveSchemaName,
} from "@/core/services/sqlStatements";
import { isProcessingActive } from "@/core/services/geometryProcessingOptions";
import { incompatibleGeometryText } from "@/core/services/geometryReportNotices";
import { AnalyzeStatus, type AnalyzeOutcome, type SequenceAdjustment } from "@/core/types/replace";
import { discoverTargetSequences, type SequenceRef } from "@/core/services/replaceSequences";
import { resolveInsertColumns } from "@/core/services/replaceColumnMapping";
import {
  buildCopySql,
  buildCreateStageSql,
  buildInsertSelectSql,
  GeometrySourceKind,
  STAGE_TABLE,
  type InsertSource,
} from "@/core/services/server/shpReplace/replaceSql";
import { encodeCopyRow } from "@/core/services/server/shpReplace/copyText";
import type { OpenShapefile, ShpRecordRow } from "@/core/services/server/shpReplace/shpRecordSource";
import {
  buildReplacePlan,
  loadTargetCatalog,
  type ReplacePlan,
  type TargetCatalog,
} from "@/core/services/server/shpReplace/shpReplaceCatalog";
import { runGeometryProcessing, type GeometryProcessingInput } from "@/core/services/server/shpReplace/runGeometryProcessing";
import {
  buildProcessingStepPlan,
  FINALIZE_STEP_PLAN,
  FinalizeStep,
  SWAP_STEP_PLAN,
  SwapStep,
} from "@/core/services/server/shpReplace/shpReplaceSteps";
import {
  ShpCommitUncertainError,
  ShpProcessingBlockedError,
  ShpReplacePhase,
  type RunShpReplaceParams,
  type ShpQuerySession,
  type ShpReplaceProgress,
  type ShpReplaceResult,
  type ShpReplaceSession,
  type ShpReplaceSessionOpener,
  type ShpReplaceTarget,
} from "@/core/services/server/shpReplace/shpReplaceTypes";
import type { GeometryProcessingOptions, GeometryProcessingReport } from "@/core/types/geometryProcessing";

export { ShpReplacePhase } from "@/core/services/server/shpReplace/shpReplaceTypes";
export type {
  RunShpReplaceParams,
  ShpReplaceProgress,
  ShpReplaceSession,
} from "@/core/services/server/shpReplace/shpReplaceTypes";

const STAGE_PROGRESS_STEPS = 100;

interface PreparedRows {
  rows: number;
  insertSource?: InsertSource;
  geometry?: GeometryProcessingReport;
}

type SwapOutcome = Omit<ShpReplaceResult, "dryRun" | "targetModified" | "analyze">;

const errorMessageOf = (error: unknown): string => (error instanceof Error ? error.message : "Error desconocido");

const toReplaceError = (error: unknown): Error =>
  new Error(`No se pudo completar el reemplazo: ${errorMessageOf(error)}. La tabla destino no fue modificada.`);

const toFailure = (error: unknown): Error =>
  error instanceof ShpProcessingBlockedError ? error : toReplaceError(error);

const toCommitUncertainError = (error: unknown): ShpCommitUncertainError =>
  new ShpCommitUncertainError(
    `No se pudo confirmar si el reemplazo se aplicó: ${errorMessageOf(error)}. Verifique el contenido de la tabla destino antes de reintentar.`
  );

const blockedMessageOf = (report: GeometryProcessingReport): string =>
  `Se detectaron ${report.overlapCount} solapes entre geometrías y la política es bloquear. El reemplazo no se realizó y la tabla destino no fue modificada.`;

const qualifiedTableOf = (target: ShpReplaceTarget): string =>
  `${quoteIdentifier(resolveSchemaName(target.schema_name))}.${quoteIdentifier(target.table_name)}`;

const emitProgress = (params: RunShpReplaceParams, progress: ShpReplaceProgress): void => {
  params.onProgress?.(progress);
};

const emitStep = (params: RunShpReplaceParams, phase: ShpReplacePhase, steps: readonly string[], detail: string): void =>
  emitProgress(params, { phase, current: steps.indexOf(detail) + 1, total: steps.length, detail });

const activeProcessingOf = (params: RunShpReplaceParams): GeometryProcessingOptions | undefined =>
  params.processing && isProcessingActive(params.processing) ? params.processing : undefined;

function assertReadableShapefile(shapefile: OpenShapefile): void {
  if (shapefile.recordCount === 0) {
    throw new Error("El archivo no contiene registros.");
  }
  if (shapefile.shapeRecordCount !== shapefile.recordCount) {
    throw new Error(
      `El .shp tiene ${shapefile.shapeRecordCount} registros y el .dbf tiene ${shapefile.recordCount}: los archivos no coinciden.`
    );
  }
}

function assertUnifyTargetIsMulti(processing: GeometryProcessingOptions, catalog: TargetCatalog): void {
  if (processing.unify.enabled && catalog.geometry !== undefined && !catalog.acceptsMulti) {
    throw new Error(
      "Unificar geometrías requiere que la columna geométrica destino sea de tipo MultiPolígono. Cambie la columna destino o desactive la unificación."
    );
  }
}

function assertProcessingGeometry(processing: GeometryProcessingOptions | undefined, catalog: TargetCatalog): void {
  if (processing && catalog.geometry === undefined) {
    throw new Error(
      "El procesamiento de geometrías requiere mapear una columna destino a la geometría del SHP."
    );
  }
  if (processing) {
    assertUnifyTargetIsMulti(processing, catalog);
  }
}

async function countRows(session: ShpQuerySession, qualifiedTable: string): Promise<number> {
  const result = await session.query(`SELECT count(*) AS count FROM ${qualifiedTable}`);
  return Number(result.rows[0]?.count);
}

function buildCopyCells(row: ShpRecordRow, stageFields: string[], hasGeometry: boolean): Array<string | null> {
  const fieldCells = stageFields.map((field) => row.values[field] ?? null);
  return [String(row.rec), ...fieldCells, ...(hasGeometry ? [row.geometryJson] : [])];
}

function* buildCopyLines(params: RunShpReplaceParams, plan: ReplacePlan): Generator<string, void, undefined> {
  const total = params.shapefile.recordCount;
  const step = Math.max(1, Math.ceil(total / STAGE_PROGRESS_STEPS));
  const hasGeometry = plan.geometry !== undefined;
  let current = 0;
  for (const row of params.shapefile.records()) {
    current += 1;
    yield encodeCopyRow(buildCopyCells(row, plan.stageFields, hasGeometry));
    if (current % step === 0) {
      emitProgress(params, { phase: ShpReplacePhase.STAGING, current, total });
    }
  }
  emitProgress(params, { phase: ShpReplacePhase.STAGING, current, total });
}

async function assertStagedRows(session: ShpQuerySession, copiedRows: number): Promise<void> {
  const stagedRows = await countRows(session, quoteIdentifier(STAGE_TABLE));
  if (stagedRows !== copiedRows) {
    throw new Error(`La tabla temporal tiene ${stagedRows} filas y se copiaron ${copiedRows}.`);
  }
  if (copiedRows === 0) {
    throw new Error("El archivo no contiene registros activos.");
  }
}

async function stageRecords(session: ShpReplaceSession, params: RunShpReplaceParams, plan: ReplacePlan): Promise<number> {
  const hasGeometry = plan.geometry !== undefined;
  await session.query(buildCreateStageSql(plan.stageFields.length, hasGeometry));
  const copiedRows = await session.copyIn(
    buildCopySql(plan.stageFields.length, hasGeometry),
    buildCopyLines(params, plan)
  );
  await assertStagedRows(session, copiedRows);
  return copiedRows;
}

const singleGeometryTypeOf = (catalog: TargetCatalog): string | null =>
  catalog.geometry !== undefined && !catalog.acceptsMulti ? (catalog.geometryTypeName ?? null) : null;

function buildProcessingInput(
  params: RunShpReplaceParams,
  plan: ReplacePlan,
  catalog: TargetCatalog,
  processing: GeometryProcessingOptions
): GeometryProcessingInput {
  const steps = buildProcessingStepPlan(processing);
  return {
    processing,
    stageFields: plan.stageFields,
    mappedFields: plan.mappedFields,
    sourceSrid: params.sourceSrid,
    geographic: catalog.sourceGeographic,
    targetSingleGeometryType: singleGeometryTypeOf(catalog),
    onStep: (label) => emitStep(params, ShpReplacePhase.PROCESSING, steps, label),
    now: params.now,
  };
}

async function processStagedRows(
  session: ShpReplaceSession,
  params: RunShpReplaceParams,
  plan: ReplacePlan,
  catalog: TargetCatalog,
  processing: GeometryProcessingOptions
): Promise<PreparedRows> {
  const outcome = await runGeometryProcessing(session, buildProcessingInput(params, plan, catalog, processing));
  const rows = await countRows(session, quoteIdentifier(outcome.workTable));
  return {
    rows,
    insertSource: { table: outcome.workTable, geometry: GeometrySourceKind.NATIVE },
    geometry: outcome.report,
  };
}

async function swapTargetRows(
  session: ShpReplaceSession,
  params: RunShpReplaceParams,
  plan: ReplacePlan,
  prepared: PreparedRows
): Promise<Pick<SwapOutcome, "previousRows" | "insertedRows">> {
  const { target } = params;
  const qualifiedTable = qualifiedTableOf(target);
  emitStep(params, ShpReplacePhase.SWAPPING, SWAP_STEP_PLAN, SwapStep.LOCK);
  await session.query(`LOCK TABLE ${qualifiedTable} IN SHARE ROW EXCLUSIVE MODE`);
  const previousRows = await countRows(session, qualifiedTable);
  emitStep(params, ShpReplacePhase.SWAPPING, SWAP_STEP_PLAN, SwapStep.DELETE);
  await session.query(buildDeleteStatement(target.schema_name, target.table_name));
  emitStep(params, ShpReplacePhase.SWAPPING, SWAP_STEP_PLAN, SwapStep.INSERT);
  const insertResult = await session.query(
    buildInsertSelectSql(target.schema_name, target.table_name, plan.insertColumns, plan.geometry, prepared.insertSource)
  );
  if (insertResult.rowCount !== prepared.rows) {
    throw new Error(`Se insertaron ${insertResult.rowCount} filas de ${prepared.rows} preparadas.`);
  }
  return { previousRows, insertedRows: insertResult.rowCount };
}

async function resetUnmappedSequences(session: ShpQuerySession, sequences: SequenceRef[]): Promise<void> {
  for (const sequence of sequences) {
    await session.query(buildResetSequenceStatement(sequence.schema, sequence.name));
  }
}

async function repairSequence(
  session: ShpQuerySession,
  target: ShpReplaceTarget,
  sequence: SequenceRef,
  resetToStart: boolean
): Promise<SequenceAdjustment> {
  const result = await session.query(
    buildRepairSequenceStatement(sequence.schema, sequence.name, target.schema_name, target.table_name, sequence.columns)
  );
  const nextValue = Number(Object.values(result.rows[0] ?? {})[0]);
  if (!Number.isFinite(nextValue)) {
    throw new Error(`No se pudo ajustar la secuencia ${sequence.qualifiedLabel}.`);
  }
  return { qualifiedLabel: sequence.qualifiedLabel, nextValue, resetToStart };
}

function resolveSequences(params: RunShpReplaceParams, catalog: TargetCatalog): SequenceRef[] {
  if (params.sequences) return params.sequences;
  const insertColumns = resolveInsertColumns(
    params.mapping,
    catalog.columns.map((column) => column.column_name)
  );
  return discoverTargetSequences(catalog.columns, insertColumns, params.target.schema_name).sequences;
}

async function adjustSequences(
  session: ShpQuerySession,
  params: RunShpReplaceParams,
  sequences: SequenceRef[]
): Promise<SequenceAdjustment[]> {
  const { target, resetSequences } = params;
  emitStep(params, ShpReplacePhase.FINALIZING, FINALIZE_STEP_PLAN, FinalizeStep.ADJUST_SEQUENCES);
  if (resetSequences) {
    await resetUnmappedSequences(session, sequences.filter((sequence) => !sequence.mapped));
  }
  const repairTargets = resetSequences ? sequences : sequences.filter((sequence) => sequence.mapped);
  const adjusted: SequenceAdjustment[] = [];
  for (const sequence of repairTargets) {
    adjusted.push(await repairSequence(session, target, sequence, resetSequences && !sequence.mapped));
  }
  return adjusted;
}

function assertNotBlocked(geometry: GeometryProcessingReport | undefined): void {
  if (geometry?.wouldBlock) {
    throw new ShpProcessingBlockedError(blockedMessageOf(geometry), geometry);
  }
}

function assertNoIncompatibleGeometries(geometry: GeometryProcessingReport | undefined): void {
  if (geometry && geometry.incompatibleGeometryRows > 0) {
    throw new Error(incompatibleGeometryText(geometry.incompatibleGeometryRows, geometry.incompatibleTargetType));
  }
}

async function swapAndFinalize(
  session: ShpReplaceSession,
  params: RunShpReplaceParams,
  plan: ReplacePlan,
  sequences: SequenceRef[],
  prepared: PreparedRows
): Promise<SwapOutcome> {
  assertNoIncompatibleGeometries(prepared.geometry);
  assertNotBlocked(prepared.geometry);
  const { previousRows, insertedRows } = await swapTargetRows(session, params, plan, prepared);
  // Ordered statements on one transactional connection: sequences are repaired after the rows are swapped.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const sequencesAdjusted = await adjustSequences(session, params, sequences);
  return {
    sourceRows: params.shapefile.recordCount,
    stagedRows: prepared.rows,
    previousRows,
    insertedRows,
    sequencesAdjusted,
    geometry: prepared.geometry,
  };
}

async function measureDryRun(
  session: ShpQuerySession,
  params: RunShpReplaceParams,
  prepared: PreparedRows
): Promise<SwapOutcome> {
  const previousRows = await countRows(session, qualifiedTableOf(params.target));
  return {
    sourceRows: params.shapefile.recordCount,
    stagedRows: prepared.rows,
    previousRows,
    insertedRows: 0,
    sequencesAdjusted: [],
    geometry: prepared.geometry,
  };
}

async function replaceRows(session: ShpReplaceSession, params: RunShpReplaceParams): Promise<SwapOutcome> {
  assertReadableShapefile(params.shapefile);
  const catalog = await loadTargetCatalog(session, params);
  const processing = activeProcessingOf(params);
  assertProcessingGeometry(processing, catalog);
  const plan = buildReplacePlan(params, catalog);
  const sequences = resolveSequences(params, catalog);
  const stagedRows = await stageRecords(session, params, plan);
  const prepared: PreparedRows = processing
    ? await processStagedRows(session, params, plan, catalog, processing)
    : { rows: stagedRows };
  return params.dryRun
    ? measureDryRun(session, params, prepared)
    : swapAndFinalize(session, params, plan, sequences, prepared);
}

async function rollbackQuietly(session: ShpQuerySession): Promise<void> {
  await session.query("ROLLBACK").catch(() => undefined);
}

async function replaceSafely(session: ShpReplaceSession, params: RunShpReplaceParams): Promise<SwapOutcome> {
  try {
    await session.query("BEGIN");
    return await replaceRows(session, params);
  } catch (error: unknown) {
    await rollbackQuietly(session);
    throw toFailure(error);
  }
}

async function commitOrFail(session: ShpReplaceSession, params: RunShpReplaceParams): Promise<void> {
  emitStep(params, ShpReplacePhase.FINALIZING, FINALIZE_STEP_PLAN, FinalizeStep.COMMIT);
  try {
    await session.query("COMMIT");
  } catch (error: unknown) {
    throw toCommitUncertainError(error);
  }
}

async function analyzeTarget(session: ShpQuerySession, target: ShpReplaceTarget): Promise<AnalyzeOutcome> {
  try {
    await session.query(buildAnalyzeStatement(target.schema_name, target.table_name));
    return { status: AnalyzeStatus.OK };
  } catch (error: unknown) {
    return { status: AnalyzeStatus.FAILED, message: errorMessageOf(error) };
  }
}

async function replaceInTransaction(session: ShpReplaceSession, params: RunShpReplaceParams): Promise<ShpReplaceResult> {
  const outcome = await replaceSafely(session, params);
  if (params.dryRun) {
    await rollbackQuietly(session);
    return { ...outcome, dryRun: true, targetModified: false, analyze: { status: AnalyzeStatus.SKIPPED } };
  }
  await commitOrFail(session, params);
  emitStep(params, ShpReplacePhase.FINALIZING, FINALIZE_STEP_PLAN, FinalizeStep.ANALYZE);
  const analyze = await analyzeTarget(session, params.target);
  return { ...outcome, dryRun: false, targetModified: true, analyze };
}

export async function runShpReplace(
  openSession: ShpReplaceSessionOpener,
  params: RunShpReplaceParams
): Promise<ShpReplaceResult> {
  const session = await openSession();
  try {
    return await replaceInTransaction(session, params);
  } finally {
    await session.close();
  }
}
