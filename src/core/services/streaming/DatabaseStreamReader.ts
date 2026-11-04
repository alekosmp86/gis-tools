import type { DbConfig, DatabaseFetchResult } from "@/core/types/db";
import type { ColumnMappingConfig, ProgressCallback } from "@/core/types/comparison";
import { formatNumber } from "@/core/common/ValueFormatter";

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

interface StreamState {
  columnTypes: Record<string, string>;
  detectedSrid: number;
  totalCount: number;
  records: Array<Record<string, unknown>>;
}

type FetchOptions = { limit?: number; offset?: number; rawValues?: boolean };

function buildRequestBody(
  dbConfig: DbConfig,
  mappingConfig?: Partial<ColumnMappingConfig>,
  options?: FetchOptions
): Record<string, unknown> {
  const requestBody: Record<string, unknown> = {
    ...dbConfig,
    suid_columns: mappingConfig?.suidColumns,
    fields_to_compare: mappingConfig?.fieldsToCompare,
    primary_key_column: mappingConfig?.primaryKeyColumn,
  };

  if (typeof options?.limit === "number" && options.limit > 0) {
    requestBody.limit = options.limit;
  }
  if (typeof options?.offset === "number" && options.offset > 0) {
    requestBody.offset = options.offset;
  }
  if (options?.rawValues) {
    requestBody.raw_text_values = true;
  }
  return requestBody;
}

function applyMessage(
  message: StreamMessage,
  state: StreamState,
  onProgress?: ProgressCallback
): boolean {
  switch (message.type) {
    case "META":
      state.totalCount = message.totalCount;
      state.columnTypes = message.columnTypes || {};
      state.detectedSrid = message.detectedSrid || 4326;
      onProgress?.(
        `Consultando registros PostGIS (0 de ${formatNumber(state.totalCount)})...`,
        0,
        state.totalCount
      );
      return false;
    case "CHUNK": {
      Array.prototype.push.apply(state.records, message.rows);
      const current = message.current;
      const total = message.total || state.totalCount;
      onProgress?.(
        `Consultando registros PostGIS (${formatNumber(current)} de ${formatNumber(total)})...`,
        current,
        total
      );
      return false;
    }
    case "ERROR":
      throw new Error(message.error);
    case "DONE":
      return true;
    default:
      return false;
  }
}

function processLine(rawLine: string, state: StreamState, onProgress?: ProgressCallback): boolean {
  try {
    return applyMessage(JSON.parse(rawLine) as StreamMessage, state, onProgress);
  } catch (parseError: unknown) {
    if (parseError instanceof Error && parseError.message.includes("Error")) {
      throw parseError;
    }
    return false;
  }
}

function processLines(
  lines: string[],
  state: StreamState,
  onProgress?: ProgressCallback
): void {
  for (const line of lines) {
    const rawLine = line.trim();
    if (!rawLine) continue;
    if (processLine(rawLine, state, onProgress)) return;
  }
}

function processTail(lineBuffer: string, records: Array<Record<string, unknown>>): void {
  const tail = lineBuffer.trim();
  if (!tail) return;
  try {
    const tailMessage: StreamMessage = JSON.parse(tail);
    if (tailMessage.type === "CHUNK") {
      Array.prototype.push.apply(records, tailMessage.rows);
    } else if (tailMessage.type === "ERROR") {
      throw new Error(tailMessage.error);
    }
  } catch {
    // Safe disposal
  }
}

export class DatabaseStreamReader {
  /**
   * Streams or fetches records progressively from PostGIS with real-time progress reporting.
   */
  public static async fetchOrStreamRecords(
    dbConfig: DbConfig,
    mappingConfig?: Partial<ColumnMappingConfig>,
    onProgress?: ProgressCallback,
    options?: FetchOptions
  ): Promise<DatabaseFetchResult> {
    onProgress?.("Conectando a base de datos PostgreSQL...", 0, 0);

    const response = await fetch("/api/db/records/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildRequestBody(dbConfig, mappingConfig, options)),
    });

    if (!response.ok || !response.body) {
      throw new Error(
        `Error HTTP (${response.status}) al conectar con el servicio de consulta PostGIS.`
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    const state: StreamState = { columnTypes: {}, detectedSrid: 4326, totalCount: 0, records: [] };
    let lineBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      processLines(lines, state, onProgress);
    }

    processTail(lineBuffer, state.records);

    return {
      records: state.records,
      columnTypes: state.columnTypes,
      detectedSrid: state.detectedSrid,
      totalCount: state.totalCount || state.records.length,
    };
  }
}
