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

    const suidColsList: string[] =
      Array.isArray(suid_columns) && suid_columns.length > 0
        ? suid_columns
        : suid_column
        ? [suid_column]
        : [];

    if (!db_name || !user || !table_name || suidColsList.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: "Los parámetros de conexión, tabla y columnas SUID son obligatorios.",
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

    // Combine suidColsList + fields_to_compare deduplicated
    const allSelectedCols = Array.from(new Set([...suidColsList, ...fields_to_compare]));
    const columnsToSelect = allSelectedCols.map((col) => `"${sanitizeIdentifier(col)}"`);

    const query = `
      SELECT ${columnsToSelect.join(", ")}
      FROM "${sanitizeIdentifier(schema_name)}"."${sanitizeIdentifier(table_name)}"
      LIMIT 10000;
    `;

    const result = await client.query(query);
    await client.end();

    return NextResponse.json({
      success: true,
      records: result.rows,
      totalCount: result.rowCount,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Error al consultar los registros de la base de datos.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
