import {
  buildAnalyzeStatement,
  buildDeleteStatement,
  buildRepairSequenceStatement,
  buildResetSequenceStatement,
  quoteIdentifier,
  resolveSchemaName,
} from "@/core/services/sqlStatements";
import { AnalyzeStatus, type AnalyzeOutcome, type SequenceAdjustment } from "@/core/types/replace";
import { discoverTargetSequences, type SequenceRef } from "@/core/services/replaceSequences";
import { resolveInsertColumns } from "@/core/services/replaceColumnMapping";
import {
  buildCopySql,
  buildCreateStageSql,
  buildInsertSelectSql,
  STAGE_TABLE,
} from "@/core/services/server/shpReplace/replaceSql";
import { encodeCopyRow } from "@/core/services/server/shpReplace/copyText";
import type { OpenShapefile, ShpRecordRow } from "@/core/services/server/shpReplace/shpRecordSource";
import {
  buildReplacePlan,
  loadTargetCatalog,
  type ReplacePlan,
  type TargetCatalog,
} from "@/core/services/server/shpReplace/shpReplaceCatalog";
import {
  ShpCommitUncertainError,
  ShpReplacePhase,
  type RunShpReplaceParams,
  type ShpQuerySession,
  type ShpReplaceProgress,
  type ShpReplaceResult,
  type ShpReplaceSession,
  type ShpReplaceSessionOpener,
  type ShpReplaceTarget,
} from "@/core/services/server/shpReplace/shpReplaceTypes";

export { ShpReplacePhase } from "@/core/services/server/shpReplace/shpReplaceTypes";
export type {
  RunShpReplaceParams,
  ShpReplaceProgress,
  ShpReplaceSession,
} from "@/core/services/server/shpReplace/shpReplaceTypes";

const STAGE_PROGRESS_STEPS = 100;

type SwapOutcome = Omit<ShpReplaceResult, "targetModified" | "analyze">;

const errorMessageOf = (error: unknown): string => (error instanceof Error ? error.message : "Error desconocido");

const toReplaceError = (error: unknown): Error =>
  new Error(`No se pudo completar el reemplazo: ${errorMessageOf(error)}. La tabla destino no fue modificada.`);

const toCommitUncertainError = (error: unknown): ShpCommitUncertainError =>
  new ShpCommitUncertainError(
    `No se pudo confirmar si el reemplazo se aplicó: ${errorMessageOf(error)}. Verifique el contenido de la tabla destino antes de reintentar.`
  );

const qualifiedTableOf = (target: ShpReplaceTarget): string =>
  `${quoteIdentifier(resolveSchemaName(target.schema_name))}.${quoteIdentifier(target.table_name)}`;

const emitProgress = (params: RunShpReplaceParams, progress: ShpReplaceProgress): void => {
  params.onProgress?.(progress);
};

const emitPhase = (params: RunShpReplaceParams, phase: ShpReplacePhase): void =>
  emitProgress(params, { phase, current: 0, total: 0 });

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

async function swapTargetRows(
  session: ShpReplaceSession,
  params: RunShpReplaceParams,
  plan: ReplacePlan,
  stagedRows: number
): Promise<Pick<SwapOutcome, "previousRows" | "insertedRows">> {
  const { target } = params;
  const qualifiedTable = qualifiedTableOf(target);
  await session.query(`LOCK TABLE ${qualifiedTable} IN SHARE ROW EXCLUSIVE MODE`);
  const previousRows = await countRows(session, qualifiedTable);
  await session.query(buildDeleteStatement(target.schema_name, target.table_name));
  const insertResult = await session.query(
    buildInsertSelectSql(target.schema_name, target.table_name, plan.insertColumns, plan.geometry)
  );
  if (insertResult.rowCount !== stagedRows) {
    throw new Error(`Se insertaron ${insertResult.rowCount} filas de ${stagedRows} preparadas.`);
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

async function replaceRows(session: ShpReplaceSession, params: RunShpReplaceParams): Promise<SwapOutcome> {
  assertReadableShapefile(params.shapefile);
  const catalog = await loadTargetCatalog(session, params);
  const plan = buildReplacePlan(params, catalog);
  const sequences = resolveSequences(params, catalog);
  const stagedRows = await stageRecords(session, params, plan);
  emitPhase(params, ShpReplacePhase.SWAPPING);
  const { previousRows, insertedRows } = await swapTargetRows(session, params, plan, stagedRows);
  emitPhase(params, ShpReplacePhase.FINALIZING);
  const sequencesAdjusted = await adjustSequences(session, params, sequences);
  return {
    sourceRows: params.shapefile.recordCount,
    stagedRows,
    previousRows,
    insertedRows,
    sequencesAdjusted,
  };
}

async function commitOrFail(session: ShpReplaceSession): Promise<void> {
  try {
    await session.query("COMMIT");
  } catch (error: unknown) {
    throw toCommitUncertainError(error);
  }
}

async function replaceInTransaction(session: ShpReplaceSession, params: RunShpReplaceParams): Promise<SwapOutcome> {
  let outcome: SwapOutcome;
  try {
    await session.query("BEGIN");
    outcome = await replaceRows(session, params);
  } catch (error: unknown) {
    await session.query("ROLLBACK").catch(() => undefined);
    throw toReplaceError(error);
  }
  await commitOrFail(session);
  return outcome;
}

async function analyzeTarget(session: ShpQuerySession, target: ShpReplaceTarget): Promise<AnalyzeOutcome> {
  try {
    await session.query(buildAnalyzeStatement(target.schema_name, target.table_name));
    return { status: AnalyzeStatus.OK };
  } catch (error: unknown) {
    return { status: AnalyzeStatus.FAILED, message: errorMessageOf(error) };
  }
}

export async function runShpReplace(
  openSession: ShpReplaceSessionOpener,
  params: RunShpReplaceParams
): Promise<ShpReplaceResult> {
  const session = await openSession();
  try {
    const swapped = await replaceInTransaction(session, params);
    const analyze = await analyzeTarget(session, params.target);
    return { ...swapped, targetModified: true, analyze };
  } finally {
    await session.close();
  }
}
