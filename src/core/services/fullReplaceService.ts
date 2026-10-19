import { DatabaseStreamReader } from "@/core/services/streaming/DatabaseStreamReader";
import { executeSqlInChunks } from "@/core/services/dbExecutionService";
import {
  buildAnalyzeStatement,
  buildResetSequenceStatement,
  buildTruncateStatement,
  formatReplaceLiteral,
  quoteIdentifier,
  resolveSchemaName,
} from "@/core/services/sqlStatements";
import type { SequenceRef } from "@/core/services/replaceSequences";
import { SqlScriptBuilder } from "@/core/workers/comparison/SqlScriptBuilder";
import {
  getIgnoredSourceColumns,
  getMappedSourceColumns,
  isNonTextType,
  resolveInsertColumns,
  type ReplaceColumnMapping,
  type ReplaceInsertColumn,
} from "@/core/services/replaceColumnMapping";
import type { DbConfig, ExecuteChunkProgress } from "@/core/types/db";

export const FULL_REPLACE_BATCH_SIZE = 500;
const BUILD_YIELD_EVERY = 2000;

const FullReplacePhase = {
  FETCH: "fetch",
  BUILD: "build",
  EXECUTE: "execute",
} as const;

type FullReplacePhase = (typeof FullReplacePhase)[keyof typeof FullReplacePhase];

export interface FullReplaceProgress {
  phase: FullReplacePhase;
  label: string;
  current: number;
  total: number;
}

export const AnalyzeStatus = {
  OK: "ok",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

type AnalyzeStatus = (typeof AnalyzeStatus)[keyof typeof AnalyzeStatus];

export interface AnalyzeOutcome {
  status: AnalyzeStatus;
  message?: string;
}

export interface FullReplaceResult {
  sourceRows: number;
  insertedRows: number;
  errorCount: number;
  errors: string[];
  ignoredSourceColumns: string[];
  targetModified: boolean;
  sequencesReset: string[];
  analyze: AnalyzeOutcome;
}

export interface FullReplaceParams {
  sourceConfig: DbConfig;
  targetConfig: DbConfig;
  password: string;
  sourceColumns: string[];
  targetColumns: string[];
  mapping: ReplaceColumnMapping;
  sequencesToReset: SequenceRef[];
  onProgress?: (progress: FullReplaceProgress) => void;
}

interface BuildReplaceStatementsParams {
  targetConfig: DbConfig;
  records: Array<Record<string, unknown>>;
  insertColumns: ReplaceInsertColumn[];
  targetColumnTypes: Record<string, string>;
  targetSrid: number;
  sequences?: SequenceRef[];
  onProgress?: (current: number, total: number) => void;
}

const yieldToMainThread = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const isGeometryType = (dataType?: string): boolean => {
  const lowerType = (dataType ?? "").toLowerCase();
  return lowerType.includes("geometry") || lowerType.includes("geography");
};

function parseGeoJsonValue(value: unknown): object | null {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (candidate && typeof candidate === "object" && "type" in candidate) {
    return candidate;
  }
  return null;
}

export async function buildReplaceStatements(params: BuildReplaceStatementsParams): Promise<string[]> {
  const { targetConfig, records, insertColumns, targetColumnTypes, targetSrid, sequences = [], onProgress } = params;
  const schemaName = resolveSchemaName(targetConfig.schema_name);
  const builder = new SqlScriptBuilder(schemaName, targetConfig.table_name, targetColumnTypes, targetSrid);
  const quotedColumns = insertColumns.map((column) => quoteIdentifier(column.targetColumn));

  const statements: string[] = [
    buildTruncateStatement(targetConfig.schema_name, targetConfig.table_name),
    ...sequences.map(({ schema, name }) => buildResetSequenceStatement(schema, name)),
  ];
  const totalRows = records.length;

  for (let rowIndex = 0; rowIndex < totalRows; rowIndex++) {
    const record = records[rowIndex];
    const values = insertColumns.map(({ targetColumn, sourceColumn, fixedDefault }) => {
      if (!sourceColumn) {
        const defaultValue = fixedDefault?.value.trim() ?? "";
        return fixedDefault?.useRawExpression ? defaultValue : formatReplaceLiteral(defaultValue);
      }
      const rawValue = record[sourceColumn];
      if (isGeometryType(targetColumnTypes[targetColumn])) {
        const geometry = parseGeoJsonValue(rawValue);
        if (geometry) return builder.buildPostgisGeomExpr(geometry, targetColumn, 4326);
      }
      if (rawValue === "" && isNonTextType(targetColumnTypes[targetColumn])) return "NULL";
      return formatReplaceLiteral(rawValue);
    });
    statements.push(builder.buildInsertStatement(quotedColumns, values));

    if ((rowIndex + 1) % BUILD_YIELD_EVERY === 0) {
      onProgress?.(rowIndex + 1, totalRows);
      await yieldToMainThread();
    }
  }

  onProgress?.(totalRows, totalRows);
  return statements;
}

function offsetBatchErrors(errors: string[], batchOffset: number, statementOffset: number): string[] {
  return errors.map((message) =>
    message.replace(
      /^Lote (\d+) \((\d+)-(\d+)\)/,
      (_match, batch: string, start: string, end: string) =>
        `Lote ${Number(batch) + batchOffset} (${Number(start) + statementOffset}-${Number(end) + statementOffset})`
    )
  );
}

async function executeReplaceScript(
  targetConfig: DbConfig,
  password: string,
  statements: string[],
  headerStatementCount: number,
  onProgress?: (progress: ExecuteChunkProgress) => void
): Promise<Pick<FullReplaceResult, "insertedRows" | "errorCount" | "errors" | "targetModified">> {
  const firstBatchStatements = statements.slice(0, FULL_REPLACE_BATCH_SIZE);
  const firstBatch = await executeSqlInChunks(
    targetConfig,
    password,
    firstBatchStatements.join("\n"),
    undefined,
    FULL_REPLACE_BATCH_SIZE
  );

  if (firstBatch.errorCount > 0) {
    return { insertedRows: 0, errorCount: firstBatch.errorCount, errors: firstBatch.errors, targetModified: false };
  }

  const totalStatements = statements.length;
  const insertedFirst = firstBatchStatements.length - headerStatementCount;
  onProgress?.({
    currentBatch: 1,
    totalBatches: Math.ceil(totalStatements / FULL_REPLACE_BATCH_SIZE),
    processedStatements: firstBatchStatements.length,
    totalStatements,
    successCount: firstBatchStatements.length,
    errorCount: 0,
    pct: Math.round((firstBatchStatements.length / totalStatements) * 100),
  });

  let insertedRows = insertedFirst;
  let errorCount = 0;
  const errors: string[] = [];

  try {
    for (let start = FULL_REPLACE_BATCH_SIZE, sliceIndex = 0; start < totalStatements; start += FULL_REPLACE_BATCH_SIZE, sliceIndex++) {
      await yieldToMainThread();
      const end = Math.min(start + FULL_REPLACE_BATCH_SIZE, totalStatements);
      const slice = statements.slice(start, end);
      const result = await executeSqlInChunks(
        targetConfig,
        password,
        slice.join("\n"),
        undefined,
        FULL_REPLACE_BATCH_SIZE
      );
      insertedRows += result.totalProcessed - result.errorCount;
      errorCount += result.errorCount;
      errors.push(...offsetBatchErrors(result.errors, sliceIndex + 1, start));
      onProgress?.({
        currentBatch: sliceIndex + 2,
        totalBatches: Math.ceil(totalStatements / FULL_REPLACE_BATCH_SIZE),
        processedStatements: end,
        totalStatements,
        successCount: end - errorCount,
        errorCount,
        pct: Math.round((end / totalStatements) * 100),
      });
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    errors.push(`La tabla destino ya fue modificada (TRUNCATE aplicado) y el reemplazo quedó incompleto: ${message}`);
    errorCount += 1;
  }

  return { insertedRows, errorCount, errors, targetModified: true };
}

async function analyzeTarget(
  targetConfig: DbConfig,
  password: string,
  execution: Pick<FullReplaceResult, "errorCount" | "targetModified">
): Promise<AnalyzeOutcome> {
  if (execution.errorCount > 0 || !execution.targetModified) return { status: AnalyzeStatus.SKIPPED };
  try {
    const result = await executeSqlInChunks(
      targetConfig,
      password,
      buildAnalyzeStatement(targetConfig.schema_name, targetConfig.table_name),
      undefined,
      1
    );
    if (result.errorCount > 0) return { status: AnalyzeStatus.FAILED, message: result.errors.join(" ") };
    return { status: AnalyzeStatus.OK };
  } catch (error: unknown) {
    return { status: AnalyzeStatus.FAILED, message: error instanceof Error ? error.message : "Error desconocido" };
  }
}

export async function runFullReplace(params: FullReplaceParams): Promise<FullReplaceResult> {
  const { sourceConfig, targetConfig, password, sourceColumns, targetColumns, mapping, sequencesToReset, onProgress } = params;
  const emit = (phase: FullReplacePhase, label: string, current: number, total: number) =>
    onProgress?.({ phase, label, current, total });

  const insertColumns = resolveInsertColumns(mapping, targetColumns);
  if (insertColumns.length === 0) {
    throw new Error("No hay columnas mapeadas: defina al menos una columna destino para insertar.");
  }
  const mappedSourceColumns = getMappedSourceColumns(insertColumns);
  if (mappedSourceColumns.length === 0) {
    throw new Error("Ninguna columna destino tiene una columna de origen asignada: la tabla destino no fue modificada.");
  }

  const [targetMeta, source] = await Promise.all([
    DatabaseStreamReader.fetchOrStreamRecords(targetConfig, undefined, undefined, { limit: 1 }),
    DatabaseStreamReader.fetchOrStreamRecords(
      sourceConfig,
      { suidColumns: [], fieldsToCompare: mappedSourceColumns },
      (label, current, total) => emit(FullReplacePhase.FETCH, label, current, total),
      { rawValues: true }
    ),
  ]);

  if (source.records.length !== source.totalCount) {
    throw new Error(
      `La lectura del origen quedó incompleta (${source.records.length} de ${source.totalCount} registros). La tabla destino no fue modificada.`
    );
  }

  if (source.records.length === 0) {
    throw new Error("El origen no tiene registros: la tabla destino no fue modificada.");
  }

  const statements = await buildReplaceStatements({
    targetConfig,
    records: source.records,
    insertColumns,
    targetColumnTypes: targetMeta.columnTypes,
    targetSrid: targetMeta.detectedSrid,
    sequences: sequencesToReset,
    onProgress: (current, total) => emit(FullReplacePhase.BUILD, "Generando sentencias INSERT...", current, total),
  });

  emit(FullReplacePhase.EXECUTE, "Ejecutando reemplazo en la tabla destino...", 0, statements.length);
  const execution = await executeReplaceScript(targetConfig, password, statements, 1 + sequencesToReset.length, (progress) =>
    emit(FullReplacePhase.EXECUTE, "Ejecutando reemplazo en la tabla destino...", progress.processedStatements, progress.totalStatements)
  );

  if (execution.errorCount === 0 && execution.targetModified) {
    emit(FullReplacePhase.EXECUTE, "Actualizando estadísticas (ANALYZE)...", statements.length, statements.length);
  }
  const analyze = await analyzeTarget(targetConfig, password, execution);

  return {
    sourceRows: source.records.length,
    ignoredSourceColumns: getIgnoredSourceColumns(insertColumns, sourceColumns),
    sequencesReset: execution.targetModified ? sequencesToReset.map((sequence) => sequence.qualifiedLabel) : [],
    analyze,
    ...execution,
  };
}
