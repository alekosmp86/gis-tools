import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbConfig } from "@/core/types/db";
import { executeSqlInChunks } from "@/core/services/dbExecutionService";

const config = { host: "h", port: "5432", db_name: "db", user: "u" } as unknown as DbConfig;

type FakeResponse = { ok: boolean; body: Record<string, unknown> };

const okResponse = (selectResults?: unknown[], affectedRows?: number): FakeResponse => ({
  ok: true,
  body: { success: true, ...(selectResults ? { selectResults } : {}), ...(affectedRows !== undefined ? { affectedRows } : {}) },
});

describe("executeSqlInChunks selectResults", () => {
  const fetchMock = vi.fn();

  const queue = (...responses: FakeResponse[]) => {
    responses.forEach((response) =>
      fetchMock.mockResolvedValueOnce({ ok: response.ok, json: async () => response.body })
    );
  };

  const sentScripts = (): string[] => fetchMock.mock.calls.map((call) => JSON.parse(call[1].body).sqlScript);

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("should collect one scalar per SELECT in order across chunks", async () => {
    const script = ["SELECT setval('a', 1);", "SELECT setval('b', 2);", "SELECT setval('c', 3);"].join("\n");
    queue(okResponse([10, 20]), okResponse([30]));

    const result = await executeSqlInChunks(config, "pw", script, undefined, 2);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentScripts()).toEqual([
      "SELECT setval('a', 1);\nSELECT setval('b', 2);",
      "SELECT setval('c', 3);",
    ]);
    expect(result.success).toBe(true);
    expect(result.selectResults).toEqual([10, 20, 30]);
  });

  it("should add nothing for non-SELECT statements", async () => {
    const script = ["DELETE FROM t;", "SELECT setval('a', 1);", "INSERT INTO t VALUES (1);"].join("\n");
    queue(okResponse([7], 2));

    const result = await executeSqlInChunks(config, "pw", script, undefined, 500);

    expect(result.selectResults).toEqual([7]);
    expect(result.affectedRows).toBe(2);
  });

  it("should return an empty selectResults array when no chunk reports SELECT values", async () => {
    queue(okResponse(undefined, 1), okResponse([], 1));

    const result = await executeSqlInChunks(config, "pw", "DELETE FROM t;\nINSERT INTO t VALUES (1);", undefined, 1);

    expect(result.success).toBe(true);
    expect(result.selectResults).toEqual([]);
  });

  it("should return an empty selectResults array when the script has no statements", async () => {
    const result = await executeSqlInChunks(config, "pw", "-- only a comment\n\n");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.totalProcessed).toBe(0);
    expect(result.selectResults).toBeUndefined();
  });

  it("should keep values from successful chunks and skip the failed chunk", async () => {
    const script = ["SELECT setval('a', 1);", "SELECT setval('b', 2);", "SELECT setval('c', 3);"].join("\n");
    queue(okResponse([10]), { ok: false, body: { success: false, error: "boom" } }, okResponse([30]));

    const result = await executeSqlInChunks(config, "pw", script, undefined, 1);

    expect(result.success).toBe(false);
    expect(result.errorCount).toBe(1);
    expect(result.errors[0]).toMatch(/^Lote 2 \(2-2\): boom/);
    expect(result.selectResults).toEqual([10, 30]);
  });

  it("should report progress for every chunk", async () => {
    const onProgress = vi.fn();
    queue(okResponse([1]), okResponse([2]));

    await executeSqlInChunks(config, "pw", "SELECT 1;\nSELECT 2;", onProgress, 1);

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress.mock.calls[1][0]).toMatchObject({ currentBatch: 2, totalBatches: 2, pct: 100 });
  });
});
