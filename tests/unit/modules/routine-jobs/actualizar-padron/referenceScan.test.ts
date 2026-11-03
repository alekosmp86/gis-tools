import { describe, expect, it } from "vitest";
import { NO_REFERENCE_SCAN, referenceScanOf, type ReferenceScanRow } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/referenceScan";
import { REASSIGN_BLOCKER } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reassignBlockers";
import { referenceTablesScanSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/replacementSql";
import { scanReferenceTables } from "@/modules/routine-jobs/jobs/actualizar-padron/services/referenceTables";
import type { RunSession } from "@/modules/routine-jobs/jobs/cargar-padrones/types";

const NO_PK = REASSIGN_BLOCKER.NO_PRIMARY_KEY;
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

    expect(scan.tables).toEqual([{ schema: "carto", table: "access_point", reassignBlocker: NO_PK }]);
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
      { schema: "carto", table: "access_point", reassignBlocker: NO_PK },
      { schema: "carto", table: "internal_address_point", reassignBlocker: NO_PK },
    ]);
  });

  it("should carry the schema, the table name and the fail-closed blocker of a readable row without facts, not its readable flag", () => {
    const scan = referenceScanOf([{ schema: "carto", table: "access_point", readable: true }]);

    expect(scan.tables[0]).toStrictEqual({ schema: "carto", table: "access_point", reassignBlocker: NO_PK });
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

    const scan = await scanReferenceTables(session, "carto", "padron", true);

    expect(log).toEqual([referenceTablesScanSql("carto", "padron")]);
    expect(scan).toEqual({ tables: [{ schema: "carto", table: "access_point", reassignBlocker: NO_PK }], blockedReason: null });
  });

  it("should block when the catalog returns no row", async () => {
    const { session } = sessionAnswering([]);

    const scan = await scanReferenceTables(session, "carto", "padron", true);

    expect(scan.blockedReason).toBe(NO_TABLES_REASON);
  });

  it("should treat a readable flag that is not exactly true as unreadable, never as readable", async () => {
    const { session } = sessionAnswering([
      { schema: "carto", table: "a", readable: null },
      { schema: "carto", table: "b", readable: "t" },
      { schema: "carto", table: "c" },
    ]);

    const scan = await scanReferenceTables(session, "carto", "padron", true);

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

    await expect(scanReferenceTables(session, "carto", "padron", true)).rejects.toThrow("permission denied for pg_class");
  });
});

const factsRow = (overrides: Partial<ReferenceScanRow> = {}): ReferenceScanRow => ({
  schema: "carto",
  table: "access_point",
  readable: true,
  updatable: true,
  primaryKeyColumns: 1,
  primaryKeyColumn: "gid",
  geometryColumns: 1,
  geometryColumn: "geom",
  geometryType: "geometry",
  ...overrides,
});

const catalogRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: "carto",
  table: "access_point",
  readable: true,
  updatable: true,
  pk_columns: 1,
  pk_column: "gid",
  geometry_columns: 1,
  geometry_column: "geom",
  geometry_type: "geometry",
  ...overrides,
});

describe("referenceScanOf reassign facts (AP-110, AP-114)", () => {
  it("should give a table with one primary key, one geometry column and update privilege a reassign target", () => {
    const scan = referenceScanOf([factsRow()]);

    expect(scan.tables).toEqual([
      { schema: "carto", table: "access_point", reassign: { pkColumn: "gid", geometryColumn: "geom", geography: false } },
    ]);
  });

  it("should flag a geography column so the point is read as a geometry", () => {
    const scan = referenceScanOf([factsRow({ geometryType: "geography" })]);

    expect(scan.tables[0].reassign?.geography).toBe(true);
  });

  it.each([
    ["no primary key", { primaryKeyColumns: 0, primaryKeyColumn: null }, REASSIGN_BLOCKER.NO_PRIMARY_KEY],
    ["a composite primary key", { primaryKeyColumns: 2, primaryKeyColumn: "a" }, REASSIGN_BLOCKER.NO_PRIMARY_KEY],
    ["no geometry column", { geometryColumns: 0, geometryColumn: null, geometryType: null }, REASSIGN_BLOCKER.NO_GEOMETRY],
    ["two geometry columns", { geometryColumns: 2 }, REASSIGN_BLOCKER.NO_GEOMETRY],
    ["no update privilege", { updatable: false }, REASSIGN_BLOCKER.NO_UPDATE_PRIVILEGE],
  ] as Array<[string, Partial<ReferenceScanRow>, string]>)("should name the blocker and give no target when the table has %s", (_label, overrides, blocker) => {
    const scan = referenceScanOf([factsRow(overrides)]);

    expect(scan.tables[0].reassign).toBeUndefined();
    expect(scan.tables[0].reassignBlocker).toBe(blocker);
    expect(scan.blockedReason).toBeNull();
  });

  it("should give every table the no-address-master blocker when reassignAllowed is false, even a fully reassignable one", () => {
    const scan = referenceScanOf([factsRow()], { reassignAllowed: false });

    expect(scan.tables).toEqual([{ schema: "carto", table: "access_point", reassignBlocker: REASSIGN_BLOCKER.NO_ADDRESS_MASTER }]);
  });

  it("should read the catalog facts through scanReferenceTables and pass reassignAllowed on", async () => {
    const { session } = sessionAnswering([catalogRow()]);

    const allowed = await scanReferenceTables(session, "carto", "padron", true);
    const denied = await scanReferenceTables(session, "carto", "padron", false);

    expect(allowed.tables[0].reassign).toEqual({ pkColumn: "gid", geometryColumn: "geom", geography: false });
    expect(denied.tables[0].reassignBlocker).toBe(REASSIGN_BLOCKER.NO_ADDRESS_MASTER);
  });

  it("should fail closed on an update flag that is not exactly true or a null primary key count", async () => {
    const stringFlag = await scanReferenceTables(sessionAnswering([catalogRow({ updatable: "t" })]).session, "carto", "padron", true);
    const nullPk = await scanReferenceTables(sessionAnswering([catalogRow({ pk_columns: null })]).session, "carto", "padron", true);

    expect(stringFlag.tables[0].reassign).toBeUndefined();
    expect(nullPk.tables[0].reassign).toBeUndefined();
  });
});

const companionRow = (overrides: Partial<ReferenceScanRow> = {}): ReferenceScanRow =>
  factsRow({
    geometryColumns: 0,
    geometryColumn: null,
    geometryType: null,
    companionTable: "address",
    companionColumn: "id",
    companionRefColumn: "id",
    companionPrimaryKeyColumns: 1,
    companionPrimaryKeyColumn: "id",
    companionGeometryColumns: 1,
    companionGeometryColumn: "geometry",
    companionGeometryType: "geometry",
    companionReadable: true,
    companionJoinColumns: 2,
    primaryKeyColumn: "id",
    ...overrides,
  });

describe("referenceScanOf companion point source (AP-110)", () => {
  it("should give a table with no geometry of its own a reassign target with the companion's geometry column", () => {
    const scan = referenceScanOf([companionRow()]);

    expect(scan.tables).toEqual([
      {
        schema: "carto",
        table: "access_point",
        reassign: {
          pkColumn: "id",
          geometryColumn: "geometry",
          geography: false,
          companion: { schema: "carto", table: "address", column: "id", companionColumn: "id" },
        },
      },
    ]);
    expect(scan.blockedReason).toBeNull();
  });

  it("should flag a geography companion so its point is read as a geometry", () => {
    const scan = referenceScanOf([companionRow({ companionGeometryType: "geography", companionGeometryColumn: "geog" })]);

    expect(scan.tables[0].reassign).toMatchObject({ geometryColumn: "geog", geography: true });
  });

  it("should use the companion join columns as given when they differ in name", () => {
    const scan = referenceScanOf([companionRow({ companionColumn: "address_id", companionRefColumn: "id_address", companionPrimaryKeyColumn: "address_id" })]);

    expect(scan.tables[0].reassign?.companion).toEqual({ schema: "carto", table: "address", column: "id_address", companionColumn: "address_id" });
  });

  it.each([
    ["the companion primary key is not the join column", { companionPrimaryKeyColumn: "uuid" }],
    ["the companion has a composite primary key", { companionPrimaryKeyColumns: 2 }],
    ["the companion has no primary key", { companionPrimaryKeyColumns: 0, companionPrimaryKeyColumn: null }],
    ["the companion has no geometry column", { companionGeometryColumns: 0, companionGeometryColumn: null, companionGeometryType: null }],
    ["the companion has several geometry columns", { companionGeometryColumns: 2 }],
    ["the companion cannot be read", { companionReadable: false }],
    ["a join column is missing", { companionJoinColumns: 1 }],
    ["both join columns are missing", { companionJoinColumns: 0 }],
    ["the mapping names no companion table", { companionTable: null }],
    ["the mapping names no join column", { companionColumn: null }],
    ["the mapping names no referencing column", { companionRefColumn: null }],
    ["the companion geometry column is unknown", { companionGeometryColumn: null }],
  ] as Array<[string, Partial<ReferenceScanRow>]>)("should name the no-geometry blocker and give no target when %s", (_label, overrides) => {
    const scan = referenceScanOf([companionRow(overrides)]);

    expect(scan.tables[0].reassign).toBeUndefined();
    expect(scan.tables[0].reassignBlocker).toBe(REASSIGN_BLOCKER.NO_GEOMETRY);
    expect(scan.blockedReason).toBeNull();
  });

  it("should block a table without a companion mapping that has no geometry of its own", () => {
    const scan = referenceScanOf([companionRow({ companionTable: null, companionColumn: null, companionRefColumn: null })]);

    expect(scan.tables[0].reassignBlocker).toBe(REASSIGN_BLOCKER.NO_GEOMETRY);
  });

  it("should prefer the table's own single geometry column over a companion", () => {
    const scan = referenceScanOf([companionRow({ geometryColumns: 1, geometryColumn: "geom", geometryType: "geometry" })]);

    expect(scan.tables[0].reassign).toEqual({ pkColumn: "id", geometryColumn: "geom", geography: false });
  });

  it("should not fall back to a companion when the table has several geometry columns of its own", () => {
    const scan = referenceScanOf([companionRow({ geometryColumns: 2, geometryColumn: "g1" })]);

    expect(scan.tables[0].reassign).toBeUndefined();
    expect(scan.tables[0].reassignBlocker).toBe(REASSIGN_BLOCKER.NO_GEOMETRY);
  });

  it("should check the primary key and the update privilege before accepting a companion", () => {
    const noPk = referenceScanOf([companionRow({ primaryKeyColumns: 0, primaryKeyColumn: null })]);
    const noUpdate = referenceScanOf([companionRow({ updatable: false })]);

    expect(noPk.tables[0].reassignBlocker).toBe(REASSIGN_BLOCKER.NO_PRIMARY_KEY);
    expect(noUpdate.tables[0].reassignBlocker).toBe(REASSIGN_BLOCKER.NO_UPDATE_PRIVILEGE);
  });

  it("should give the no-address-master blocker to a companion table when reassignAllowed is false", () => {
    const scan = referenceScanOf([companionRow()], { reassignAllowed: false });

    expect(scan.tables[0].reassignBlocker).toBe(REASSIGN_BLOCKER.NO_ADDRESS_MASTER);
  });

  it("should leave a table without companion facts in the row unreassignable without throwing", () => {
    const scan = referenceScanOf([factsRow({ geometryColumns: 0, geometryColumn: null })]);

    expect(scan.tables[0].reassignBlocker).toBe(REASSIGN_BLOCKER.NO_GEOMETRY);
  });

  it("should map the companion catalog columns through scanReferenceTables and fail closed on a readable flag that is not exactly true", async () => {
    const catalog = (overrides: Record<string, unknown> = {}): Record<string, unknown> =>
      catalogRow({
        pk_column: "id",
        geometry_columns: 0,
        geometry_column: null,
        geometry_type: null,
        companion_table: "address",
        companion_column: "id",
        companion_ref_column: "id",
        companion_pk_columns: 1,
        companion_pk_column: "id",
        companion_geometry_columns: 1,
        companion_geometry_column: "geometry",
        companion_geometry_type: "geometry",
        companion_readable: true,
        companion_join_columns: 2,
        ...overrides,
      });

    const accepted = await scanReferenceTables(sessionAnswering([catalog()]).session, "carto", "padron", true);
    const stringFlag = await scanReferenceTables(sessionAnswering([catalog({ companion_readable: "t" })]).session, "carto", "padron", true);
    const missing = await scanReferenceTables(sessionAnswering([catalog({ companion_join_columns: null })]).session, "carto", "padron", true);

    expect(accepted.tables[0].reassign?.companion).toEqual({ schema: "carto", table: "address", column: "id", companionColumn: "id" });
    expect(stringFlag.tables[0].reassign).toBeUndefined();
    expect(missing.tables[0].reassign).toBeUndefined();
  });
});
