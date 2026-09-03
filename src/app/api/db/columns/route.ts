import { NextResponse } from "next/server";
import { Client } from "pg";
import type { DbColumnMetadata } from "@/types/db";

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

    // Query information_schema joined with pg_attribute for exact PostGIS types (e.g. geometry(MultiPolygon, 32721))
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

    const columnDetails: DbColumnMetadata[] = colRes.rows.map((row) => ({
      column_name: row.column_name,
      data_type: row.full_data_type || row.data_type,
      is_nullable: row.is_nullable === "YES",
      column_default: row.column_default ? String(row.column_default) : null,
    }));

    const columns = columnDetails.map((col) => col.column_name);

    return NextResponse.json({
      success: true,
      schema,
      tableName: table_name,
      columns,
      columnDetails,
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
