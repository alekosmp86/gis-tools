import { quoteIdentifier, resolveSchemaName } from "@/core/services/sqlStatements";

export const GEOMETRY_REPAIR_DEFAULT_DECIMALS = 4;
export const GEOMETRY_REPAIR_MIN_DECIMALS = 0;
export const GEOMETRY_REPAIR_MAX_DECIMALS = 8;

const MIN_PART_POINTS = 4;
const GEOMETRY_TYPE_PATTERN = /^(?:"?[a-z_][a-z0-9_]*"?\.)?geometry(?:\(\s*([a-z]+)\s*(?:,\s*-?\d+\s*)?\))?$/;
const POLYGONAL_SUBTYPE_PATTERN = /^(?:multi)?polygon/;
const REPAIRABLE_GEOMETRY_SUBTYPES: ReadonlySet<string> = new Set(["geometry", "multipolygon", "multipolygonz"]);
const DECIMALS_INPUT_PATTERN = /^\d+$/;
const GEOMETRY_COUNT_PATTERN = /^(\d+),(\d+)$/;
const POLYGONAL_GEOMETRY_TYPES_SQL = "'POLYGON', 'MULTIPOLYGON'";

export interface GeometryRepairCount {
  changedRows: number;
  unrepairableRows: number;
}

const isSupportedDecimals = (candidate: number): boolean =>
  Number.isInteger(candidate) && candidate >= GEOMETRY_REPAIR_MIN_DECIMALS && candidate <= GEOMETRY_REPAIR_MAX_DECIMALS;

export function normalizeGeometryRepairDecimals(value: unknown): number {
  const candidate = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof candidate === "number" && isSupportedDecimals(candidate) ? candidate : GEOMETRY_REPAIR_DEFAULT_DECIMALS;
}

export function isValidGeometryRepairDecimalsInput(input: string): boolean {
  const trimmed = input.trim();
  return DECIMALS_INPUT_PATTERN.test(trimmed) && isSupportedDecimals(Number(trimmed));
}

const readGeometrySubtype = (columnType: string | undefined | null): string | null => {
  const match = GEOMETRY_TYPE_PATTERN.exec((columnType ?? "").trim().toLowerCase());
  if (!match) return null;
  return match[1] ?? "geometry";
};

export function isRepairableGeometryColumnType(columnType: string | undefined | null): boolean {
  const subtype = readGeometrySubtype(columnType);
  return subtype !== null && REPAIRABLE_GEOMETRY_SUBTYPES.has(subtype);
}

export function isUnsupportedPolygonalColumnType(columnType: string | undefined | null): boolean {
  const subtype = readGeometrySubtype(columnType);
  return subtype !== null && POLYGONAL_SUBTYPE_PATTERN.test(subtype) && !REPAIRABLE_GEOMETRY_SUBTYPES.has(subtype);
}

export function parseGeometryRepairCount(value: unknown): GeometryRepairCount | null {
  const match = typeof value === "string" ? GEOMETRY_COUNT_PATTERN.exec(value.trim()) : null;
  if (!match) return null;
  return { changedRows: Number(match[1]), unrepairableRows: Number(match[2]) };
}

const qualifyTable = (schema: string | undefined | null, table: string): string =>
  `${quoteIdentifier(resolveSchemaName(schema))}.${quoteIdentifier(table)}`;

const buildSourceFilter = (geometry: string): string =>
  `${geometry} IS NOT NULL AND ST_SRID(${geometry}) > 0 AND ST_SRID(${geometry}) IN (SELECT srid FROM spatial_ref_sys) AND GeometryType(${geometry}) IN (${POLYGONAL_GEOMETRY_TYPES_SQL})`;

const buildRepairCtes = (qualifiedTable: string, geometry: string, decimals: number): string => {
  const snapTolerance = (10 ** -decimals).toFixed(decimals);
  const snappedPart = `ST_SnapToGrid(ST_Transform(part, 4326), ${snapTolerance})`;
  const parts = `d AS (SELECT tableoid AS toid, ctid AS rid, ST_SRID(${geometry}) AS srid, (ST_Dump(ST_CollectionExtract(ST_MakeValid(${geometry}), 3))).geom AS part FROM ${qualifiedTable} WHERE ${buildSourceFilter(geometry)})`;
  const keptParts = `k AS (SELECT toid, rid, srid, part FROM d WHERE ST_NPoints(${snappedPart}) >= ${MIN_PART_POINTS} AND ST_Area(${snappedPart}) > 0)`;
  const repaired = `r AS (SELECT toid, rid, ST_SetSRID(ST_Multi(ST_Collect(part)), max(srid)) AS ng FROM k GROUP BY toid, rid)`;
  return `WITH ${parts}, ${keptParts}, ${repaired}`;
};

const buildChangedRowCondition = (geometry: string): string =>
  `ST_IsValid(r.ng) AND (NOT ST_IsValid(t.${geometry}) OR ST_NumGeometries(t.${geometry}) <> ST_NumGeometries(r.ng))`;

const buildChangedRowsSubquery = (qualifiedTable: string, geometry: string): string =>
  `(SELECT count(*) FROM r JOIN ${qualifiedTable} AS t ON t.tableoid = r.toid AND t.ctid = r.rid WHERE ${buildChangedRowCondition(geometry)})`;

const buildUnrepairableRowsSubquery = (qualifiedTable: string, geometry: string): string =>
  `((SELECT count(*) FROM ${qualifiedTable} AS f WHERE ${buildSourceFilter(geometry)} AND NOT EXISTS (SELECT 1 FROM r WHERE r.toid = f.tableoid AND r.rid = f.ctid)) + (SELECT count(*) FROM r WHERE NOT ST_IsValid(r.ng)))`;

export const buildGeometryRepairCountStatement = (
  schema: string | undefined | null,
  table: string,
  column: string,
  decimals: number
): string => {
  const geometry = quoteIdentifier(column);
  const qualifiedTable = qualifyTable(schema, table);
  const ctes = buildRepairCtes(qualifiedTable, geometry, normalizeGeometryRepairDecimals(decimals));
  const counts = `concat_ws(',', ${buildChangedRowsSubquery(qualifiedTable, geometry)}::text, ${buildUnrepairableRowsSubquery(qualifiedTable, geometry)}::text)`;
  return `${ctes} SELECT ${counts};`;
};

export const buildGeometryRepairUpdateStatement = (
  schema: string | undefined | null,
  table: string,
  column: string,
  decimals: number
): string => {
  const geometry = quoteIdentifier(column);
  const qualifiedTable = qualifyTable(schema, table);
  const ctes = buildRepairCtes(qualifiedTable, geometry, normalizeGeometryRepairDecimals(decimals));
  return `${ctes} UPDATE ${qualifiedTable} AS t SET ${geometry} = r.ng FROM r WHERE t.tableoid = r.toid AND t.ctid = r.rid AND ${buildChangedRowCondition(geometry)};`;
};
