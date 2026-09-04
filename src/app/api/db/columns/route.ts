import { NextResponse } from "next/server";
import { Client } from "pg";
import type { DbColumnMetadata } from "@/types/db";

interface RawColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  full_data_type: string | null;
}

/**
 * Queries information_schema joined with pg_attribute for exact PostGIS data types.
 */
async function fetchColumnsMetadata(
  client: Client,
  schema: string,
  tableName: string
): Promise<RawColumnRow[]> {
  const columnsQuery = `
    SELECT 
      c.column_name, 
      c.data_type, 
      c.is_nullable, 
      c.column_default,
      format_type(a.atttypid, a.atttypmod) AS full_data_type
    FROM information_schema.columns c
    LEFT JOIN pg_attribute a 
      ON a.attname = c.column_name 
     AND a.attrelid = format('%I.%I', c.table_schema, c.table_name)::regclass
    WHERE c.table_schema = $1 AND c.table_name = $2
    ORDER BY c.ordinal_position;
  `;
  const result = await client.query<RawColumnRow>(columnsQuery, [schema, tableName]);
  return result.rows;
}

/**
 * Queries pg_index for a single-column primary key on the specified table.
 */
async function fetchPrimaryKeyColumn(
  client: Client,
  schema: string,
  tableName: string
): Promise<string | null> {
  try {
    const pkQuery = `
      SELECT a.attname
      FROM pg_index i
      JOIN pg_attribute a 
        ON a.attrelid = i.indrelid 
       AND a.attnum = ANY(i.indkey)
      WHERE i.indrelid = format('%I.%I', $1, $2)::regclass
        AND i.indisprimary;
    `;
    const pkResult = await client.query<{ attname: string }>(pkQuery, [schema, tableName]);
    if (pkResult.rows.length === 1) {
      return String(pkResult.rows[0].attname);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Queries the total row count of the specified table.
 */
async function fetchTableRowCount(
  client: Client,
  schema: string,
  tableName: string
): Promise<number> {
  try {
    const countResult = await client.query<{ count: string }>(
      `SELECT COUNT(*) FROM "${schema}"."${tableName}";`
    );
    return Number(countResult.rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

/**
 * Maps raw database column query rows into strongly typed DbColumnMetadata objects.
 */
function formatColumnDetails(
  rawRows: RawColumnRow[],
  primaryKeyColumn: string | null
): DbColumnMetadata[] {
  return rawRows.map((row) => ({
    column_name: row.column_name,
    data_type: row.full_data_type || row.data_type,
    is_nullable: row.is_nullable === "YES",
    column_default: row.column_default ? String(row.column_default) : null,
    is_primary_key: row.column_name === primaryKeyColumn,
  }));
}

/**
 * Main orchestrator route handler for PostgreSQL table column introspection.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { host, port, db_name, user, password, schema_name, table_name } = body;

    if (!db_name || !user || !table_name) {
      return NextResponse.json(
        { success: false, error: "Faltan parámetros requeridos (db_name, user, table_name)." },
        { status: 400 }
      );
    }

    const schema = schema_name || "public";
    const client = new Client({
      host: host || "localhost",
      port: Number(port) || 5432,
      database: db_name,
      user,
      password,
      connectionTimeoutMillis: 5000,
    });

    await client.connect();

    // 1. Fetch raw column metadata
    const rawColumns = await fetchColumnsMetadata(client, schema, table_name);
    if (rawColumns.length === 0) {
      await client.end();
      return NextResponse.json(
        {
          success: false,
          error: `No se encontraron columnas en '${schema}.${table_name}'. Verifique que el esquema y la tabla existan.`,
        },
        { status: 404 }
      );
    }

    // 2. Fetch primary key & row count concurrently/sequentially
    const primaryKeyColumn = await fetchPrimaryKeyColumn(client, schema, table_name);
    const rowCount = await fetchTableRowCount(client, schema, table_name);

    await client.end();

    // 3. Format result objects
    const columnDetails = formatColumnDetails(rawColumns, primaryKeyColumn);
    const columns = columnDetails.map((column) => column.column_name);

    return NextResponse.json({
      success: true,
      schema,
      tableName: table_name,
      columns,
      columnDetails,
      primaryKeyColumn,
      totalRows: rowCount,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error al inspeccionar las columnas de la tabla.";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
