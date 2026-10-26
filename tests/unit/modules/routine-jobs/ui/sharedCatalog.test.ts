import { describe, expect, it, vi } from "vitest";
import { buildSharedLoadTables, firstCatalogError } from "@/modules/routine-jobs/ui/sharedCatalog";
import type { ClientConnection } from "@/modules/routine-jobs/ui/clientTypes";
import type { TableListing } from "@/core/types/tableCatalog";

const connection: ClientConnection = { host: "db.local", port: "5432", db_name: "gis", user: "carto", password: "pw" };

const listingOf = (name: string): TableListing => ({ schemaExists: true, tables: [{ name, kind: "TABLE" }] });

function fakeClient(listTables: (connection: ClientConnection, schema: string) => Promise<TableListing>) {
  return { listTables: vi.fn(listTables) };
}

describe("sharedCatalog", () => {
  describe("buildSharedLoadTables", () => {
    it("AC-3b: should hit client.listTables once for three simultaneous calls with the same schema", async () => {
      let release!: (listing: TableListing) => void;
      const client = fakeClient(() => new Promise<TableListing>((resolve) => (release = resolve)));
      const loadTables = buildSharedLoadTables(client, connection);

      const calls = [loadTables("carto"), loadTables("carto"), loadTables("carto")];
      release(listingOf("rural"));

      expect(client.listTables).toHaveBeenCalledTimes(1);
      expect(client.listTables).toHaveBeenCalledWith(connection, "carto");
      const answers = await Promise.all(calls);
      expect(answers).toEqual([listingOf("rural"), listingOf("rural"), listingOf("rural")]);
    });

    it("AC-3b: should call the client again for a different schema", async () => {
      const client = fakeClient(async (_connection, schema) => listingOf(schema));
      const loadTables = buildSharedLoadTables(client, connection);

      const [first, second] = await Promise.all([loadTables("uno"), loadTables("dos")]);

      expect(client.listTables).toHaveBeenCalledTimes(2);
      expect(first).toEqual(listingOf("uno"));
      expect(second).toEqual(listingOf("dos"));
    });

    it("AC-3b: should call the client again once the previous call settled", async () => {
      const client = fakeClient(async () => listingOf("rural"));
      const loadTables = buildSharedLoadTables(client, connection);

      await loadTables("carto");
      await loadTables("carto");

      expect(client.listTables).toHaveBeenCalledTimes(2);
    });

    it("AC-3b: should propagate a failure to every simultaneous caller and allow a retry", async () => {
      const client = fakeClient(async () => {
        throw new Error("ECONNREFUSED");
      });
      const loadTables = buildSharedLoadTables(client, connection);

      const results = await Promise.allSettled([loadTables("carto"), loadTables("carto")]);

      expect(client.listTables).toHaveBeenCalledTimes(1);
      expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"]);
      await expect(loadTables("carto")).rejects.toThrow("ECONNREFUSED");
      expect(client.listTables).toHaveBeenCalledTimes(2);
    });
  });

  describe("firstCatalogError", () => {
    it("AC-3b: should return the first non-null error", () => {
      expect(firstCatalogError([null, "primero", "segundo"])).toBe("primero");
    });

    it("AC-3b: should return null when every entry is null", () => {
      expect(firstCatalogError([null, null, null])).toBeNull();
    });

    it("AC-3b: should return null for an empty list", () => {
      expect(firstCatalogError([])).toBeNull();
    });

    it("AC-3b: should return the only error when it is the last entry", () => {
      expect(firstCatalogError([null, null, "tercero"])).toBe("tercero");
    });
  });
});
