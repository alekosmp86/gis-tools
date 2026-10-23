import {
  findMissingRequiredColumns,
  resolveInsertColumns,
  type ReplaceColumnMapping,
  type ReplaceInsertColumn,
} from "@/core/services/replaceColumnMapping";
import { formatReplaceLiteral, resolveSchemaName } from "@/core/services/sqlStatements";
import type { DbColumnMetadata } from "@/core/types/db";
import type { InsertFieldDefault } from "@/core/types/comparison";
import {
  InsertColumnKind,
  assertSafeSridNumber,
  stageColumnName,
  type GeometryPlan,
  type InsertColumnPlan,
} from "@/core/services/server/shpReplace/replaceSql";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";
import type { RunShpReplaceParams, ShpQuerySession, ShpReplaceTarget } from "@/core/services/server/shpReplace/shpReplaceTypes";
import type { GeometryProcessingOptions } from "@/core/types/geometryProcessing";

export type TargetColumn = DbColumnMetadata & { udt_name: string; cast_type: string };

export interface TargetCatalog {
  columns: TargetColumn[];
  geometry?: GeometryPlan;
  acceptsMulti: boolean;
  sourceGeographic: boolean;
}

export interface ReplacePlan {
  insertColumns: InsertColumnPlan[];
  stageFields: string[];
  mappedFields: string[];
  geometry?: GeometryPlan;
}

interface GeometryLoad {
  plan: GeometryPlan;
  acceptsMulti: boolean;
  sourceGeographic: boolean;
}

interface RegisteredGeometry {
  srid: number;
  type: string;
  coordDimension: number;
}

const UDT_NAME_TYPES: ReadonlySet<string> = new Set(["USER-DEFINED", "ARRAY"]);
const MULTI_GEOMETRY_PREFIX = "MULTI";
const UNCONSTRAINED_GEOMETRY_TYPE = "GEOMETRY";
const MAX_COORD_DIMENSION = 2;

const toTargetColumn = (row: Record<string, unknown>): TargetColumn => ({
  column_name: String(row.column_name),
  data_type: String(row.data_type),
  udt_name: String(row.udt_name),
  cast_type: String(row.cast_type ?? row.udt_name),
  is_nullable: row.is_nullable === true,
  column_default: row.column_default == null ? null : String(row.column_default),
});

async function fetchTargetColumns(session: ShpQuerySession, target: ShpReplaceTarget): Promise<TargetColumn[]> {
  const result = await session.query(
    `SELECT c.column_name, c.data_type, c.udt_name, format_type(a.atttypid, NULL) AS cast_type, (c.is_nullable = 'YES') AS is_nullable, c.column_default
     FROM information_schema.columns c
     JOIN pg_catalog.pg_namespace n ON n.nspname = c.table_schema
     JOIN pg_catalog.pg_class k ON k.relname = c.table_name AND k.relnamespace = n.oid
     JOIN pg_catalog.pg_attribute a ON a.attrelid = k.oid AND a.attname = c.column_name
     WHERE c.table_schema = $1 AND c.table_name = $2
     ORDER BY c.ordinal_position`,
    [resolveSchemaName(target.schema_name), target.table_name]
  );
  return result.rows.map(toTargetColumn);
}

function findGeometryTargetColumns(mapping: ReplaceColumnMapping): string[] {
  return Object.keys(mapping.sourceByTarget).filter(
    (targetColumn) => mapping.sourceByTarget[targetColumn] === SHP_GEOMETRY_SOURCE
  );
}

async function fetchGeometryColumn(
  session: ShpQuerySession,
  target: ShpReplaceTarget,
  geometryColumn: string
): Promise<RegisteredGeometry | undefined> {
  const result = await session.query(
    "SELECT srid, type, coord_dimension FROM geometry_columns WHERE f_table_schema = $1 AND f_table_name = $2 AND f_geometry_column = $3",
    [resolveSchemaName(target.schema_name), target.table_name, geometryColumn]
  );
  const row = result.rows[0];
  return row
    ? { srid: Number(row.srid), type: String(row.type), coordDimension: Number(row.coord_dimension ?? MAX_COORD_DIMENSION) }
    : undefined;
}

function assertTwoDimensional(geometryColumn: string, coordDimension: number): void {
  if (coordDimension > MAX_COORD_DIMENSION) {
    throw new Error(
      `La columna geométrica "${geometryColumn}" tiene ${coordDimension} dimensiones (3D/Z). Solo se admiten geometrías 2D.`
    );
  }
}

async function fetchSourceSridRow(session: ShpQuerySession, sourceSrid: number): Promise<boolean> {
  const result = await session.query(
    "SELECT srid, (proj4text LIKE '%+proj=longlat%') AS geographic FROM spatial_ref_sys WHERE srid = $1",
    [sourceSrid]
  );
  const row = result.rows[0];
  if (!row) {
    throw new Error(`El SRID de origen ${sourceSrid} no existe en spatial_ref_sys.`);
  }
  return row.geographic === true;
}

const isMultiGeometryType = (geometryType: string): boolean =>
  geometryType.trim().toUpperCase().startsWith(MULTI_GEOMETRY_PREFIX);

const isUnconstrainedGeometryType = (geometryType: string): boolean =>
  geometryType.trim().toUpperCase() === UNCONSTRAINED_GEOMETRY_TYPE;

async function loadGeometryPlan(
  session: ShpQuerySession,
  target: ShpReplaceTarget,
  mapping: ReplaceColumnMapping,
  sourceSrid: number
): Promise<GeometryLoad | undefined> {
  const [geometryColumn] = findGeometryTargetColumns(mapping);
  if (geometryColumn === undefined) return undefined;
  const validSourceSrid = assertSafeSridNumber(sourceSrid);
  const registered = await fetchGeometryColumn(session, target, geometryColumn);
  if (!registered) {
    throw new Error(`La columna geométrica "${geometryColumn}" no está registrada en geometry_columns.`);
  }
  assertTwoDimensional(geometryColumn, registered.coordDimension);
  const sourceGeographic = await fetchSourceSridRow(session, validSourceSrid);
  return {
    plan: { sourceSrid: validSourceSrid, targetSrid: registered.srid, multi: isMultiGeometryType(registered.type) },
    acceptsMulti: isMultiGeometryType(registered.type) || isUnconstrainedGeometryType(registered.type),
    sourceGeographic,
  };
}

export async function loadTargetCatalog(
  session: ShpQuerySession,
  params: Pick<RunShpReplaceParams, "target" | "mapping" | "sourceSrid">
): Promise<TargetCatalog> {
  const [columns, geometryLoad] = await Promise.all([
    fetchTargetColumns(session, params.target),
    loadGeometryPlan(session, params.target, params.mapping, params.sourceSrid),
  ]);
  return {
    columns,
    geometry: geometryLoad?.plan,
    acceptsMulti: geometryLoad?.acceptsMulti ?? false,
    sourceGeographic: geometryLoad?.sourceGeographic ?? false,
  };
}

const castTypeOf = (column: TargetColumn): string =>
  UDT_NAME_TYPES.has(column.data_type) ? column.cast_type : column.data_type;

const joinNames = (names: string[]): string => names.join(", ");

function assertSingleGeometryTarget(mapping: ReplaceColumnMapping): void {
  const geometryColumns = findGeometryTargetColumns(mapping);
  if (geometryColumns.length > 1) {
    throw new Error(
      `Solo se puede mapear una columna destino a la geometría del SHP. Columnas mapeadas: ${joinNames(geometryColumns)}.`
    );
  }
}

function assertTargetColumnsExist(columns: TargetColumn[]): void {
  if (columns.length === 0) {
    throw new Error("La tabla destino no existe o no tiene columnas.");
  }
}

function assertMappedTargetsExist(mapping: ReplaceColumnMapping, columns: TargetColumn[]): void {
  const known = new Set(columns.map((column) => column.column_name));
  const unknown = Object.keys(mapping.sourceByTarget).filter(
    (targetColumn) => mapping.sourceByTarget[targetColumn] && !known.has(targetColumn)
  );
  if (unknown.length > 0) {
    throw new Error(`Columnas destino inexistentes en la tabla: ${joinNames(unknown)}.`);
  }
}

function assertMappedSourcesExist(insertColumns: ReplaceInsertColumn[], fieldNames: string[]): void {
  const known = new Set(fieldNames);
  const unknown = insertColumns
    .map((column) => column.sourceColumn)
    .filter((source): source is string => source !== null && source !== SHP_GEOMETRY_SOURCE && !known.has(source));
  if (unknown.length > 0) {
    throw new Error(`Campos del DBF no encontrados: ${joinNames(unknown)}.`);
  }
}

function assertRequiredColumnsCovered(insertColumns: ReplaceInsertColumn[], columns: TargetColumn[]): void {
  const missing = findMissingRequiredColumns(insertColumns, columns);
  if (missing.length > 0) {
    throw new Error(`Faltan columnas NOT NULL sin origen ni valor por defecto: ${joinNames(missing)}.`);
  }
}

function resolveValidInsertColumns(
  mapping: ReplaceColumnMapping,
  columns: TargetColumn[],
  fieldNames: string[]
): ReplaceInsertColumn[] {
  assertTargetColumnsExist(columns);
  assertSingleGeometryTarget(mapping);
  assertMappedTargetsExist(mapping, columns);
  const insertColumns = resolveInsertColumns(mapping, columns.map((column) => column.column_name));
  if (insertColumns.length === 0) {
    throw new Error("No hay columnas mapeadas: defina al menos una columna destino para insertar.");
  }
  assertMappedSourcesExist(insertColumns, fieldNames);
  assertRequiredColumnsCovered(insertColumns, columns);
  return insertColumns;
}

const collectMappedFields = (insertColumns: ReplaceInsertColumn[]): string[] => {
  const sources = insertColumns
    .map((column) => column.sourceColumn)
    .filter((source): source is string => source !== null && source !== SHP_GEOMETRY_SOURCE);
  return Array.from(new Set(sources));
};

const unifyKeyFieldsOf = (processing: GeometryProcessingOptions | undefined): string[] =>
  processing?.unify.enabled ? [...processing.unify.keyFields] : [];

function assertKeyFieldsExist(keyFields: string[], fieldNames: string[]): void {
  const known = new Set(fieldNames);
  const unknown = keyFields.filter((field) => !known.has(field));
  if (unknown.length > 0) {
    throw new Error(`Campos clave no encontrados en el DBF: ${joinNames(unknown)}.`);
  }
}

const buildDefaultSql = (fixedDefault: InsertFieldDefault | null, dataType: string): string => {
  if (!fixedDefault) return "NULL";
  const value = fixedDefault.value.trim();
  return fixedDefault.useRawExpression ? value : `${formatReplaceLiteral(value)}::${dataType}`;
};

function toInsertColumnPlan(
  column: ReplaceInsertColumn,
  dataType: string,
  stageColumnByField: ReadonlyMap<string, string>
): InsertColumnPlan {
  const { targetColumn, sourceColumn, fixedDefault } = column;
  if (sourceColumn === SHP_GEOMETRY_SOURCE) {
    return { targetColumn, dataType, kind: InsertColumnKind.GEOMETRY };
  }
  if (sourceColumn) {
    return {
      targetColumn,
      dataType,
      kind: InsertColumnKind.SOURCE,
      stageColumn: stageColumnByField.get(sourceColumn) ?? "",
    };
  }
  return { targetColumn, dataType, kind: InsertColumnKind.DEFAULT, defaultSql: buildDefaultSql(fixedDefault, dataType) };
}

export function buildReplacePlan(
  params: Pick<RunShpReplaceParams, "mapping" | "shapefile" | "processing">,
  catalog: TargetCatalog
): ReplacePlan {
  const insertColumns = resolveValidInsertColumns(params.mapping, catalog.columns, params.shapefile.fieldNames);
  const mappedFields = collectMappedFields(insertColumns);
  const keyFields = unifyKeyFieldsOf(params.processing);
  assertKeyFieldsExist(keyFields, params.shapefile.fieldNames);
  const stageFields = Array.from(new Set([...mappedFields, ...keyFields]));
  const stageColumnByField = new Map(stageFields.map((field, index) => [field, stageColumnName(index)]));
  const dataTypeByColumn = new Map(catalog.columns.map((column) => [column.column_name, castTypeOf(column)]));
  return {
    insertColumns: insertColumns.map((column) =>
      toInsertColumnPlan(column, dataTypeByColumn.get(column.targetColumn) ?? "", stageColumnByField)
    ),
    stageFields,
    mappedFields,
    geometry: catalog.geometry,
  };
}
