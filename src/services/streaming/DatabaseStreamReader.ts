import type { DbConfig, DatabaseFetchResult } from "@/types/db";
import type { ColumnMappingConfig } from "@/types/comparison";
import type { ProgressCallback } from "@/services/workerBridge";
import { formatNumber } from "@/utils/common/ValueFormatter";

interface StreamMetaMessage {
  type: "META";
  totalCount: number;
  columnTypes: Record<string, string>;
  detectedSrid: number;
}

interface StreamChunkMessage {
  type: "CHUNK";
  current: number;
  total: number;
  rows: Array<Record<string, unknown>>;
}

interface StreamErrorMessage {
  type: "ERROR";
  error: string;
}

interface StreamDoneMessage {
  type: "DONE";
}

type StreamMessage =
  | StreamMetaMessage
  | StreamChunkMessage
  | StreamErrorMessage
  | StreamDoneMessage;

export class DatabaseStreamReader {
  /**
   * Streams or fetches records progressively from PostGIS with real-time progress reporting.
   */
  public static async fetchOrStreamRecords(
    dbConfig: DbConfig,
    mappingConfig?: Partial<ColumnMappingConfig>,
    onProgress?: ProgressCallback,
    options?: { limit?: number; offset?: number }
  ): Promise<DatabaseFetchResult> {
    onProgress?.("Conectando a base de datos PostgreSQL...", 0, 0);

    const requestBody: Record<string, unknown> = {
      ...dbConfig,
      suid_columns: mappingConfig?.suidColumns,
      fields_to_compare: mappingConfig?.fieldsToCompare,
    };

    if (typeof options?.limit === "number" && options.limit > 0) {
      requestBody.limit = options.limit;
    }
    if (typeof options?.offset === "number" && options.offset > 0) {
      requestBody.offset = options.offset;
    }

    const response = await fetch("/api/db/records/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `Error HTTP (${response.status}) al conectar con el servicio de consulta PostGIS.`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");

    let lineBuffer = "";
    let columnTypes: Record<string, string> = {};
    let detectedSrid = 4326;
    let totalCount = 0;
    const records: Array<Record<string, unknown>> = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");

      // Retain the last incomplete fragment in lineBuffer
      lineBuffer = lines.pop() ?? "";

      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const rawLine = lines[lineIndex].trim();
        if (!rawLine) continue;

        try {
          const message: StreamMessage = JSON.parse(rawLine);

          if (message.type === "META") {
            totalCount = message.totalCount;
            columnTypes = message.columnTypes || {};
            detectedSrid = message.detectedSrid || 4326;

            onProgress?.(
              `Consultando registros PostGIS (0 de ${formatNumber(totalCount)})...`,
              0,
              totalCount
            );
          } else if (message.type === "CHUNK") {
            Array.prototype.push.apply(records, message.rows);

            const current = message.current;
            const total = message.total || totalCount;

            onProgress?.(
              `Consultando registros PostGIS (${formatNumber(current)} de ${formatNumber(total)})...`,
              current,
              total
            );
          } else if (message.type === "ERROR") {
            throw new Error(message.error);
          } else if (message.type === "DONE") {
            break;
          }
        } catch (parseError: unknown) {
          if (parseError instanceof Error && parseError.message.includes("Error")) {
            throw parseError;
          }
          // Ignore partial JSON parse warnings if line was split
        }
      }
    }

    // Process any remaining tail in lineBuffer
    if (lineBuffer.trim()) {
      try {
        const tailMessage: StreamMessage = JSON.parse(lineBuffer.trim());
        if (tailMessage.type === "CHUNK") {
          Array.prototype.push.apply(records, tailMessage.rows);
        } else if (tailMessage.type === "ERROR") {
          throw new Error(tailMessage.error);
        }
      } catch {
        // Safe disposal
      }
    }

    return {
      records,
      columnTypes,
      detectedSrid,
      totalCount: totalCount || records.length,
    };
  }
}
