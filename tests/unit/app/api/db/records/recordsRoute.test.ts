import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/db/records/route";
import { FakeClient, jsonReq, script } from "./pgFake";

vi.mock("pg", async () => {
  const m = await import("./pgFake");
  return { Client: m.FakeClient };
});

const BASE = { db_name: "db", user: "u", table_name: "t" };
const MISSING_MSG = "Los parámetros de conexión (base de datos, usuario y tabla) son obligatorios.";

describe("POST /api/db/records", () => {
  beforeEach(() => {
    FakeClient.reset();
  });

  describe("validation", () => {
    it.each(["db_name", "user", "table_name"])("should return 400 when %s is missing", async (field) => {
      const body: Record<string, unknown> = { ...BASE };
      delete body[field];

      const res = await POST(jsonReq(body));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ success: false, error: MISSING_MSG });
      expect(FakeClient.instances).toHaveLength(0);
    });

    it("should return 400 when a required field is an empty string", async () => {
      const res = await POST(jsonReq({ ...BASE, user: "" }));

      expect(res.status).toBe(400);
      expect(FakeClient.instances).toHaveLength(0);
    });
  });

  describe("success", () => {
    it("should return rows, rowCount as totalCount, columnTypes and detectedSrid and close the client", async () => {
      const rows = [{ id: 1, name: "a" }, { id: 2, name: "b" }];
      FakeClient.responder = script({ dataRows: rows });

      const res = await POST(jsonReq(BASE));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        success: true,
        records: rows,
        totalCount: 2,
        columnTypes: { id: "integer", name: "text" },
        detectedSrid: 4326,
      });
      expect(FakeClient.instances[0].end).toHaveBeenCalledTimes(1);
    });

    it("should return empty records and totalCount 0 for an empty table", async () => {
      FakeClient.responder = script({ dataRows: [] });

      const res = await POST(jsonReq(BASE));
      const json = await res.json();

      expect(json.records).toEqual([]);
      expect(json.totalCount).toBe(0);
    });

    it("should not issue a COUNT query", async () => {
      FakeClient.responder = script({ dataRows: [] });

      await POST(jsonReq(BASE));

      expect(FakeClient.instances[0].sqls.some((s) => s.includes("COUNT(*)"))).toBe(false);
    });

    it("should report totalCount as null in JSON when rowCount is null", async () => {
      FakeClient.responder = script({ dataRows: [], dataRowCount: null });

      const json = await (await POST(jsonReq(BASE))).json();

      expect(json.totalCount).toBeNull();
    });
  });

  describe("error handling", () => {
    it("should return 500 with the error message when the data query throws an Error", async () => {
      FakeClient.responder = script({ dataError: new Error("boom") });

      const res = await POST(jsonReq(BASE));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: "boom" });
    });

    it("should NOT call client.end when the data query throws (current behaviour, connection leak)", async () => {
      FakeClient.responder = script({ dataError: new Error("boom") });

      await POST(jsonReq(BASE));

      expect(FakeClient.instances[0].end).not.toHaveBeenCalled();
    });

    it("should return generic Spanish message when a non-Error value is thrown", async () => {
      FakeClient.responder = script({ dataError: "plain string" });

      const res = await POST(jsonReq(BASE));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        success: false,
        error: "Error al consultar los registros de la base de datos.",
      });
    });

    it("should return 500 with the error message when connect rejects", async () => {
      FakeClient.connectError = new Error("ECONNREFUSED");

      const res = await POST(jsonReq(BASE));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: "ECONNREFUSED" });
      expect(FakeClient.instances[0].query).not.toHaveBeenCalled();
    });

    it("should return 500 with message when the types query throws", async () => {
      FakeClient.responder = (sql) => {
        if (sql.includes("information_schema.columns")) throw new Error("types failed");
        return { rows: [] };
      };

      const res = await POST(jsonReq(BASE));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, error: "types failed" });
      expect(FakeClient.instances[0].end).not.toHaveBeenCalled();
    });

    it("should return 500 when the request body is not valid JSON", async () => {
      const res = await POST(new Request("http://x", { method: "POST", body: "{not json" }));

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.success).toBe(false);
      expect(typeof json.error).toBe("string");
    });
  });
});
