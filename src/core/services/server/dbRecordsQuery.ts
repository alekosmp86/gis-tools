import { Client } from "pg";

export const REQUIRED_PARAMS_MESSAGE =
  "Los parámetros de conexión (base de datos, usuario y tabla) son obligatorios.";

export interface RecordsRequestParams {
  host?: string;
  port?: number | string;
  db_name?: string;
  user?: string;
  password?: string;
  schema_name: string;
  table_name?: string;
  suid_column?: string;
  suid_columns?: string[];
  fields_to_compare: string[];
  primary_key_column?: string;
  limit?: unknown;
  offset?: unknown;
  raw_text_values?: boolean;
}

export interface RecordsTableInfo {
  columnTypes: Record<string, string>;
  detectedSrid: number;
  selectClause: string;
  qualifiedTable: string;
}

export function parseRecordsRequest(body: Record<string, unknown>): RecordsRequestParams {
  const {
    host,
    port,
    db_name,
    user,
    password,
    schema_name = "public",
    table_name,
    suid_column,
    suid_columns,
    fields_to_compare = [],
    primary_key_column,
    limit,
    offset,
    raw_text_values,
  } = body as Partial<RecordsRequestParams>;

  return {
    host,
    port,
    db_name,
    user,
    password,
    schema_name: schema_name || "public",
    table_name,
    suid_column,
    suid_columns,
    fields_to_compare,
    primary_key_column,
    limit,
    offset,
    raw_text_values: raw_text_values === true ? true : undefined,
  };
}

export const RAW_TEXT_TYPES = { getTypeParser: () => (value: string) => value };

export function hasRequiredConnectionParams(params: RecordsRequestParams): boolean {
  return Boolean(params.db_name && params.user && params.table_name);
}

export function createPgClient(params: RecordsRequestParams): Client {
  return new Client({
    host: params.host || "localhost",
    port: Number(params.port) || 5432,
    database: params.db_name,
    user: params.user,
    password: params.password,
    connectionTimeoutMillis: 5000,
  });
}

const sanitizeIdentifier = (id: string) => id.replace(/"/g, '""');

export function appendPaging(sql: string, limit: unknown, offset: unknown): string {
  let query = sql;
  if (typeof limit === "number" && limit > 0) {
    query += ` LIMIT ${Number(limit)}`;
  }
  if (typeof offset === "number" && offset > 0) {
    query += ` OFFSET ${Number(offset)}`;
  }
  query += ";";
  return query;
}

export function buildRecordsDataQuery(
  info: RecordsTableInfo,
  limit: unknown,
  offset: unknown
): string {
  return appendPaging(
    `
      SELECT ${info.selectClause}
      FROM ${info.qualifiedTable}
    `,
    limit,
    offset
  );
}

interface ColumnTypeRow {
  column_name: string;
  data_type: string;
  udt_name?: string;
  full_data_type?: string;
}

const COLUMN_TYPES_QUERY = `
      SELECT
        c.column_name,
        c.data_type,
        c.udt_name,
        format_type(a.atttypid, a.atttypmod) AS full_data_type
      FROM information_schema.columns c
      LEFT JOIN pg_attribute a
        ON a.attname = c.column_name
       AND a.attrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
      WHERE c.table_schema = $1 AND c.table_name = $2;
    `;

function resolveSuidColumns(params: RecordsRequestParams): string[] {
  const { suid_columns, suid_column } = params;
  if (Array.isArray(suid_columns) && suid_columns.length > 0) return suid_columns;
  return suid_column ? [suid_column] : [];
}

function resolveSelectedColumns(params: RecordsRequestParams): string[] {
  const pkColsList = params.primary_key_column ? [params.primary_key_column] : [];
  return Array.from(
    new Set([...resolveSuidColumns(params), ...params.fields_to_compare, ...pkColsList])
  );
}

function isGeometryRow(row: ColumnTypeRow): boolean {
  const nameLower = row.column_name.toLowerCase();
  const udtLower = (row.udt_name || "").toLowerCase();
  const fullLower = (row.full_data_type || "").toLowerCase();
  return (
    nameLower === "geom" ||
    nameLower === "geometry" ||
    nameLower === "wkb_geometry" ||
    udtLower.includes("geometry") ||
    fullLower.includes("geometry")
  );
}

async function fetchColumnTypes(
  client: Client,
  schemaName: string,
  tableName: string
): Promise<{ columnTypes: Record<string, string>; geomColumnName: string | null }> {
  const typesRes = await client.query(COLUMN_TYPES_QUERY, [schemaName, tableName]);
  const columnTypes: Record<string, string> = {};
  let geomColumnName: string | null = null;

  typesRes.rows.forEach((row: ColumnTypeRow) => {
    columnTypes[row.column_name] = row.full_data_type || row.data_type;
    if (isGeometryRow(row)) geomColumnName = row.column_name;
  });

  return { columnTypes, geomColumnName };
}

function readPositiveSrid(rows: Array<{ srid?: unknown }>): number | null {
  const srid = rows.length > 0 ? rows[0].srid : undefined;
  return typeof srid === "number" && srid > 0 ? srid : null;
}

async function queryFallbackSrid(
  client: Client,
  geomSanitized: string,
  qualifiedTable: string
): Promise<number | null> {
  try {
    const fallbackQuery = `
            SELECT ST_SRID("${geomSanitized}") AS srid
            FROM ${qualifiedTable}
            WHERE "${geomSanitized}" IS NOT NULL
            LIMIT 1;
          `;
    const fallbackRes = await client.query(fallbackQuery);
    return readPositiveSrid(fallbackRes.rows);
  } catch {
    return null;
  }
}

async function queryGeometrySrid(
  client: Client,
  schemaName: string,
  tableName: string,
  geomColumnName: string,
  qualifiedTable: string
): Promise<number | null> {
  const geomSanitized = sanitizeIdentifier(geomColumnName);
  try {
    const sridQuery = `
          SELECT COALESCE(
            NULLIF((SELECT Find_SRID($1, $2, $3)), 0),
            NULLIF((SELECT ST_SRID("${geomSanitized}") FROM ${qualifiedTable} WHERE "${geomSanitized}" IS NOT NULL LIMIT 1), 0)
          ) AS srid;
        `;
    const sridRes = await client.query(sridQuery, [schemaName, tableName, geomColumnName]);
    return readPositiveSrid(sridRes.rows);
  } catch {
    return queryFallbackSrid(client, geomSanitized, qualifiedTable);
  }
}

function readSridFromColumnType(columnType: string | undefined): number | null {
  if (!columnType) return null;
  const typeMatch = columnType.match(/,\s*(\d+)\s*\)/);
  return typeMatch && Number(typeMatch[1]) > 0 ? Number(typeMatch[1]) : null;
}

function buildGeoJsonSelect(geomSanitized: string): string {
  return `CASE WHEN "${geomSanitized}" IS NULL THEN NULL WHEN ST_SRID("${geomSanitized}") = 4326 THEN ST_AsGeoJSON("${geomSanitized}") WHEN ST_SRID("${geomSanitized}") > 0 THEN ST_AsGeoJSON(ST_Transform("${geomSanitized}", 4326)) ELSE ST_AsGeoJSON("${geomSanitized}") END AS "${geomSanitized}"`;
}

function withGeoJsonSelect(colSelects: string[], geomSanitized: string): string[] {
  const result = [...colSelects];
  const existingIdx = result.findIndex((s) => s === `"${geomSanitized}"`);
  const expr = buildGeoJsonSelect(geomSanitized);
  if (existingIdx !== -1) {
    result[existingIdx] = expr;
  } else {
    result.push(expr);
  }
  return result;
}

export async function inspectRecordsTable(
  client: Client,
  params: RecordsRequestParams
): Promise<RecordsTableInfo> {
  const schema_name = params.schema_name;
  const table_name = params.table_name as string;
  const allSelectedCols = resolveSelectedColumns(params);

  const { columnTypes, geomColumnName } = await fetchColumnTypes(client, schema_name, table_name);

  const targetCols = allSelectedCols.length > 0 ? allSelectedCols : Object.keys(columnTypes);
  let colSelects: string[] = targetCols.map((col) => `"${sanitizeIdentifier(col)}"`);
  let detectedSrid: number = 4326;
  const qualifiedTable = `"${sanitizeIdentifier(schema_name)}"."${sanitizeIdentifier(table_name)}"`;

  if (geomColumnName) {
    const queriedSrid = await queryGeometrySrid(
      client,
      schema_name,
      table_name,
      geomColumnName,
      qualifiedTable
    );
    if (queriedSrid !== null) detectedSrid = queriedSrid;

    if (detectedSrid === 4326) {
      detectedSrid = readSridFromColumnType(columnTypes[geomColumnName]) ?? detectedSrid;
    }

    colSelects = withGeoJsonSelect(colSelects, sanitizeIdentifier(geomColumnName));
  }

  const selectClause = colSelects.length > 0 ? colSelects.join(", ") : "*";

  return { columnTypes, detectedSrid, selectClause, qualifiedTable };
}
