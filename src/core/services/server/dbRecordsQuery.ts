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
  } = body as Partial<RecordsRequestParams>;

  return {
    host,
    port,
    db_name,
    user,
    password,
    schema_name,
    table_name,
    suid_column,
    suid_columns,
    fields_to_compare,
    primary_key_column,
    limit,
    offset,
  };
}

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

export async function inspectRecordsTable(
  client: Client,
  params: RecordsRequestParams
): Promise<RecordsTableInfo> {
  const schema_name = params.schema_name;
  const table_name = params.table_name as string;
  const { suid_column, suid_columns, fields_to_compare, primary_key_column } = params;

  const suidColsList: string[] =
    Array.isArray(suid_columns) && suid_columns.length > 0
      ? suid_columns
      : suid_column
      ? [suid_column]
      : [];

  const pkColsList: string[] = primary_key_column ? [primary_key_column] : [];
  const allSelectedCols = Array.from(
    new Set([...suidColsList, ...fields_to_compare, ...pkColsList])
  );

  const typesQuery = `
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
  const typesRes = await client.query(typesQuery, [schema_name, table_name]);
  const columnTypes: Record<string, string> = {};
  let geomColumnName: string | null = null;

  typesRes.rows.forEach((row: { column_name: string; data_type: string; udt_name?: string; full_data_type?: string }) => {
    columnTypes[row.column_name] = row.full_data_type || row.data_type;
    const nameLower = row.column_name.toLowerCase();
    const udtLower = (row.udt_name || "").toLowerCase();
    const fullLower = (row.full_data_type || "").toLowerCase();
    if (
      nameLower === "geom" ||
      nameLower === "geometry" ||
      nameLower === "wkb_geometry" ||
      udtLower.includes("geometry") ||
      fullLower.includes("geometry")
    ) {
      geomColumnName = row.column_name;
    }
  });

  const targetCols =
    allSelectedCols.length > 0 ? allSelectedCols : Object.keys(columnTypes);
  const colSelects: string[] = targetCols.map((col) => `"${sanitizeIdentifier(col)}"`);
  let detectedSrid: number = 4326;
  const qualifiedTable = `"${sanitizeIdentifier(schema_name)}"."${sanitizeIdentifier(table_name)}"`;

  if (geomColumnName) {
    const geomSanitized = sanitizeIdentifier(geomColumnName);
    try {
      const sridQuery = `
          SELECT COALESCE(
            NULLIF((SELECT Find_SRID($1, $2, $3)), 0),
            NULLIF((SELECT ST_SRID("${geomSanitized}") FROM ${qualifiedTable} WHERE "${geomSanitized}" IS NOT NULL LIMIT 1), 0)
          ) AS srid;
        `;
      const sridRes = await client.query(sridQuery, [schema_name, table_name, geomColumnName]);
      if (sridRes.rows.length > 0 && typeof sridRes.rows[0].srid === "number" && sridRes.rows[0].srid > 0) {
        detectedSrid = sridRes.rows[0].srid;
      }
    } catch {
      try {
        const fallbackQuery = `
            SELECT ST_SRID("${geomSanitized}") AS srid
            FROM ${qualifiedTable}
            WHERE "${geomSanitized}" IS NOT NULL
            LIMIT 1;
          `;
        const fallbackRes = await client.query(fallbackQuery);
        if (fallbackRes.rows.length > 0 && typeof fallbackRes.rows[0].srid === "number" && fallbackRes.rows[0].srid > 0) {
          detectedSrid = fallbackRes.rows[0].srid;
        }
      } catch {
        // Keep default
      }
    }

    if (detectedSrid === 4326 && columnTypes[geomColumnName]) {
      const typeMatch = columnTypes[geomColumnName].match(/,\s*(\d+)\s*\)/);
      if (typeMatch && Number(typeMatch[1]) > 0) {
        detectedSrid = Number(typeMatch[1]);
      }
    }

    const existingIdx = colSelects.findIndex((s) => s === `"${geomSanitized}"`);
    const stGeoJsonExpr = `CASE WHEN "${geomSanitized}" IS NULL THEN NULL WHEN ST_SRID("${geomSanitized}") = 4326 THEN ST_AsGeoJSON("${geomSanitized}") WHEN ST_SRID("${geomSanitized}") > 0 THEN ST_AsGeoJSON(ST_Transform("${geomSanitized}", 4326)) ELSE ST_AsGeoJSON("${geomSanitized}") END AS "${geomSanitized}"`;
    if (existingIdx !== -1) {
      colSelects[existingIdx] = stGeoJsonExpr;
    } else {
      colSelects.push(stGeoJsonExpr);
    }
  }

  const selectClause = colSelects.length > 0 ? colSelects.join(", ") : "*";

  return { columnTypes, detectedSrid, selectClause, qualifiedTable };
}
