import {
  autoMapColumns,
  MatchKind,
  normalizeColumnName,
  type AutoMatch,
} from "@/core/services/columnAutoMapper";
import type { DbColumnMetadata } from "@/core/types/db";
import {
  ColumnStatus,
  TableKind,
  type CatalogTable,
  type ResolvedColumn,
  type TableListing,
} from "@/core/types/tableCatalog";

export interface CatalogQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount?: number;
}

export interface CatalogQuerySession {
  query(sql: string, values?: unknown[]): Promise<CatalogQueryResult>;
}

const EXACT_MATCH_KINDS: ReadonlySet<MatchKind> = new Set([
  MatchKind.EXACT,
  MatchKind.CASE_INSENSITIVE,
  MatchKind.NORMALIZED,
]);

const RELATION_KINDS_SQL = "('r', 'p', 'v', 'm', 'f')";
const GEOMETRY_LOGICAL_NAMES: ReadonlySet<string> = new Set(["geom", "geometry"]);
const GEOMETRY_DATA_TYPE = /^geometry(?:\(|$)/i;

const SCHEMA_EXISTS_SQL = "SELECT n.nspname AS schema_name FROM pg_catalog.pg_namespace n WHERE n.nspname = $1";

const LIST_TABLES_SQL = `SELECT c.relname AS name,
  CASE WHEN c.relkind IN ('v', 'm') THEN 'VIEW' ELSE 'TABLE' END AS kind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relkind IN ${RELATION_KINDS_SQL}
ORDER BY c.relname`;

const COLUMNS_SQL = `SELECT a.attname AS column_name,
  format_type(a.atttypid, a.atttypmod) AS data_type,
  NOT a.attnotnull AS is_nullable,
  pg_catalog.pg_get_expr(d.adbin, d.adrelid) AS column_default
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ${RELATION_KINDS_SQL}
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY a.attnum`;

const toCatalogTable = (row: Record<string, unknown>): CatalogTable => ({
  name: String(row.name),
  kind: String(row.kind) === TableKind.VIEW ? TableKind.VIEW : TableKind.TABLE,
});

const toCatalogColumn = (row: Record<string, unknown>): DbColumnMetadata => ({
  column_name: String(row.column_name),
  data_type: String(row.data_type),
  is_nullable: row.is_nullable === true,
  column_default: row.column_default == null ? null : String(row.column_default),
});

const byTableName = (left: CatalogTable, right: CatalogTable): number => left.name.localeCompare(right.name);

export async function listTables(session: CatalogQuerySession, schema: string): Promise<TableListing> {
  const existing = await session.query(SCHEMA_EXISTS_SQL, [schema]);
  if (existing.rows.length === 0) {
    return { schemaExists: false, tables: [] };
  }
  const listing = await session.query(LIST_TABLES_SQL, [schema]);
  return { schemaExists: true, tables: listing.rows.map(toCatalogTable).sort(byTableName) };
}

export async function fetchCatalogColumns(
  session: CatalogQuerySession,
  schema: string,
  table: string
): Promise<DbColumnMetadata[]> {
  const result = await session.query(COLUMNS_SQL, [schema, table]);
  return result.rows.map(toCatalogColumn);
}

const candidatesOf = (catalog: readonly DbColumnMetadata[], logical: string): DbColumnMetadata[] =>
  catalog.filter((column) => normalizeColumnName(column.column_name) === normalizeColumnName(logical));

const dataTypeOf = (catalog: readonly DbColumnMetadata[], column: string): string | undefined =>
  catalog.find((entry) => entry.column_name === column)?.data_type;

const isGeometryColumn = (column: DbColumnMetadata): boolean => GEOMETRY_DATA_TYPE.test(column.data_type.trim());

function geometryFallbackOf(logical: string, catalog: readonly DbColumnMetadata[]): ResolvedColumn | undefined {
  if (!GEOMETRY_LOGICAL_NAMES.has(logical)) return undefined;
  const geometryColumns = catalog.filter(isGeometryColumn);
  if (geometryColumns.length !== 1) return undefined;
  const [only] = geometryColumns;
  return { logical, status: ColumnStatus.RESOLVED, column: only.column_name, dataType: only.data_type };
}

function resolveOne(logical: string, match: AutoMatch | undefined, catalog: readonly DbColumnMetadata[]): ResolvedColumn {
  if (match && EXACT_MATCH_KINDS.has(match.kind)) {
    return { logical, status: ColumnStatus.RESOLVED, column: match.source, dataType: dataTypeOf(catalog, match.source) };
  }
  if (match) {
    return withFallback(logical, catalog, { logical, status: ColumnStatus.MISSING, suggestion: match.source });
  }
  if (candidatesOf(catalog, logical).length > 1) {
    return { logical, status: ColumnStatus.AMBIGUOUS };
  }
  return withFallback(logical, catalog, { logical, status: ColumnStatus.MISSING });
}

function withFallback(logical: string, catalog: readonly DbColumnMetadata[], missing: ResolvedColumn): ResolvedColumn {
  return geometryFallbackOf(logical, catalog) ?? missing;
}

export function matchColumns(catalog: readonly DbColumnMetadata[], required: readonly string[]): ResolvedColumn[] {
  const matches: Record<string, AutoMatch> = autoMapColumns(
    catalog.map((column) => column.column_name),
    required
  );
  return required.map((logical) => resolveOne(logical, matches[logical], catalog));
}

export async function resolveColumns(
  session: CatalogQuerySession,
  schema: string,
  table: string,
  required: readonly string[]
): Promise<ResolvedColumn[]> {
  return matchColumns(await fetchCatalogColumns(session, schema, table), required);
}
