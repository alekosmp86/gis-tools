import { NextResponse } from "next/server";
import {
  REQUIRED_PARAMS_MESSAGE,
  buildRecordsDataQuery,
  createPgClient,
  hasRequiredConnectionParams,
  inspectRecordsTable,
  parseRecordsRequest,
} from "@/core/services/server/dbRecordsQuery";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const params = parseRecordsRequest(body);

    if (!hasRequiredConnectionParams(params)) {
      return NextResponse.json(
        { success: false, error: REQUIRED_PARAMS_MESSAGE },
        { status: 400 }
      );
    }

    const client = createPgClient(params);

    await client.connect();

    const info = await inspectRecordsTable(client, params);
    const query = buildRecordsDataQuery(info, params.limit, params.offset);

    const result = await client.query(query);
    await client.end();

    return NextResponse.json({
      success: true,
      records: result.rows,
      totalCount: result.rowCount,
      columnTypes: info.columnTypes,
      detectedSrid: info.detectedSrid,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Error al consultar los registros de la base de datos.";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
