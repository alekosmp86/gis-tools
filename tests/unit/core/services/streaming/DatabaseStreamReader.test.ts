import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseStreamReader } from "@/core/services/streaming/DatabaseStreamReader";
import type { DbConfig } from "@/core/types/db";
import { formatNumber } from "@/core/common/ValueFormatter";

const config = { db_name: "d", user: "u", table_name: "t", schema_name: "public" } as unknown as DbConfig;

const ndjson = (...msgs: unknown[]) => msgs.map((m) => JSON.stringify(m)).join("\n") + "\n";

const okResponse = () =>
  new Response(
    ndjson(
      { type: "META", totalCount: 1, columnTypes: { id: "integer" }, detectedSrid: 4326 },
      { type: "CHUNK", current: 1, total: 1, rows: [{ id: "1.0" }] },
      { type: "DONE" }
    ),
    { status: 200 }
  );

describe("DatabaseStreamReader.fetchOrStreamRecords request body", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const sentBody = (): Record<string, unknown> => JSON.parse(fetchMock.mock.calls[0][1].body as string);

  it("should send raw_text_values true when options.rawValues is true", async () => {
    await DatabaseStreamReader.fetchOrStreamRecords(config, undefined, undefined, { rawValues: true });

    expect(fetchMock.mock.calls[0][0]).toBe("/api/db/records/stream");
    expect(sentBody().raw_text_values).toBe(true);
  });

  it.each([
    ["options omitted", undefined],
    ["options empty", {}],
    ["rawValues false", { rawValues: false }],
    ["rawValues undefined", { rawValues: undefined }],
    ["only limit set", { limit: 1 }],
  ])("should omit raw_text_values when %s", async (_label, options) => {
    await DatabaseStreamReader.fetchOrStreamRecords(config, undefined, undefined, options);

    expect(sentBody()).not.toHaveProperty("raw_text_values");
  });

  it("should send limit and raw_text_values together when both are requested", async () => {
    await DatabaseStreamReader.fetchOrStreamRecords(config, undefined, undefined, { limit: 5, rawValues: true });

    expect(sentBody()).toMatchObject({ limit: 5, raw_text_values: true });
  });

  it("should return the records streamed by the server", async () => {
    const result = await DatabaseStreamReader.fetchOrStreamRecords(config, undefined, undefined, { rawValues: true });

    expect(result.records).toEqual([{ id: "1.0" }]);
    expect(result.totalCount).toBe(1);
  });

  it("should throw an HTTP error when the response is not ok", async () => {
    fetchMock.mockImplementation(async () => new Response("x", { status: 500 }));

    await expect(DatabaseStreamReader.fetchOrStreamRecords(config)).rejects.toThrow(/Error HTTP \(500\)/);
  });
});

function streamResponse(chunks: Array<string | Uint8Array>, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
  return new Response(stream, { status });
}

describe("DatabaseStreamReader.fetchOrStreamRecords stream handling", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const respondWith = (...chunks: Array<string | Uint8Array>) => {
    fetchMock.mockImplementation(async () => streamResponse(chunks));
  };
  const sentBody = (): Record<string, unknown> => JSON.parse(fetchMock.mock.calls[0][1].body as string);

  describe("request body", () => {
    beforeEach(() => respondWith(ndjson({ type: "DONE" })));

    it("should map the mapping config to snake_case request fields", async () => {
      await DatabaseStreamReader.fetchOrStreamRecords(config, {
        suidColumns: ["a"],
        fieldsToCompare: ["b", "c"],
        primaryKeyColumn: "pk",
      });

      expect(sentBody()).toMatchObject({
        db_name: "d",
        table_name: "t",
        suid_columns: ["a"],
        fields_to_compare: ["b", "c"],
        primary_key_column: "pk",
      });
    });

    it("should send limit and offset when both are positive numbers", async () => {
      await DatabaseStreamReader.fetchOrStreamRecords(config, undefined, undefined, { limit: 50, offset: 100 });

      expect(sentBody()).toMatchObject({ limit: 50, offset: 100 });
    });

    it.each([
      ["zero", 0],
      ["negative", -3],
      ["undefined", undefined],
    ])("should omit limit and offset when they are %s", async (_label, value) => {
      await DatabaseStreamReader.fetchOrStreamRecords(config, undefined, undefined, { limit: value, offset: value });

      expect(sentBody()).not.toHaveProperty("limit");
      expect(sentBody()).not.toHaveProperty("offset");
    });

    it("should send only the offset when no limit is requested", async () => {
      await DatabaseStreamReader.fetchOrStreamRecords(config, undefined, undefined, { offset: 7 });

      expect(sentBody()).toMatchObject({ offset: 7 });
      expect(sentBody()).not.toHaveProperty("limit");
    });

    it("should POST JSON to the stream endpoint", async () => {
      await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(fetchMock.mock.calls[0][0]).toBe("/api/db/records/stream");
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
    });
  });

  describe("HTTP failures", () => {
    it("should throw when the response has no body", async () => {
      fetchMock.mockImplementation(async () => new Response(null, { status: 200 }));

      await expect(DatabaseStreamReader.fetchOrStreamRecords(config)).rejects.toThrow(/Error HTTP \(200\)/);
    });
  });

  describe("META message", () => {
    it("should expose columnTypes, detectedSrid and totalCount from META", async () => {
      respondWith(ndjson({ type: "META", totalCount: 9, columnTypes: { a: "text" }, detectedSrid: 5381 }));

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result).toEqual({ records: [], columnTypes: { a: "text" }, detectedSrid: 5381, totalCount: 9 });
    });

    it("should default columnTypes to empty and detectedSrid to 4326 when META omits them", async () => {
      respondWith(ndjson({ type: "META", totalCount: 2 }));

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.columnTypes).toEqual({});
      expect(result.detectedSrid).toBe(4326);
    });

    it("should default detectedSrid to 4326 when META reports 0", async () => {
      respondWith(ndjson({ type: "META", totalCount: 2, columnTypes: {}, detectedSrid: 0 }));

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.detectedSrid).toBe(4326);
    });

    it("should report the connecting and zero-progress messages", async () => {
      respondWith(ndjson({ type: "META", totalCount: 1500, columnTypes: {}, detectedSrid: 4326 }));
      const onProgress = vi.fn();

      await DatabaseStreamReader.fetchOrStreamRecords(config, undefined, onProgress);

      expect(onProgress).toHaveBeenNthCalledWith(1, "Conectando a base de datos PostgreSQL...", 0, 0);
      expect(onProgress).toHaveBeenNthCalledWith(
        2,
        `Consultando registros PostGIS (0 de ${formatNumber(1500)})...`,
        0,
        1500
      );
    });
  });

  describe("CHUNK message", () => {
    it("should accumulate rows from several chunks in order", async () => {
      respondWith(
        ndjson(
          { type: "CHUNK", current: 2, total: 3, rows: [{ id: 1 }, { id: 2 }] },
          { type: "CHUNK", current: 3, total: 3, rows: [{ id: 3 }] }
        )
      );

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      expect(result.totalCount).toBe(3);
    });

    it("should report chunk progress using the chunk total", async () => {
      respondWith(ndjson({ type: "CHUNK", current: 2, total: 4, rows: [{ id: 1 }, { id: 2 }] }));
      const onProgress = vi.fn();

      await DatabaseStreamReader.fetchOrStreamRecords(config, undefined, onProgress);

      expect(onProgress).toHaveBeenLastCalledWith(
        `Consultando registros PostGIS (${formatNumber(2)} de ${formatNumber(4)})...`,
        2,
        4
      );
    });

    it("should fall back to the META total when the chunk total is 0", async () => {
      respondWith(
        ndjson(
          { type: "META", totalCount: 8, columnTypes: {}, detectedSrid: 4326 },
          { type: "CHUNK", current: 1, total: 0, rows: [{ id: 1 }] }
        )
      );
      const onProgress = vi.fn();

      await DatabaseStreamReader.fetchOrStreamRecords(config, undefined, onProgress);

      expect(onProgress).toHaveBeenLastCalledWith(expect.any(String), 1, 8);
    });

    it("should use the number of records as totalCount when the server never reports a total", async () => {
      respondWith(ndjson({ type: "CHUNK", current: 2, total: 0, rows: [{ id: 1 }, { id: 2 }] }));

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.totalCount).toBe(2);
    });

    it("should handle a large chunk without overflowing the call stack", async () => {
      const rows = Array.from({ length: 50_000 }, (_unused, index) => ({ id: index }));
      respondWith(ndjson({ type: "CHUNK", current: rows.length, total: rows.length, rows }));

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toHaveLength(50_000);
    });
  });

  describe("line framing", () => {
    it("should reassemble a message split across network chunks", async () => {
      const line = JSON.stringify({ type: "CHUNK", current: 1, total: 1, rows: [{ id: 1 }] });
      respondWith(line.slice(0, 10), line.slice(10) + "\n");

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ id: 1 }]);
    });

    it("should decode a multibyte character split across network chunks", async () => {
      const bytes = new TextEncoder().encode(
        JSON.stringify({ type: "CHUNK", current: 1, total: 1, rows: [{ name: "Ñandú" }] }) + "\n"
      );
      const splitAt = bytes.indexOf(0xc3) + 1;
      respondWith(bytes.slice(0, splitAt), bytes.slice(splitAt));

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ name: "Ñandú" }]);
    });

    it("should ignore blank and whitespace-only lines", async () => {
      respondWith(`\n  \n${JSON.stringify({ type: "CHUNK", current: 1, total: 1, rows: [{ id: 1 }] })}\n\n`);

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ id: 1 }]);
    });

    it("should skip a line that is not valid JSON and keep processing the next ones", async () => {
      respondWith(`not json\n${JSON.stringify({ type: "CHUNK", current: 1, total: 1, rows: [{ id: 1 }] })}\n`);

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ id: 1 }]);
    });

    it("should ignore a message with an unknown type", async () => {
      respondWith(ndjson({ type: "PING" }, { type: "CHUNK", current: 1, total: 1, rows: [{ id: 1 }] }));

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ id: 1 }]);
    });

    it("should return an empty result for an empty stream", async () => {
      respondWith();

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result).toEqual({ records: [], columnTypes: {}, detectedSrid: 4326, totalCount: 0 });
    });
  });

  describe("tail buffer", () => {
    it("should append the rows of a final CHUNK that has no trailing newline", async () => {
      respondWith(JSON.stringify({ type: "CHUNK", current: 1, total: 1, rows: [{ id: 9 }] }));

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ id: 9 }]);
    });

    it("should keep earlier records when the tail is a CHUNK after complete lines", async () => {
      respondWith(
        ndjson({ type: "CHUNK", current: 1, total: 2, rows: [{ id: 1 }] }) +
          JSON.stringify({ type: "CHUNK", current: 2, total: 2, rows: [{ id: 2 }] })
      );

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("should swallow a final ERROR message without a trailing newline", async () => {
      respondWith(JSON.stringify({ type: "ERROR", error: "Error: late failure" }));

      await expect(DatabaseStreamReader.fetchOrStreamRecords(config)).resolves.toMatchObject({ records: [] });
    });

    it("should swallow a malformed tail", async () => {
      respondWith('{"type":"CHUNK","rows":[');

      await expect(DatabaseStreamReader.fetchOrStreamRecords(config)).resolves.toMatchObject({ records: [] });
    });

    it("should ignore a whitespace-only tail", async () => {
      respondWith(ndjson({ type: "DONE" }) + "   ");

      await expect(DatabaseStreamReader.fetchOrStreamRecords(config)).resolves.toMatchObject({ records: [] });
    });

    it("should ignore a tail that is neither CHUNK nor ERROR", async () => {
      respondWith(JSON.stringify({ type: "DONE" }));

      await expect(DatabaseStreamReader.fetchOrStreamRecords(config)).resolves.toMatchObject({ records: [] });
    });
  });

  describe("ERROR message", () => {
    it("should reject when the server error message contains the word Error", async () => {
      respondWith(ndjson({ type: "ERROR", error: "Error de conexion con PostgreSQL" }));

      await expect(DatabaseStreamReader.fetchOrStreamRecords(config)).rejects.toThrow(
        "Error de conexion con PostgreSQL"
      );
    });

    it("should swallow a server error whose message lacks the word Error (documented quirk)", async () => {
      respondWith(
        ndjson(
          { type: "ERROR", error: "relation does not exist" },
          { type: "CHUNK", current: 1, total: 1, rows: [{ id: 1 }] }
        )
      );

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ id: 1 }]);
    });

    it("should reject even when records were received before the error", async () => {
      respondWith(
        ndjson(
          { type: "CHUNK", current: 1, total: 2, rows: [{ id: 1 }] },
          { type: "ERROR", error: "Error: boom" }
        )
      );

      await expect(DatabaseStreamReader.fetchOrStreamRecords(config)).rejects.toThrow("Error: boom");
    });
  });

  describe("DONE message", () => {
    it("should stop processing the remaining lines of the current network chunk", async () => {
      respondWith(
        ndjson(
          { type: "CHUNK", current: 1, total: 2, rows: [{ id: 1 }] },
          { type: "DONE" },
          { type: "CHUNK", current: 2, total: 2, rows: [{ id: 2 }] }
        )
      );

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ id: 1 }]);
    });

    it("should still process lines that arrive in later network chunks (documented quirk)", async () => {
      respondWith(
        ndjson({ type: "CHUNK", current: 1, total: 2, rows: [{ id: 1 }] }, { type: "DONE" }),
        ndjson({ type: "CHUNK", current: 2, total: 2, rows: [{ id: 2 }] })
      );

      const result = await DatabaseStreamReader.fetchOrStreamRecords(config);

      expect(result.records).toEqual([{ id: 1 }, { id: 2 }]);
    });
  });
});
