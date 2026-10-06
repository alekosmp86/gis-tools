import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/db/records/stream/route";
import { STREAMING_CHUNK_BATCH_SIZE, STREAMING_RECORD_THRESHOLD } from "@/core/constants/databaseConstants";
import { FakeClient, jsonReq, script, type DbScript } from "./pgFake";

vi.mock("pg", async () => {
  const m = await import("./pgFake");
  return { Client: m.FakeClient };
});

const BASE = { db_name: "db", user: "u", table_name: "t" };
const MISSING_MSG = "Los parámetros de conexión (base de datos, usuario y tabla) son obligatorios.";
const COLUMN_TYPES = { id: "integer", name: "text" };

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i }));

const lines = (text: string) =>
  text
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));

const run = async (s: DbScript, body: Record<string, unknown> = {}) => {
  FakeClient.responder = script(s);
  const res = await POST(jsonReq({ ...BASE, ...body }));
  const text = await res.text();
  return { res, text, msgs: lines(text), client: FakeClient.instances[0] };
};

describe("POST /api/db/records/stream", () => {
  beforeEach(() => {
    FakeClient.reset();
  });

  describe("validation", () => {
    it.each(["db_name", "user", "table_name"])("should return 400 JSON error when %s is missing", async (field) => {
      const body: Record<string, unknown> = { ...BASE };
      delete body[field];

      const res = await POST(jsonReq(body));

      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toBe("application/json");
      expect(await res.json()).toEqual({ type: "ERROR", error: MISSING_MSG });
      expect(FakeClient.instances).toHaveLength(0);
    });
  });

  describe("response headers", () => {
    it("should return NDJSON streaming headers", async () => {
      const { res } = await run({ count: 0 });

      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/x-ndjson; charset=utf-8");
      expect(res.headers.get("Cache-Control")).toBe("no-cache, no-transform");
      expect(res.headers.get("Transfer-Encoding")).toBe("chunked");
    });
  });

  describe("small datasets (single shot)", () => {
    it("should emit META, one CHUNK with all rows, then DONE", async () => {
      const rows = rowsOf(3);

      const { msgs, client } = await run({ count: 3, dataRows: rows });

      expect(msgs).toEqual([
        { type: "META", totalCount: 3, columnTypes: COLUMN_TYPES, detectedSrid: 4326 },
        { type: "CHUNK", current: 3, total: 3, rows },
        { type: "DONE" },
      ]);
      expect(client.end).toHaveBeenCalledTimes(1);
      expect(client.sqls.some((s) => s.startsWith("BEGIN") || s.startsWith("DECLARE"))).toBe(false);
    });

    it("should emit an empty CHUNK when the table is empty", async () => {
      const { msgs } = await run({ count: 0, dataRows: [] });

      expect(msgs.map((m) => m.type)).toEqual(["META", "CHUNK", "DONE"]);
      expect(msgs[1]).toEqual({ type: "CHUNK", current: 0, total: 0, rows: [] });
    });

    it("should use single-shot path when totalCount equals the threshold", async () => {
      const { msgs, client } = await run({ count: STREAMING_RECORD_THRESHOLD, dataRows: rowsOf(2) });

      expect(msgs.map((m) => m.type)).toEqual(["META", "CHUNK", "DONE"]);
      expect(client.sqls.some((s) => s.startsWith("DECLARE"))).toBe(false);
    });

    it("should report CHUNK current from the fetched row count, total from COUNT", async () => {
      const { msgs } = await run({ count: 10, dataRows: rowsOf(2) });

      expect(msgs[1]).toMatchObject({ current: 2, total: 10 });
    });

    it("should treat a missing COUNT row as totalCount 0", async () => {
      FakeClient.responder = (sql) => {
        if (sql.includes("COUNT(*)")) return { rows: [] };
        return script({ dataRows: [] })(sql, undefined);
      };

      const res = await POST(jsonReq(BASE));
      const msgs = lines(await res.text());

      expect(msgs[0]).toMatchObject({ type: "META", totalCount: 0 });
    });
  });

  describe("large datasets (server-side cursor)", () => {
    const over = STREAMING_RECORD_THRESHOLD + 1;

    it("should use BEGIN, DECLARE, FETCH, CLOSE, COMMIT in order and accumulate current across batches", async () => {
      const full = rowsOf(STREAMING_CHUNK_BATCH_SIZE);
      const tail = rowsOf(5);

      const { msgs, client } = await run({ count: over, fetchBatches: [full, tail] });

      expect(msgs.map((m) => m.type)).toEqual(["META", "CHUNK", "CHUNK", "DONE"]);
      expect(msgs[1]).toMatchObject({ current: STREAMING_CHUNK_BATCH_SIZE, total: over });
      expect(msgs[1].rows).toHaveLength(STREAMING_CHUNK_BATCH_SIZE);
      expect(msgs[2]).toMatchObject({ current: STREAMING_CHUNK_BATCH_SIZE + 5, total: over });
      expect(msgs[2].rows).toEqual(tail);

      const cursorSqls = client.sqls.filter((s) => /^(BEGIN|DECLARE|FETCH|CLOSE|COMMIT)/.test(s));
      expect(cursorSqls).toEqual([
        "BEGIN;",
        expect.stringMatching(/^DECLARE db_stream_cursor NO SCROLL CURSOR WITHOUT HOLD FOR \n?\s*SELECT /),
        `FETCH ${STREAMING_CHUNK_BATCH_SIZE} FROM db_stream_cursor;`,
        `FETCH ${STREAMING_CHUNK_BATCH_SIZE} FROM db_stream_cursor;`,
        "CLOSE db_stream_cursor;",
        "COMMIT;",
      ]);
      expect(client.end).toHaveBeenCalledTimes(1);
    });

    it("should stop after a short first batch without a second FETCH", async () => {
      const { msgs, client } = await run({ count: over, fetchBatches: [rowsOf(7)] });

      expect(msgs.map((m) => m.type)).toEqual(["META", "CHUNK", "DONE"]);
      expect(client.sqls.filter((s) => s.startsWith("FETCH"))).toHaveLength(1);
    });

    it("should stop on an empty batch after a full batch without emitting an empty CHUNK", async () => {
      const { msgs, client } = await run({ count: over, fetchBatches: [rowsOf(STREAMING_CHUNK_BATCH_SIZE), []] });

      expect(msgs.map((m) => m.type)).toEqual(["META", "CHUNK", "DONE"]);
      expect(client.sqls.filter((s) => s.startsWith("FETCH"))).toHaveLength(2);
    });

    it("should emit no CHUNK when the cursor returns nothing, still closing and committing", async () => {
      const { msgs, client } = await run({ count: over, fetchBatches: [] });

      expect(msgs.map((m) => m.type)).toEqual(["META", "DONE"]);
      expect(client.sqls).toContain("CLOSE db_stream_cursor;");
      expect(client.sqls).toContain("COMMIT;");
    });

    it("should embed the data query with LIMIT/OFFSET in the cursor declaration", async () => {
      const { client } = await run({ count: over, fetchBatches: [] }, { limit: 3, offset: 2 });

      const declare = client.sqls.find((s) => s.startsWith("DECLARE")) as string;
      expect(declare).toMatch(/"public"\."t"\s+LIMIT 3 OFFSET 2;\s*$/);
    });

    it("should run COUNT before the data path and not run the plain data query", async () => {
      const { client } = await run({ count: over, fetchBatches: [] });

      const countIdx = client.sqls.findIndex((s) => s.includes("COUNT(*)"));
      const beginIdx = client.sqls.indexOf("BEGIN;");
      expect(countIdx).toBeGreaterThan(-1);
      expect(countIdx).toBeLessThan(beginIdx);
      expect(client.sqls.filter((s) => s.trim().startsWith("SELECT") && s.includes("FROM") && !s.includes("COUNT") && !s.includes("information_schema"))).toHaveLength(0);
    });
  });

  describe("mid-stream errors", () => {
    it("should emit ERROR line with message and close the stream when the data query throws", async () => {
      const { msgs, client } = await run({ count: 1, dataError: new Error("data failed") });

      expect(msgs).toEqual([
        { type: "META", totalCount: 1, columnTypes: COLUMN_TYPES, detectedSrid: 4326 },
        { type: "ERROR", error: "data failed" },
      ]);
      expect(client.end).toHaveBeenCalledTimes(1);
    });

    it("should emit generic Spanish stream error when a non-Error is thrown", async () => {
      const { msgs } = await run({ count: 1, dataError: "weird" });

      expect(msgs[1]).toEqual({
        type: "ERROR",
        error: "Error durante la transmisión de registros de base de datos.",
      });
    });

    it("should emit ERROR after earlier CHUNKs when FETCH fails, without CLOSE/COMMIT/ROLLBACK", async () => {
      const { msgs, client } = await run({
        count: STREAMING_RECORD_THRESHOLD + 1,
        fetchError: new Error("fetch failed"),
      });

      expect(msgs.map((m) => m.type)).toEqual(["META", "ERROR"]);
      expect(msgs[1].error).toBe("fetch failed");
      expect(client.sqls).not.toContain("CLOSE db_stream_cursor;");
      expect(client.sqls).not.toContain("COMMIT;");
      expect(client.sqls.some((s) => s.startsWith("ROLLBACK"))).toBe(false);
      expect(client.end).toHaveBeenCalledTimes(1);
    });

    it("should still complete the stream when client.end throws in finally", async () => {
      FakeClient.responder = script({ count: 1, dataRows: rowsOf(1) });
      const res = await POST(jsonReq(BASE));
      FakeClient.instances[0].end.mockRejectedValue(new Error("end failed"));

      const msgs = lines(await res.text());

      expect(msgs.map((m) => m.type)).toEqual(["META", "CHUNK", "DONE"]);
    });

    it("should call client.end when the consumer cancels the stream", async () => {
      FakeClient.responder = (sql, params) => {
        if (sql.trim().startsWith("SELECT") && sql.includes("FROM") && !sql.includes("COUNT") && !sql.includes("information_schema")) {
          return new Promise(() => undefined);
        }
        return script({ count: 1 })(sql, params);
      };
      const res = await POST(jsonReq(BASE));
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const first = await reader.read();
      expect(JSON.parse(new TextDecoder().decode(first.value)).type).toBe("META");

      await reader.cancel();

      expect(FakeClient.instances[0].end).toHaveBeenCalledTimes(1);
    });
  });

  describe("outer errors", () => {
    it("should return 500 JSON error when connect rejects", async () => {
      FakeClient.connectError = new Error("ECONNREFUSED");

      const res = await POST(jsonReq(BASE));

      expect(res.status).toBe(500);
      expect(res.headers.get("Content-Type")).toBe("application/json");
      expect(await res.json()).toEqual({ type: "ERROR", error: "ECONNREFUSED" });
    });

    it("should return 500 with generic Spanish message when a non-Error is thrown", async () => {
      FakeClient.responder = (sql) => {
        if (sql.includes("information_schema.columns")) throw "nope";
        return { rows: [] };
      };

      const res = await POST(jsonReq(BASE));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        type: "ERROR",
        error: "Error al iniciar la consulta de registros en PostgreSQL.",
      });
    });

    it("should return 500 and not call client.end when the COUNT query throws (current behaviour, connection leak)", async () => {
      FakeClient.responder = (sql) => {
        if (sql.includes("information_schema.columns")) return { rows: [] };
        throw new Error("count failed");
      };

      const res = await POST(jsonReq(BASE));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ type: "ERROR", error: "count failed" });
      expect(FakeClient.instances[0].end).not.toHaveBeenCalled();
    });

    it("should return 500 when the request body is not valid JSON", async () => {
      const res = await POST(new Request("http://x", { method: "POST", body: "{bad" }));

      expect(res.status).toBe(500);
      expect((await res.json()).type).toBe("ERROR");
    });
  });
});
