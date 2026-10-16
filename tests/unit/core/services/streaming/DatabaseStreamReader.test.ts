import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseStreamReader } from "@/core/services/streaming/DatabaseStreamReader";
import type { DbConfig } from "@/core/types/db";

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
