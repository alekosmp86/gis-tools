import { NextResponse } from "next/server";
import { Client } from "pg";

export async function POST(request: Request) {
  try {
    const body = await request.json();
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
    } = body;

    if (!db_name || !user || !table_name) {
      return NextResponse.json(
        {
          success: false,
          error: "Los parámetros de conexión (base de datos, usuario y tabla) son obligatorios.",
        },
        { status: 400 }
      );
    }

    const client = new Client({
      host: host || "localhost",
      port: Number(port) || 5432,
      database: db_name,
      user,
      password,
      connectionTimeoutMillis: 5000,
    });

    await client.connect();

    const sanitizeIdentifier = (id: string) => id.replace(/"/g, '""');

    const suidColsList: string[] =
      Array.isArray(suid_columns) && suid_columns.length > 0
        ? suid_columns
        : suid_column
        ? [suid_column]
        : [];

    // Combine suidColsList + fields_to_compare deduplicated
    const allSelectedCols = Array.from(new Set([...suidColsList, ...fields_to_compare]));
    const selectClause =
      allSelectedCols.length > 0
        ? allSelectedCols.map((col) => `"${sanitizeIdentifier(col)}"`).join(", ")
        : "*";

    // Query PostgreSQL information_schema for exact column data types
    const typesQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = $2;
    `;
    const typesRes = await client.query(typesQuery, [schema_name, table_name]);
    const columnTypes: Record<string, string> = {};
    typesRes.rows.forEach((row: { column_name: string; data_type: string }) => {
      columnTypes[row.column_name] = row.data_type;
    });

    const query = `
      SELECT ${selectClause}
      FROM "${sanitizeIdentifier(schema_name)}"."${sanitizeIdentifier(table_name)}";
    `;

    const result = await client.query(query);
    await client.end();

    return NextResponse.json({
      success: true,
      records: result.rows,
      totalCount: result.rowCount,
      columnTypes,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Error al consultar los registros de la base de datos.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
