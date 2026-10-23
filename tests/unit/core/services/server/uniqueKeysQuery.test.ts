import { describe, expect, it, vi } from "vitest";
import { readUniqueKeys } from "@/core/services/server/uniqueKeysQuery";

type CatalogRow = { is_primary: boolean; columns: string[] };

interface FakeClient {
  query: (sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
}

const SCHEMA = "public";
const TABLE = "parcelas";
const MAX_KEYS = 10;

function clientReturning(rows: CatalogRow[]) {
  const query = vi.fn<(sql: string, values: unknown[]) => Promise<{ rows: CatalogRow[] }>>(async () => ({ rows }));
  const client: FakeClient = { query };
  return { client, query };
}

function clientRejecting(error: Error) {
  const query = vi.fn<(sql: string, values: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>>(async () => {
    throw error;
  });
  const client: FakeClient = { query };
  return { client, query };
}

async function keysFor(rows: CatalogRow[]): Promise<string[][]> {
  const { client } = clientReturning(rows);
  return readUniqueKeys(client, SCHEMA, TABLE);
}

describe("readUniqueKeys", () => {
  describe("query", () => {
    it("should run exactly one query bound to the schema and table names when called", async () => {
      const { client, query } = clientReturning([]);

      await readUniqueKeys(client, SCHEMA, TABLE);

      expect(query).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledWith(expect.any(String), [SCHEMA, TABLE]);
    });

    it("should not interpolate the schema or table names into the SQL text when they contain quotes and separators", async () => {
      const hostileSchema = `pu'b"lic`;
      const hostileTable = `par'cel;DROP`;
      const { client, query } = clientReturning([]);

      await readUniqueKeys(client, hostileSchema, hostileTable);

      const [sql, values] = query.mock.calls[0];
      expect(sql).not.toContain(hostileSchema);
      expect(sql).not.toContain(hostileTable);
      expect(values).toEqual([hostileSchema, hostileTable]);
    });

    it("should read the catalog predicates for valid, unique, non-partial and expression-free indexes", async () => {
      const { client, query } = clientReturning([]);

      await readUniqueKeys(client, SCHEMA, TABLE);

      const [sql] = query.mock.calls[0];
      expect(sql).toMatch(/indisvalid/);
      expect(sql).toMatch(/indisunique/);
      expect(sql).toMatch(/indisprimary/);
      expect(sql).toMatch(/indpred\s+IS\s+NULL/i);
      expect(sql).toMatch(/indexprs\s+IS\s+NULL/i);
    });

    it("should limit the key columns to the real key attributes of an index with an INCLUDE clause", async () => {
      const { client, query } = clientReturning([]);

      await readUniqueKeys(client, SCHEMA, TABLE);

      const [sql] = query.mock.calls[0];
      expect(sql.replace(/\s+/g, "")).toContain("indnkeyatts");
    });

    it("should fall back to indnatts for the key column count when indnkeyatts is not available", async () => {
      const { client, query } = clientReturning([]);

      await readUniqueKeys(client, SCHEMA, TABLE);

      const [sql] = query.mock.calls[0];
      expect(sql.replace(/\s+/g, "")).toMatch(/COALESCE\(.*indnkeyatts.*,.*indnatts.*\)/i);
    });

    it("should reject with the same error when the catalog query rejects", async () => {
      const { client } = clientRejecting(new Error("permiso denegado para pg_index"));

      await expect(readUniqueKeys(client, SCHEMA, TABLE)).rejects.toThrow("permiso denegado para pg_index");
    });
  });

  describe("result shape", () => {
    it("should return an empty list when the table has no valid unique or primary key", async () => {
      expect(await keysFor([])).toEqual([]);
    });

    it("should return the primary key as the only entry when only a primary key exists", async () => {
      expect(await keysFor([{ is_primary: true, columns: ["id"] }])).toEqual([["id"]]);
    });

    it("should place the primary key first when the catalog returns it after a unique key", async () => {
      const keys = await keysFor([
        { is_primary: false, columns: ["codigo"] },
        { is_primary: true, columns: ["id"] },
      ]);

      expect(keys).toEqual([["id"], ["codigo"]]);
    });

    it("should keep the other unique keys in the order the catalog returned them", async () => {
      const keys = await keysFor([
        { is_primary: true, columns: ["id"] },
        { is_primary: false, columns: ["depto", "padron"] },
        { is_primary: false, columns: ["codigo"] },
      ]);

      expect(keys).toEqual([["id"], ["depto", "padron"], ["codigo"]]);
    });

    it("should keep a multi-column primary key in its own column order", async () => {
      const keys = await keysFor([{ is_primary: true, columns: ["depto", "localidad", "padron"] }]);

      expect(keys).toEqual([["depto", "localidad", "padron"]]);
    });

    it("should drop a unique key identical to the primary key when it has the same columns in the same order", async () => {
      const keys = await keysFor([
        { is_primary: true, columns: ["id"] },
        { is_primary: false, columns: ["id"] },
      ]);

      expect(keys).toEqual([["id"]]);
    });

    it("should drop a repeated unique key when it has the same columns in the same order", async () => {
      const keys = await keysFor([
        { is_primary: false, columns: ["depto", "padron"] },
        { is_primary: false, columns: ["depto", "padron"] },
      ]);

      expect(keys).toEqual([["depto", "padron"]]);
    });

    it("should keep a key whose columns are the same set in a different order", async () => {
      const keys = await keysFor([
        { is_primary: false, columns: ["depto", "padron"] },
        { is_primary: false, columns: ["padron", "depto"] },
      ]);

      expect(keys).toEqual([
        ["depto", "padron"],
        ["padron", "depto"],
      ]);
    });

    it("should drop a key with an empty column list", async () => {
      const keys = await keysFor([
        { is_primary: false, columns: [] },
        { is_primary: false, columns: ["codigo"] },
      ]);

      expect(keys).toEqual([["codigo"]]);
    });

    it("should preserve column names exactly as the catalog returned them", async () => {
      const keys = await keysFor([{ is_primary: false, columns: ["Cod_Depto"] }]);

      expect(keys).toEqual([["Cod_Depto"]]);
    });

    it("should keep exactly ten keys when ten distinct keys are returned including the primary key", async () => {
      const rows: CatalogRow[] = [
        { is_primary: true, columns: ["id"] },
        ...Array.from({ length: MAX_KEYS - 1 }, (_entry, index) => ({ is_primary: false, columns: [`u${index}`] })),
      ];

      const keys = await keysFor(rows);

      expect(keys).toHaveLength(MAX_KEYS);
      expect(keys[MAX_KEYS - 1]).toEqual([`u${MAX_KEYS - 2}`]);
    });

    it("should cap the result at ten keys including the primary key when more are returned", async () => {
      const rows: CatalogRow[] = [
        { is_primary: true, columns: ["id"] },
        ...Array.from({ length: 11 }, (_entry, index) => ({ is_primary: false, columns: [`u${index}`] })),
      ];

      const keys = await keysFor(rows);

      expect(keys).toHaveLength(MAX_KEYS);
      expect(keys[0]).toEqual(["id"]);
      expect(keys[MAX_KEYS - 1]).toEqual([`u${MAX_KEYS - 2}`]);
    });

    it("should return only unique keys in catalog order when the table has no primary key", async () => {
      const keys = await keysFor([
        { is_primary: false, columns: ["codigo"] },
        { is_primary: false, columns: ["nombre"] },
      ]);

      expect(keys).toEqual([["codigo"], ["nombre"]]);
    });
  });
});
