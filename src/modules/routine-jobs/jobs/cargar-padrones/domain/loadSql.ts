import { buildDeleteStatement, formatReplaceLiteral, quoteIdentifier } from "@/core/services/sqlStatements";
import {
  AMBIGUOUS_LOCALITY_LIMIT,
  CLEAR_MODE,
  COLUMN,
  CONFLICT_SAMPLE_LIMIT,
  CONFLICT_VALUES_LIMIT,
  PADRON_UNIT,
  POLYGONAL_DIMENSION,
  RURAL_REQUIRED_COLUMNS,
  TARGET_REQUIRED_COLUMNS,
  URBANO_REQUIRED_COLUMNS,
  type ClearMode,
  type PadronUnit,
} from "../constants";

export interface SourceLayout {
  schema: string;
  table: string;
  columns: Record<string, string>;
}

export interface TargetLayout extends SourceLayout {
  srid: number;
}

export interface LoadOptions {
  repair: boolean;
  clearMode: ClearMode;
  resetSequences: boolean;
}

interface UnitSpec {
  keys: readonly string[];
  carried: readonly string[];
}

const EXCLUDED_ATTRIBUTES: ReadonlySet<string> = new Set([COLUMN.GID, COLUMN.GEOM]);
const PREPARED_ALIAS = "prepared";
const GROUPED_ALIAS = "grouped";
const GEOM_USABLE = "geom_usable";
const GEOM_INVALID = "geom_invalid";
const ROW_COUNT_ALIAS = "rowCount";
const HAS_INVALID_ALIAS = "hasInvalid";
const CONFLICT_KEY_SEPARATOR = "|";
const DEFAULT_CONFLICT_OPTIONS: Pick<LoadOptions, "repair"> = { repair: true };

const specOf = (requiredColumns: readonly string[], keys: readonly string[]): UnitSpec => {
  const keySet = new Set(keys);
  const carried = requiredColumns.filter((column) => !keySet.has(column) && !EXCLUDED_ATTRIBUTES.has(column));
  return { keys, carried };
};

export const UNIT_SPECS: Record<PadronUnit, UnitSpec> = {
  [PADRON_UNIT.RURAL]: specOf(RURAL_REQUIRED_COLUMNS, [COLUMN.NOMDEPTO, COLUMN.PADRON]),
  [PADRON_UNIT.URBANO]: specOf(URBANO_REQUIRED_COLUMNS, [COLUMN.NOMDEPTO, COLUMN.NOMLOCCAT, COLUMN.PADRON]),
};

const unique = (values: readonly string[]): string[] => Array.from(new Set(values));

const qualifiedName = (layout: SourceLayout): string =>
  `${quoteIdentifier(layout.schema)}.${quoteIdentifier(layout.table)}`;

const columnOf = (layout: SourceLayout, logical: string): string => quoteIdentifier(layout.columns[logical]);

const keyList = (spec: UnitSpec, layout: SourceLayout): string =>
  spec.keys.map((key) => columnOf(layout, key)).join(", ");

const keysNotNull = (spec: UnitSpec, layout: SourceLayout): string =>
  spec.keys.map((key) => `${columnOf(layout, key)} IS NOT NULL`).join(" AND ");

const usableFilter = (): string =>
  `${quoteIdentifier(GEOM_USABLE)} IS NOT NULL AND NOT ST_IsEmpty(${quoteIdentifier(GEOM_USABLE)})`;

const conflictPredicateOf = (column: string): string =>
  `count(DISTINCT ${column}) > 1 OR (count(*) <> count(${column}) AND count(${column}) > 0)`;

function repairedGeometry(geometry: string, repair: boolean): string {
  if (!repair) return geometry;
  return `CASE WHEN NOT ST_IsValid(${geometry}) THEN ST_CollectionExtract(ST_MakeValid(${geometry}), ${POLYGONAL_DIMENSION}) ELSE ${geometry} END`;
}

function preparedRowsSql(spec: UnitSpec, layout: SourceLayout, repair: boolean, columns: readonly string[]): string {
  const geometry = columnOf(layout, COLUMN.GEOM);
  const selected = unique([...spec.keys, ...columns]).map((column) => columnOf(layout, column));
  const derived = [
    `${repairedGeometry(geometry, repair)} AS ${quoteIdentifier(GEOM_USABLE)}`,
    `NOT ST_IsValid(${geometry}) AS ${quoteIdentifier(GEOM_INVALID)}`,
  ];
  return `SELECT ${[...selected, ...derived].join(", ")} FROM ${qualifiedName(layout)} WHERE ${keysNotNull(spec, layout)} AND ${geometry} IS NOT NULL`;
}

function geometryAggregateSql(source: SourceLayout, repair: boolean, srid: number): string {
  const usable = quoteIdentifier(GEOM_USABLE);
  const firstRowGeometry = `(array_agg(${usable} ORDER BY ${columnOf(source, COLUMN.GID)}))[1]`;
  const union = repair
    ? `ST_Union(${usable})`
    : `CASE WHEN count(*) > 1 THEN ST_CollectionExtract(ST_Union(ST_MakeValid(${usable})), ${POLYGONAL_DIMENSION}) ELSE ${firstRowGeometry} END`;
  const multi = `ST_Multi(${union})`;
  if (srid === 0) return multi;
  if (!Number.isSafeInteger(srid) || srid < 0) throw new Error(`SRID destino no válido: ${srid}.`);
  return `ST_Transform(${multi}, ${srid})`;
}

function targetValueSql(logical: string, unit: PadronUnit, spec: UnitSpec, source: SourceLayout, geometry: string): string {
  if (logical === COLUMN.UNIDADCAT) return formatReplaceLiteral(unit);
  if (logical === COLUMN.ARCHIVO) return formatReplaceLiteral(source.table);
  if (logical === COLUMN.GEOM) return geometry;
  if (spec.keys.includes(logical)) return columnOf(source, logical);
  if (spec.carried.includes(logical)) {
    return `(array_agg(${columnOf(source, logical)} ORDER BY ${columnOf(source, COLUMN.GID)}))[1]`;
  }
  return "NULL";
}

export function buildClearSql(target: TargetLayout, mode: ClearMode): string {
  if (mode === CLEAR_MODE.TRUNCATE) return `TRUNCATE ${qualifiedName(target)};`;
  return buildDeleteStatement(target.schema, target.table);
}

export function buildCountSql(source: SourceLayout): string {
  return `SELECT count(*) AS count FROM ${qualifiedName(source)}`;
}

export function buildLoadSql(unit: PadronUnit, source: SourceLayout, target: TargetLayout, options: LoadOptions): string {
  const spec = UNIT_SPECS[unit];
  const prepared = preparedRowsSql(spec, source, options.repair, [COLUMN.GID, ...spec.carried]);
  const geometry = geometryAggregateSql(source, options.repair, target.srid);
  const insertColumns = TARGET_REQUIRED_COLUMNS.map((logical) => quoteIdentifier(target.columns[logical])).join(", ");
  const selectList = TARGET_REQUIRED_COLUMNS.map((logical) => targetValueSql(logical, unit, spec, source, geometry)).join(", ");
  return `INSERT INTO ${qualifiedName(target)} (${insertColumns}) SELECT ${selectList} FROM (${prepared}) AS ${PREPARED_ALIAS} WHERE ${usableFilter()} GROUP BY ${keyList(spec, source)}`;
}

function modeCountsSql(repair: boolean): string {
  if (repair) {
    return `(SELECT count(*) FROM ${PREPARED_ALIAS} WHERE ${quoteIdentifier(GEOM_INVALID)} AND ${usableFilter()}) AS "repaired"`;
  }
  return `(SELECT count(*) FROM ${GROUPED_ALIAS} WHERE "${ROW_COUNT_ALIAS}" = 1 AND "${HAS_INVALID_ALIAS}") AS "insertedInvalid", (SELECT count(*) FROM ${GROUPED_ALIAS} WHERE "${ROW_COUNT_ALIAS}" > 1 AND "${HAS_INVALID_ALIAS}") AS "repairedInUnion"`;
}

function conflictHavingSql(spec: UnitSpec, layout: SourceLayout): string {
  return spec.carried.map((column) => `(${conflictPredicateOf(columnOf(layout, column))})`).join(" OR ");
}

export function buildGeometryReportSql(unit: PadronUnit, source: SourceLayout, options: LoadOptions): string {
  const spec = UNIT_SPECS[unit];
  const keys = keyList(spec, source);
  const notNullKeys = keysNotNull(spec, source);
  const sourceTable = qualifiedName(source);
  const prepared = preparedRowsSql(spec, source, options.repair, spec.carried);
  const conflicts = `SELECT 1 FROM ${PREPARED_ALIAS} WHERE ${usableFilter()} GROUP BY ${keys} HAVING ${conflictHavingSql(spec, source)}`;
  return `WITH ${PREPARED_ALIAS} AS (${prepared}), ${GROUPED_ALIAS} AS (SELECT ${keys}, count(*) AS "${ROW_COUNT_ALIAS}", bool_or(${quoteIdentifier(GEOM_INVALID)}) AS "${HAS_INVALID_ALIAS}" FROM ${PREPARED_ALIAS} WHERE ${usableFilter()} GROUP BY ${keys}) SELECT (SELECT count(*) FROM ${sourceTable}) AS "rowsRead", ${modeCountsSql(options.repair)}, (SELECT count(*) FROM ${sourceTable} WHERE ${notNullKeys} AND ${columnOf(source, COLUMN.GEOM)} IS NULL) + (SELECT count(*) FROM ${PREPARED_ALIAS} WHERE ${quoteIdentifier(GEOM_USABLE)} IS NULL OR ST_IsEmpty(${quoteIdentifier(GEOM_USABLE)})) AS "noGeometry", (SELECT count(*) FROM ${sourceTable} WHERE NOT (${notNullKeys})) AS "nullKeyRows", (SELECT count(*) FROM ${GROUPED_ALIAS}) AS "groups", (SELECT count(*) FROM (${conflicts}) AS conflicting) AS "attributeConflicts"`;
}

function conflictBranchSql(spec: UnitSpec, source: SourceLayout, logical: string): string {
  const column = columnOf(source, logical);
  const keyText = `concat_ws(${formatReplaceLiteral(CONFLICT_KEY_SEPARATOR)}, ${keyList(spec, source)})`;
  const values = `(array_agg(DISTINCT ${column}::text) FILTER (WHERE ${column} IS NOT NULL))[1:${CONFLICT_VALUES_LIMIT}]`;
  return `SELECT ${formatReplaceLiteral(logical)} AS "column", "key", "values" FROM (SELECT ${keyText} AS "key", ${values} AS "values" FROM ${PREPARED_ALIAS} WHERE ${usableFilter()} GROUP BY ${keyList(spec, source)} HAVING ${conflictPredicateOf(column)}) AS ${GROUPED_ALIAS}`;
}

export function buildConflictSamplesSql(
  unit: PadronUnit,
  source: SourceLayout,
  options: Pick<LoadOptions, "repair"> = DEFAULT_CONFLICT_OPTIONS
): string {
  const spec = UNIT_SPECS[unit];
  const prepared = preparedRowsSql(spec, source, options.repair, spec.carried);
  const branches = spec.carried.map((logical) => conflictBranchSql(spec, source, logical));
  return `WITH ${PREPARED_ALIAS} AS (${prepared}) SELECT "key", "column", "values" FROM (${branches.join(" UNION ALL ")}) AS conflicts ORDER BY "key", "column" LIMIT ${CONFLICT_SAMPLE_LIMIT}`;
}

export function buildAmbiguousLocalityCodesSql(source: SourceLayout): string {
  const codDepto = columnOf(source, COLUMN.CODDEPTO);
  const codLocCat = columnOf(source, COLUMN.CODLOCCAT);
  const nomLocCat = columnOf(source, COLUMN.NOMLOCCAT);
  return `SELECT ${codDepto} AS "coddepto", ${codLocCat} AS "codloccat", array_agg(DISTINCT ${nomLocCat}) AS "nomloccat" FROM ${qualifiedName(source)} WHERE ${nomLocCat} IS NOT NULL GROUP BY ${codDepto}, ${codLocCat} HAVING count(DISTINCT ${nomLocCat}) > 1 ORDER BY 1, 2 LIMIT ${AMBIGUOUS_LOCALITY_LIMIT}`;
}
