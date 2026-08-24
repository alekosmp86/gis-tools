import { NextResponse } from "next/server";
import { Client } from "pg";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { host, port, db_name, user, password } = body;

    if (!db_name || !user) {
      return NextResponse.json(
        { success: false, error: "El nombre de la base de datos y el usuario son obligatorios." },
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
    await client.query("SELECT 1;");
    await client.end();

    return NextResponse.json({
      success: true,
      message: `Conexión exitosa a PostgreSQL (${db_name} en ${host}:${port})`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Error al conectar con la base de datos PostgreSQL.";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
