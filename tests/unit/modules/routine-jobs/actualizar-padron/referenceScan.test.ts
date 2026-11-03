import { describe, expect, it } from "vitest";
import { NO_REFERENCE_SCAN, referenceScanOf } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/referenceScan";
import { referenceTablesScanSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import { scanReferenceTables } from "@/modules/routine-jobs/jobs/actualizar-padron/services/referenceTables";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";

const NO_TABLES_REASON = "No se encontraron tablas que referencien padrones: no se eliminan padrones faltantes.";

describe("referenceScanOf (AP-102, fail closed)", () => {
  it("should block every deletion with the no-tables reason when the catalog scan finds no table", () => {
    const scan = referenceScanOf([]);

    expect(scan.tables).toEqual([]);
    expect(scan.blockedReason).toBe(NO_TABLES_REASON);
  });

  it("should return the shared no-reference scan constant for an empty catalog result", () => {
    expect(referenceScanOf([])).toEqual(NO_REFERENCE_SCAN);
    expect(NO_REFERENCE_SCAN.blockedReason).toBe(NO_TABLES_REASON);
  });

  it("should block with a reason naming the table when the only found table cannot be read", () => {
    const scan = referenceScanOf([{ schema: "carto", table: "access_point", readable: false }]);

    expect(scan.tables).toEqual([]);
    expect(scan.blockedReason).toBe(
      "No se pueden leer las tablas que referencian padrones (carto.access_point): no se eliminan padrones faltantes."
    );
  });

  it("should name every unreadable table, in catalog order, and keep the readable ones for the counts", () => {
    const scan = referenceScanOf([
      { schema: "carto", table: "access_point", readable: true },
      { schema: "carto", table: "audit_log", readable: false },
      { schema: "carto", table: "invoices", readable: false },
    ]);

    expect(scan.tables).toEqual([{ schema: "carto", table: "access_point" }]);
    expect(scan.blockedReason).toBe(
      "No se pueden leer las tablas que referencian padrones (carto.audit_log, carto.invoices): no se eliminan padrones faltantes."
    );
  });

  it("should not block when every found table is readable, returning them all in order", () => {
    const scan = referenceScanOf([
      { schema: "carto", table: "access_point", readable: true },
      { schema: "carto", table: "internal_address_point", readable: true },
    ]);

    expect(scan.blockedReason).toBeNull();
    expect(scan.tables).toEqual([
      { schema: "carto", table: "access_point" },
      { schema: "carto", table: "internal_address_point" },
    ]);
  });

  it("should carry only the schema and the table name of a readable row, not its readable flag", () => {
    const scan = referenceScanOf([{ schema: "carto", table: "access_point", readable: true }]);

    expect(scan.tables[0]).toStrictEqual({ schema: "carto", table: "access_point" });
  });
});

const sessionAnswering = (rows: Array<Record<string, unknown>>): { session: RunSession; log: string[] } => {
  const log: string[] = [];
  const session: RunSession = {
    async query(sql: string) {
      log.push(sql);
      await Promise.resolve();
      return { rows };
    },
    async close() {},
  };
  return { session, log };
};

describe("scanReferenceTables (AP-102)", () => {
  it("should run the catalog scan for the carto schema and the destination table, and read it as a scan", async () => {
    const { session, log } = sessionAnswering([{ schema: "carto", table: "access_point", readable: true }]);

    const scan = await scanReferenceTables(session, "carto", "padron");

    expect(log).toEqual([referenceTablesScanSql("carto", "padron")]);
    expect(scan).toEqual({ tables: [{ schema: "carto", table: "access_point" }], blockedReason: null });
  });

  it("should block when the catalog returns no row", async () => {
    const { session } = sessionAnswering([]);

    const scan = await scanReferenceTables(session, "carto", "padron");

    expect(scan.blockedReason).toBe(NO_TABLES_REASON);
  });

  it("should treat a readable flag that is not exactly true as unreadable, never as readable", async () => {
    const { session } = sessionAnswering([
      { schema: "carto", table: "a", readable: null },
      { schema: "carto", table: "b", readable: "t" },
      { schema: "carto", table: "c" },
    ]);

    const scan = await scanReferenceTables(session, "carto", "padron");

    expect(scan.tables).toEqual([]);
    expect(scan.blockedReason).toContain("carto.a, carto.b, carto.c");
  });

  it("should let a failing catalog query fail the run instead of reading it as no references", async () => {
    const session: RunSession = {
      async query() {
        await Promise.resolve();
        throw new Error("permission denied for pg_class");
      },
      async close() {},
    };

    await expect(scanReferenceTables(session, "carto", "padron")).rejects.toThrow("permission denied for pg_class");
  });
});
