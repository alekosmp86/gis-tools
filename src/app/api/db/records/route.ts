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

    const allSelectedCols = Array.from(new Set([...suidColsList, ...fields_to_compare]));

    // Query PostgreSQL information_schema for exact column data types
    const typesQuery = `
      SELECT column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_schema = $1 AND table_name = $2;
    `;
    const typesRes = await client.query(typesQuery, [schema_name, table_name]);
    const columnTypes: Record<string, string> = {};
    let geomColumnName: string | null = null;

    typesRes.rows.forEach((row: { column_name: string; data_type: string; udt_name?: string }) => {
      columnTypes[row.column_name] = row.data_type;
      const nameLower = row.column_name.toLowerCase();
      const udtLower = (row.udt_name || "").toLowerCase();
      if (
        nameLower === "geom" ||
        nameLower === "geometry" ||
        nameLower === "wkb_geometry" ||
        udtLower.includes("geometry")
      ) {
        geomColumnName = row.column_name;
      }
    });

    const colSelects: string[] = allSelectedCols.map((col) => `"${sanitizeIdentifier(col)}"`);
    let detectedSrid: number = 4326;

    // If table has a geometry column, automatically fetch it as GeoJSON & detect native SRID
    if (geomColumnName) {
      const geomSanitized = sanitizeIdentifier(geomColumnName);
      try {
        const sridQuery = `
          SELECT ST_SRID("${geomSanitized}") AS srid 
          FROM "${sanitizeIdentifier(schema_name)}"."${sanitizeIdentifier(table_name)}" 
          WHERE "${geomSanitized}" IS NOT NULL 
          LIMIT 1;
        `;
        const sridRes = await client.query(sridQuery);
        if (sridRes.rows.length > 0 && typeof sridRes.rows[0].srid === "number" && sridRes.rows[0].srid > 0) {
          detectedSrid = sridRes.rows[0].srid;
        }
      } catch {
        // Fallback to 4326 default
      }

      const existingIdx = colSelects.findIndex((s) => s === `"${geomSanitized}"`);
      const stGeoJsonExpr = `ST_AsGeoJSON("${geomSanitized}") AS "${geomSanitized}"`;
      if (existingIdx !== -1) {
        colSelects[existingIdx] = stGeoJsonExpr;
      } else {
        colSelects.push(stGeoJsonExpr);
      }
    }

    const selectClause = colSelects.length > 0 ? colSelects.join(", ") : "*";

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
      detectedSrid,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Error al consultar los registros de la base de datos.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
