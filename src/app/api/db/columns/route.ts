import { NextResponse } from "next/server";
import { Client } from "pg";

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

    // Query information_schema for column names
    const columnsQuery = `
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position;
    `;
    const colRes = await client.query(columnsQuery, [schema, table_name]);

    if (colRes.rows.length === 0) {
      await client.end();
      return NextResponse.json(
        {
          success: false,
          error: `No se encontraron columnas en '${schema}.${table_name}'. Verifique que el esquema y la tabla existan.`,
        },
        { status: 404 }
      );
    }

    // Query row count safely
    let rowCount = 0;
    try {
      const countRes = await client.query(
        `SELECT COUNT(*) FROM "${schema}"."${table_name}";`
      );
      rowCount = Number(countRes.rows[0].count);
    } catch {
      rowCount = 0;
    }

    await client.end();

    const columns = colRes.rows.map((row) => row.column_name);

    return NextResponse.json({
      success: true,
      schema,
      tableName: table_name,
      columns,
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
