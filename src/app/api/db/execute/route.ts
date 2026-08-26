import { NextResponse } from "next/server";
import { Client } from "pg";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { host, port, db_name, user, password, sqlScript } = body;

    if (!db_name || !user) {
      return NextResponse.json(
        { success: false, error: "El nombre de la base de datos y el usuario son obligatorios." },
        { status: 400 }
      );
    }

    if (!password) {
      return NextResponse.json(
        { success: false, error: "Debe ingresar la contraseña de la base de datos PostgreSQL." },
        { status: 400 }
      );
    }

    if (!sqlScript || typeof sqlScript !== "string" || !sqlScript.trim()) {
      return NextResponse.json(
        { success: false, error: "No hay sentencias SQL válidas para ejecutar." },
        { status: 400 }
      );
    }

    const client = new Client({
      host: host || "localhost",
      port: Number(port) || 5432,
      database: db_name,
      user,
      password,
      connectionTimeoutMillis: 10000,
    });

    await client.connect();

    let totalAffectedRows = 0;
    try {
      // Execute within an isolated transaction for safety
      await client.query("BEGIN;");

      const result = await client.query(sqlScript);

      // Extract affected row count if available
      if (Array.isArray(result)) {
        totalAffectedRows = result.reduce((sum, res) => sum + (res.rowCount || 0), 0);
      } else if (result && typeof result.rowCount === "number") {
        totalAffectedRows = result.rowCount;
      }

      await client.query("COMMIT;");
    } catch (dbErr) {
      // Automatic rollback on any query failure
      await client.query("ROLLBACK;").catch(() => {});
      throw dbErr;
    } finally {
      await client.end().catch(() => {});
    }

    return NextResponse.json({
      success: true,
      affectedRows: totalAffectedRows,
      message: `Ejecución exitosa en la base de datos ${db_name}. Registros modificados/insertados: ${totalAffectedRows}.`,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Error al ejecutar las sentencias SQL en PostgreSQL.";
    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
