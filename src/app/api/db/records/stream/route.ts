import {
  REQUIRED_PARAMS_MESSAGE,
  buildRecordsDataQuery,
  createPgClient,
  hasRequiredConnectionParams,
  inspectRecordsTable,
  parseRecordsRequest,
} from "@/core/services/server/dbRecordsQuery";
import { STREAMING_RECORD_THRESHOLD, STREAMING_CHUNK_BATCH_SIZE } from "@/core/constants/databaseConstants";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const params = parseRecordsRequest(body);

    if (!hasRequiredConnectionParams(params)) {
      return new Response(
        JSON.stringify({
          type: "ERROR",
          error: REQUIRED_PARAMS_MESSAGE,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const client = createPgClient(params);

    await client.connect();

    const info = await inspectRecordsTable(client, params);
    const { columnTypes, detectedSrid } = info;

    const countQuery = `
      SELECT COUNT(*)::int AS total 
      FROM ${info.qualifiedTable};
    `;
    const countRes = await client.query(countQuery);
    const totalCount: number = countRes.rows[0]?.total || 0;

    const dataQuery = buildRecordsDataQuery(info, params.limit, params.offset);

    const encoder = new TextEncoder();

    // 4. Create Web ReadableStream for progressive NDJSON delivery
    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          // Send Metadata Line First
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "META",
                totalCount,
                columnTypes,
                detectedSrid,
              }) + "\n"
            )
          );

          if (totalCount <= STREAMING_RECORD_THRESHOLD) {
            // Fast single-shot fetch for small datasets
            const singleResult = await client.query(dataQuery);
            controller.enqueue(
              encoder.encode(
                JSON.stringify({
                  type: "CHUNK",
                  current: singleResult.rows.length,
                  total: totalCount,
                  rows: singleResult.rows,
                }) + "\n"
              )
            );
          } else {
            // Server-side cursor streaming for large datasets (1M+ rows)
            await client.query("BEGIN;");
            await client.query(`DECLARE db_stream_cursor NO SCROLL CURSOR WITHOUT HOLD FOR ${dataQuery}`);

            let accumulatedCount = 0;
            let hasMore = true;

            while (hasMore) {
              const fetchResult = await client.query(
                `FETCH ${STREAMING_CHUNK_BATCH_SIZE} FROM db_stream_cursor;`
              );
              const batchRows = fetchResult.rows;

              if (batchRows.length === 0) {
                hasMore = false;
                break;
              }

              accumulatedCount += batchRows.length;

              controller.enqueue(
                encoder.encode(
                  JSON.stringify({
                    type: "CHUNK",
                    current: accumulatedCount,
                    total: totalCount,
                    rows: batchRows,
                  }) + "\n"
                )
              );

              if (batchRows.length < STREAMING_CHUNK_BATCH_SIZE) {
                hasMore = false;
              }
            }

            await client.query("CLOSE db_stream_cursor;");
            await client.query("COMMIT;");
          }

          controller.enqueue(encoder.encode(JSON.stringify({ type: "DONE" }) + "\n"));
          controller.close();
        } catch (streamError: unknown) {
          const errorMessage =
            streamError instanceof Error
              ? streamError.message
              : "Error durante la transmisión de registros de base de datos.";
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "ERROR",
                error: errorMessage,
              }) + "\n"
            )
          );
          controller.close();
        } finally {
          try {
            await client.end();
          } catch {
            // Connection safe close
          }
        }
      },
      async cancel() {
        try {
          await client.end();
        } catch {
          // Connection safe close
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Transfer-Encoding": "chunked",
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : "Error al iniciar la consulta de registros en PostgreSQL.";
    return new Response(JSON.stringify({ type: "ERROR", error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
