import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/db/execute/route";
import { FakeClient, jsonReq } from "../records/pgFake";

vi.mock("pg", async () => {
  const m = await import("../records/pgFake");
  return { Client: m.FakeClient };
});

const BASE = { db_name: "db", user: "u", password: "pw", sqlScript: "SELECT 1;" };

const selectResult = (value: unknown) => ({ fields: [{ name: "setval" }], rows: [{ setval: value }], rowCount: 1 });
const writeResult = (rowCount: number) => ({ fields: [], rows: [], rowCount });

describe("POST /api/db/execute", () => {
  beforeEach(() => {
    FakeClient.reset();
  });

  describe("validation", () => {
    it.each(["db_name", "user", "password", "sqlScript"])("should return 400 when %s is missing", async (field) => {
      const body: Record<string, unknown> = { ...BASE };
      delete body[field];

      const res = await POST(jsonReq(body));

      expect(res.status).toBe(400);
      expect((await res.json()).success).toBe(false);
      expect(FakeClient.instances).toHaveLength(0);
    });

    it("should return 400 when sqlScript is blank", async () => {
      const res = await POST(jsonReq({ ...BASE, sqlScript: "   " }));

      expect(res.status).toBe(400);
    });
  });

  describe("selectResults", () => {
    it("should return one scalar per SELECT result in order for a multi-statement script", async () => {
      FakeClient.responder = (sql) =>
        sql === BASE.sqlScript ? [selectResult(5), writeResult(3), selectResult(9)] : { rows: [] };

      const res = await POST(jsonReq(BASE));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(json.success).toBe(true);
      expect(json.selectResults).toEqual([5, 9]);
      expect(json.affectedRows).toBe(5);
    });

    it("should return the scalar of a single SELECT result", async () => {
      FakeClient.responder = (sql) => (sql === BASE.sqlScript ? selectResult(42) : { rows: [] });

      const json = await (await POST(jsonReq(BASE))).json();

      expect(json.selectResults).toEqual([42]);
    });

    it("should return an empty selectResults array when there are no SELECT results", async () => {
      const sqlScript = "DELETE FROM t;\nINSERT INTO t VALUES (1);";
      FakeClient.responder = (sql) => (sql === sqlScript ? [writeResult(1), writeResult(2)] : { rows: [] });

      const json = await (await POST(jsonReq({ ...BASE, sqlScript }))).json();

      expect(json.selectResults).toEqual([]);
      expect(json.affectedRows).toBe(3);
    });
  });

  describe("transaction", () => {
    it("should run BEGIN, the script and COMMIT, then close the client", async () => {
      await POST(jsonReq(BASE));

      expect(FakeClient.instances[0].sqls).toEqual(["BEGIN;", BASE.sqlScript, "COMMIT;"]);
      expect(FakeClient.instances[0].end).toHaveBeenCalledTimes(1);
    });

    it("should roll back and return 500 without selectResults when the script fails", async () => {
      FakeClient.responder = (sql) => {
        if (sql === BASE.sqlScript) throw new Error("syntax error");
        return { rows: [] };
      };

      const res = await POST(jsonReq(BASE));
      const json = await res.json();

      expect(res.status).toBe(500);
      expect(json).toEqual({ success: false, error: "syntax error" });
      expect(FakeClient.instances[0].sqls).toContain("ROLLBACK;");
      expect(FakeClient.instances[0].sqls).not.toContain("COMMIT;");
    });
  });
});
