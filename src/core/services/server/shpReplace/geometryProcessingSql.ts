import { quoteIdentifier } from "@/core/services/sqlStatements";
import {
  GEOMETRY_STAGE_COLUMN,
  PROCESSED_GEOMETRY_COLUMN,
  STAGE_RECORD_COLUMN,
  STAGE_TABLE,
  assertSafeSridNumber,
} from "@/core/services/server/shpReplace/replaceSql";

export const BASE_TABLE = "shp_proc_base";
export const UNIFIED_TABLE = "shp_proc_unified";
export const OVERLAP_TABLE = "shp_proc_overlap";

const MAX_CONFLICT_VALUES = 5;
const MULTI_RECORD_GROUP_FILTER = "HAVING count(*) > 1";

export const AreaMode = {
  PLANAR: "planar",
  GEOGRAPHY: "geography",
} as const;

export type AreaMode = (typeof AreaMode)[keyof typeof AreaMode];

export interface ProcessingLayout {
  readonly stageFields: readonly string[];
  readonly keyFields: readonly string[];
  readonly sourceSrid: number;
}

const quoteList = (names: readonly string[]): string => names.map((name) => quoteIdentifier(name)).join(", ");

const assertStageField = (name: string, layout: ProcessingLayout): void => {
  if (!layout.stageFields.includes(name)) {
    throw new Error(`La columna "${name}" no existe en el stage de procesamiento.`);
  }
};

const assertKeyFields = (layout: ProcessingLayout): void => {
  if (layout.keyFields.length === 0) {
    throw new Error("Unificar por clave requiere al menos un campo clave.");
  }
  layout.keyFields.forEach((keyField) => assertStageField(keyField, layout));
};

const assertCompareColumns = (compareColumns: readonly string[], layout: ProcessingLayout): void => {
  if (compareColumns.length === 0) {
    throw new Error("No hay columnas que comparar entre los registros unificados.");
  }
  compareColumns.forEach((column) => assertStageField(column, layout));
};

const assertSafeLimit = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("El límite debe ser un entero no negativo.");
  }
  return value;
};

const assertSafeMinAreaM2 = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("El área mínima de solape debe ser un número finito no negativo.");
  }
  return value;
};

const buildAreaExpression = (mode: AreaMode): string => {
  switch (mode) {
    case AreaMode.PLANAR:
      return "ST_Area(ST_Intersection(a.geom, b.geom))";
    case AreaMode.GEOGRAPHY:
      return "ST_Area(ST_Intersection(a.geom, b.geom)::geography)";
  }
};

const buildAboveThreshold = (minAreaM2: number, mode: AreaMode): string =>
  `${buildAreaExpression(mode)} > ${assertSafeMinAreaM2(minAreaM2)}`;

const buildOverlapPairsFrom = (): string =>
  `FROM ${quoteIdentifier(OVERLAP_TABLE)} a JOIN ${quoteIdentifier(OVERLAP_TABLE)} b ON a.rec < b.rec AND a.geom && b.geom AND ST_Intersects(a.geom, b.geom)`;

const buildConflictPredicate = (compareColumns: readonly string[]): string =>
  compareColumns
    .map((column) => {
      const reference = quoteIdentifier(column);
      return `(count(DISTINCT ${reference}) > 1 OR count(${reference}) BETWEEN 1 AND count(*) - 1)`;
    })
    .join(" OR ");

const nullKeyPredicate = (keyFields: readonly string[]): string =>
  keyFields.map((field) => `${quoteIdentifier(field)} IS NULL`).join(" OR ");

const groupingOf = (layout: ProcessingLayout): string =>
  `${quoteList(layout.keyFields)}, CASE WHEN ${nullKeyPredicate(layout.keyFields)} THEN ${quoteIdentifier(STAGE_RECORD_COLUMN)} END`;

const buildGroupedBaseFrom = (grouping: string): string =>
  `FROM ${quoteIdentifier(BASE_TABLE)} GROUP BY ${grouping}`;

export const buildBaseTableSql = (layout: ProcessingLayout): string => {
  const sourceSrid = assertSafeSridNumber(layout.sourceSrid);
  const geometry = `ST_SetSRID(ST_GeomFromGeoJSON(NULLIF(${quoteIdentifier(GEOMETRY_STAGE_COLUMN)},'')), ${sourceSrid}) AS ${quoteIdentifier(PROCESSED_GEOMETRY_COLUMN)}`;
  const columns = [quoteIdentifier(STAGE_RECORD_COLUMN), ...layout.stageFields.map((field) => quoteIdentifier(field)), geometry];
  return `CREATE TEMP TABLE ${quoteIdentifier(BASE_TABLE)} ON COMMIT DROP AS SELECT ${columns.join(", ")} FROM ${quoteIdentifier(STAGE_TABLE)}`;
};

export const buildInvalidCountSql = (table: string): string => {
  const geometry = quoteIdentifier(PROCESSED_GEOMETRY_COLUMN);
  return `SELECT count(*) FILTER (WHERE ${geometry} IS NOT NULL AND NOT ST_IsValid(${geometry})) AS invalid, count(*) FILTER (WHERE ${geometry} IS NULL) AS nulls FROM ${quoteIdentifier(table)}`;
};

export const buildIncompatibleGeometryCountSql = (table: string): string => {
  const geometry = quoteIdentifier(PROCESSED_GEOMETRY_COLUMN);
  return `SELECT count(*) AS incompatible FROM ${quoteIdentifier(table)} WHERE ${geometry} IS NOT NULL AND GeometryType(${geometry}) LIKE 'MULTI%'`;
};

export const buildNullKeyCountSql = (layout: ProcessingLayout): string => {
  assertKeyFields(layout);
  return `SELECT count(*) AS null_key_rows FROM ${quoteIdentifier(BASE_TABLE)} WHERE ${nullKeyPredicate(layout.keyFields)}`;
};

export const buildUnifySql = (layout: ProcessingLayout): string => {
  assertKeyFields(layout);
  const keyFields = new Set(layout.keyFields);
  const attributes = layout.stageFields.map((field) =>
    keyFields.has(field)
      ? quoteIdentifier(field)
      : `(array_agg(${quoteIdentifier(field)} ORDER BY ${quoteIdentifier(STAGE_RECORD_COLUMN)}))[1] AS ${quoteIdentifier(field)}`
  );
  const geometry = `ST_Multi(ST_CollectionExtract(ST_Collect(${quoteIdentifier(PROCESSED_GEOMETRY_COLUMN)}), 3)) AS ${quoteIdentifier(PROCESSED_GEOMETRY_COLUMN)}`;
  const selectList = [`min(${quoteIdentifier(STAGE_RECORD_COLUMN)}) AS ${quoteIdentifier(STAGE_RECORD_COLUMN)}`, ...attributes, geometry];
  return `CREATE TEMP TABLE ${quoteIdentifier(UNIFIED_TABLE)} ON COMMIT DROP AS SELECT ${selectList.join(", ")} ${buildGroupedBaseFrom(groupingOf(layout))}`;
};

export const buildGroupStatsSql = (layout: ProcessingLayout): string => {
  assertKeyFields(layout);
  const sizedGroups = `(SELECT count(*) AS "size" ${buildGroupedBaseFrom(groupingOf(layout))} ${MULTI_RECORD_GROUP_FILTER}) sized`;
  return `SELECT count(*) AS "groups", COALESCE(sum("size" - 1), 0) AS "rows_merged" FROM ${sizedGroups}`;
};

export const buildLargestGroupsSql = (layout: ProcessingLayout, limit: number): string => {
  assertKeyFields(layout);
  const keyColumns = quoteList(layout.keyFields);
  return `SELECT ${keyColumns}, count(*) AS "size" ${buildGroupedBaseFrom(groupingOf(layout))} ${MULTI_RECORD_GROUP_FILTER} ORDER BY "size" DESC, ${keyColumns} LIMIT ${assertSafeLimit(limit)}`;
};

export const buildConflictCountSql = (layout: ProcessingLayout, compareColumns: readonly string[]): string => {
  assertKeyFields(layout);
  assertCompareColumns(compareColumns, layout);
  const conflictingGroups = `SELECT 1 ${buildGroupedBaseFrom(groupingOf(layout))} HAVING ${buildConflictPredicate(compareColumns)}`;
  return `SELECT count(*) AS conflicts FROM (${conflictingGroups}) conflicted`;
};

export const buildConflictSamplesSql = (
  layout: ProcessingLayout,
  compareColumns: readonly string[],
  limit: number
): string => {
  assertKeyFields(layout);
  assertCompareColumns(compareColumns, layout);
  const keyColumns = quoteList(layout.keyFields);
  const valueColumns = compareColumns.flatMap((column, index) => [
    `(array_agg(DISTINCT ${quoteIdentifier(column)} ORDER BY ${quoteIdentifier(column)}))[1:${MAX_CONFLICT_VALUES}] AS ${quoteIdentifier(`distinct_${index}`)}`,
    `(array_agg(${quoteIdentifier(column)} ORDER BY ${quoteIdentifier(STAGE_RECORD_COLUMN)}))[1] AS ${quoteIdentifier(`first_${index}`)}`,
  ]);
  return `SELECT ${keyColumns}, ${valueColumns.join(", ")} ${buildGroupedBaseFrom(groupingOf(layout))} HAVING ${buildConflictPredicate(compareColumns)} ORDER BY ${keyColumns} LIMIT ${assertSafeLimit(limit)}`;
};

export const buildRepairSql = (table: string): string[] => {
  const target = quoteIdentifier(table);
  const geometry = quoteIdentifier(PROCESSED_GEOMETRY_COLUMN);
  return [
    `UPDATE ${target} SET ${geometry} = ST_CollectionExtract(ST_MakeValid(${geometry}), 3) WHERE ${geometry} IS NOT NULL AND NOT ST_IsValid(${geometry})`,
    `UPDATE ${target} SET ${geometry} = NULL WHERE ${geometry} IS NOT NULL AND ST_IsEmpty(${geometry})`,
  ];
};

export const buildOverlapInputSql = (table: string): string[] => {
  const overlapTable = quoteIdentifier(OVERLAP_TABLE);
  const geometry = quoteIdentifier(PROCESSED_GEOMETRY_COLUMN);
  return [
    `CREATE TEMP TABLE ${overlapTable} ON COMMIT DROP AS SELECT ${quoteIdentifier(STAGE_RECORD_COLUMN)}, ${geometry} FROM ${quoteIdentifier(table)} WHERE ${geometry} IS NOT NULL AND ST_IsValid(${geometry}) AND NOT ST_IsEmpty(${geometry})`,
    `CREATE INDEX ON ${overlapTable} USING gist (${geometry})`,
    `ANALYZE ${overlapTable}`,
  ];
};

export const buildOverlapCountSql = (minAreaM2: number, mode: AreaMode): string =>
  `SELECT count(*) AS overlaps ${buildOverlapPairsFrom()} WHERE ${buildAboveThreshold(minAreaM2, mode)}`;

export const buildOverlapSamplesSql = (
  layout: ProcessingLayout,
  baseTable: string,
  minAreaM2: number,
  mode: AreaMode,
  limit: number
): string => {
  layout.keyFields.forEach((keyField) => assertStageField(keyField, layout));
  const base = quoteIdentifier(baseTable);
  const recordColumn = quoteIdentifier(STAGE_RECORD_COLUMN);
  const keyColumns = [
    ...layout.keyFields.map((key) => `ka.${quoteIdentifier(key)} AS ${quoteIdentifier(`a_${key}`)}`),
    ...layout.keyFields.map((key) => `kb.${quoteIdentifier(key)} AS ${quoteIdentifier(`b_${key}`)}`),
  ];
  const keySelect = keyColumns.map((column) => `, ${column}`).join("");
  const keyJoins =
    layout.keyFields.length === 0
      ? ""
      : ` JOIN ${base} ka ON ka.${recordColumn} = a.rec JOIN ${base} kb ON kb.${recordColumn} = b.rec`;
  return `SELECT a.rec AS "rec_a", b.rec AS "rec_b", ${buildAreaExpression(mode)} AS "area"${keySelect} ${buildOverlapPairsFrom()}${keyJoins} WHERE ${buildAboveThreshold(minAreaM2, mode)} ORDER BY "area" DESC, "rec_a", "rec_b" LIMIT ${assertSafeLimit(limit)}`;
};
