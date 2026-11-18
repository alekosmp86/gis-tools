import { executeSqlInChunks } from "@/core/services/dbExecutionService";
import {
  buildGeometryRepairCountStatement,
  buildGeometryRepairUpdateStatement,
  isRepairableGeometryColumnType,
  isUnsupportedPolygonalColumnType,
  parseGeometryRepairCount,
} from "@/core/services/geometryRepairSql";
import type { DbConfig } from "@/core/types/db";
import {
  GeometryRepairStatus,
  type GeometryRepairColumnOutcome,
  type GeometryRepairOutcome,
} from "@/core/types/replace";

export interface GeometryRepairSettings {
  enabled: boolean;
  decimals: number;
}

interface GeometryRepairExecution {
  errorCount: number;
  targetModified: boolean;
}

type GeometryRepairRun = Omit<GeometryRepairOutcome, "skippedColumns">;

const resolveColumnsMatching = (columnTypes: Record<string, string>, predicate: (columnType: string) => boolean): string[] =>
  Object.keys(columnTypes).filter((column) => predicate(columnTypes[column]));

async function runGeometryRepairColumn(
  targetConfig: DbConfig,
  password: string,
  column: string,
  decimals: number
): Promise<Omit<GeometryRepairColumnOutcome, "column">> {
  const countResult = await executeSqlInChunks(
    targetConfig,
    password,
    buildGeometryRepairCountStatement(targetConfig.schema_name, targetConfig.table_name, column, decimals),
    undefined,
    1
  );
  if (countResult.errorCount > 0) throw new Error(countResult.errors.join(" "));
  const count = parseGeometryRepairCount(countResult.selectResults?.[0]);
  if (!count) throw new Error("el servidor no devolvió el recuento de filas a reparar.");
  if (count.changedRows === 0) return { repairedRows: 0, unrepairableRows: count.unrepairableRows };

  const updateResult = await executeSqlInChunks(
    targetConfig,
    password,
    buildGeometryRepairUpdateStatement(targetConfig.schema_name, targetConfig.table_name, column, decimals),
    undefined,
    1
  );
  if (updateResult.errorCount > 0) throw new Error(updateResult.errors.join(" "));
  return { repairedRows: updateResult.affectedRows, unrepairableRows: count.unrepairableRows };
}

async function repairGeometryColumns(
  targetConfig: DbConfig,
  password: string,
  columns: string[],
  decimals: number
): Promise<GeometryRepairRun> {
  return repairRemainingColumns(targetConfig, password, columns, decimals, []);
}

async function repairRemainingColumns(
  targetConfig: DbConfig,
  password: string,
  pendingColumns: string[],
  decimals: number,
  repairedColumns: GeometryRepairColumnOutcome[]
): Promise<GeometryRepairRun> {
  if (pendingColumns.length === 0) return { status: GeometryRepairStatus.OK, columns: repairedColumns };
  const [column, ...rest] = pendingColumns;
  try {
    const outcome = await runGeometryRepairColumn(targetConfig, password, column, decimals);
    return repairRemainingColumns(targetConfig, password, rest, decimals, [...repairedColumns, { column, ...outcome }]);
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : "Error desconocido";
    return { status: GeometryRepairStatus.FAILED, columns: repairedColumns, message: `columna ${column}: ${detail}` };
  }
}

export async function repairTargetGeometries(
  targetConfig: DbConfig,
  password: string,
  execution: GeometryRepairExecution,
  columnTypes: Record<string, string>,
  settings: GeometryRepairSettings
): Promise<GeometryRepairOutcome> {
  const skippedColumns = resolveColumnsMatching(columnTypes, isUnsupportedPolygonalColumnType);
  if (!settings.enabled) return { status: GeometryRepairStatus.OFF, columns: [], skippedColumns };
  if (execution.errorCount > 0 || !execution.targetModified) {
    return { status: GeometryRepairStatus.SKIPPED, columns: [], skippedColumns };
  }
  const repairableColumns = resolveColumnsMatching(columnTypes, isRepairableGeometryColumnType);
  const run = await repairGeometryColumns(targetConfig, password, repairableColumns, settings.decimals);
  return { ...run, skippedColumns };
}
