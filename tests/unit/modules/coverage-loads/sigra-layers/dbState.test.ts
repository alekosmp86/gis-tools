import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import type { SigraDbState } from "@/modules/coverage-loads/sigra-layers/types";
import {
  ALL_FINAL_TABLE_GRANTS,
  CONNECTION,
  TEST_LAYER_IDS,
  TestLayer,
  type TestLayerId,
  createRig,
  createSigraDatabase,
  fetcherFor,
  finalTableOf,
  gidSequenceOf,
  nextGid,
  resetSigraDatabase,
  revokeTempPrivilege,
  seedFinalRows,
  seedFinalRowsDated,
  snapshotFinalTables,
  withSigraRole,
} from "./sigraHarness";

let database: PGlite;

beforeAll(async () => {
  database = await createSigraDatabase();
}, 60000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetSigraDatabase(database);
});

async function inspect(layerIds: ReadonlyArray<TestLayerId | typeof SigraLayerId.AREA_CD_SR>) {
  const rig = createRig(database, fetcherFor(TestLayer.ZONAS, new Error("inspect must not download")));
  const state = await rig.repository.inspect(CONNECTION, layerIds);
  return { state, rig };
}

const layerOf = (state: SigraDbState, index = 0) => state.layers[index];
const SEQUENCE_GRANT_ONLY_ZONAS = `GRANT USAGE ON SEQUENCE ${gidSequenceOf(TestLayer.ZONAS)} TO sigra_limited;`;

describe("sigra-layers database state read (AC-1, AC-2)", () => {
  describe("counts and last update", () => {
    it("should read the row count and the latest fechaact as YYYY-MM-DD", async () => {
      // Arrange
      await seedFinalRowsDated(database, TestLayer.ZONAS, ["2026-03-04", "2025-12-31", "2026-01-15"]);

      // Act
      const { state } = await inspect([TestLayer.ZONAS]);

      // Assert
      expect(state.layers).toEqual([
        { layerId: TestLayer.ZONAS, tableExists: true, rowCount: 3, lastUpdated: "2026-03-04", missingPrivileges: [] },
      ]);
    });

    it("should format a timestamp fechaact late in the day as its own calendar day", async () => {
      // Arrange
      await seedFinalRowsDated(database, TestLayer.LIMITE_CENTRAL, ["2026-05-05"]);
      await database.exec(`UPDATE ${finalTableOf(TestLayer.LIMITE_CENTRAL)} SET fechaact = '2026-05-06 23:59:59'`);

      // Act
      const { state } = await inspect([TestLayer.LIMITE_CENTRAL]);

      // Assert
      expect(layerOf(state).lastUpdated).toBe("2026-05-06");
    });

    it("should read the latest fechacarga of tfo-divisores, which has no fechaact", async () => {
      // Arrange
      await seedFinalRowsDated(database, TestLayer.TFO, ["2024-02-29", "2025-07-01"]);

      // Act
      const { state } = await inspect([TestLayer.TFO]);

      // Assert
      expect(layerOf(state)).toMatchObject({ rowCount: 2, lastUpdated: "2025-07-01" });
    });

    it("should report an empty table as zero rows and no last update", async () => {
      // Arrange & Act
      const { state } = await inspect([TestLayer.POSTES]);

      // Assert
      expect(state.layers).toEqual([
        { layerId: TestLayer.POSTES, tableExists: true, rowCount: 0, lastUpdated: null, missingPrivileges: [] },
      ]);
    });

    it("should ignore rows without a date when computing the last update", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.CENTRALES, { count: 1, date: "2021-06-01" });
      await database.exec(`INSERT INTO ${finalTableOf(TestLayer.CENTRALES)} (id_sitio) VALUES (99)`);

      // Act
      const { state } = await inspect([TestLayer.CENTRALES]);

      // Assert
      expect(layerOf(state)).toMatchObject({ rowCount: 2, lastUpdated: "2021-06-01" });
    });

    it("should return one entry per requested layer in the requested order, not the registry order", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.POSTES, { count: 5 });
      await seedFinalRows(database, TestLayer.ZONAS, { count: 2 });

      // Act
      const { state } = await inspect([TestLayer.POSTES, TestLayer.ZONAS, TestLayer.TFO]);

      // Assert
      expect(state.layers.map((layer) => [layer.layerId, layer.rowCount])).toEqual([
        [TestLayer.POSTES, 5],
        [TestLayer.ZONAS, 2],
        [TestLayer.TFO, 0],
      ]);
    });

    it("should return no layers, and still the global flags, when no layer is requested", async () => {
      // Arrange & Act
      const { state } = await inspect([]);

      // Assert
      expect(state).toEqual({ layers: [], canCreateTemp: true, auditAvailable: true });
    });
  });

  describe("missing tables", () => {
    it("should report a dropped table as not existing, with null counts and no privilege shortfall", async () => {
      // Arrange
      await database.exec(`DROP TABLE ${finalTableOf(TestLayer.POSTES)}`);

      // Act
      const { state } = await inspect([TestLayer.POSTES]);

      // Assert
      expect(state.layers).toEqual([
        { layerId: TestLayer.POSTES, tableExists: false, rowCount: null, lastUpdated: null, missingPrivileges: [] },
      ]);
    });

    it("should report a registry layer whose table is not in the database as not existing and keep reading the others", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 4 });

      // Act
      const { state } = await inspect([SigraLayerId.AREA_CD_SR, TestLayer.ZONAS]);

      // Assert
      expect(state.layers[0]).toEqual({
        layerId: SigraLayerId.AREA_CD_SR,
        tableExists: false,
        rowCount: null,
        lastUpdated: null,
        missingPrivileges: [],
      });
      expect(state.layers[1]).toMatchObject({ layerId: TestLayer.ZONAS, tableExists: true, rowCount: 4 });
    });
  });

  describe("privileges (AC-2)", () => {
    it("should list nothing for a role holding SELECT, INSERT, DELETE and the sequence USAGE", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 2 });
      let state: SigraDbState | undefined;

      // Act
      await withSigraRole(database, ALL_FINAL_TABLE_GRANTS, async () => {
        state = (await inspect(TEST_LAYER_IDS)).state;
      });

      // Assert
      expect(state?.layers.map((layer) => layer.missingPrivileges)).toEqual(TEST_LAYER_IDS.map(() => []));
      expect(state?.layers[0]).toMatchObject({ layerId: TestLayer.ZONAS, rowCount: 2 });
    });

    it.each(["INSERT", "DELETE"])("should name %s when only that privilege is missing on the final table", async (missing) => {
      // Arrange
      const granted = ["SELECT", "INSERT", "DELETE"].filter((privilege) => privilege !== missing).join(", ");
      const grants = `GRANT ${granted} ON ${finalTableOf(TestLayer.ZONAS)} TO sigra_limited; ${SEQUENCE_GRANT_ONLY_ZONAS}`;
      let state: SigraDbState | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        state = (await inspect([TestLayer.ZONAS])).state;
      });

      // Assert
      expect(layerOf(state as SigraDbState)).toMatchObject({ tableExists: true, missingPrivileges: [missing] });
    });

    it("should name SELECT and report no count or date when the table cannot be read, without failing", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 2 });
      const grants = `GRANT INSERT, DELETE ON ${finalTableOf(TestLayer.ZONAS)} TO sigra_limited; ${SEQUENCE_GRANT_ONLY_ZONAS}`;
      let state: SigraDbState | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        state = (await inspect([TestLayer.ZONAS])).state;
      });

      // Assert
      expect(layerOf(state as SigraDbState)).toEqual({
        layerId: TestLayer.ZONAS,
        tableExists: true,
        rowCount: null,
        lastUpdated: null,
        missingPrivileges: ["SELECT"],
      });
    });

    it("should name the missing USAGE on the gid sequence, which the table grants do not cover", async () => {
      // Arrange
      const grants = `GRANT SELECT, INSERT, DELETE ON ${finalTableOf(TestLayer.ZONAS)} TO sigra_limited;`;
      let state: SigraDbState | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        state = (await inspect([TestLayer.ZONAS])).state;
      });

      // Assert
      expect(layerOf(state as SigraDbState).missingPrivileges).toEqual([`USAGE:${gidSequenceOf(TestLayer.ZONAS)}`]);
    });

    it("should list the table privileges first and then the sequence usages", async () => {
      // Arrange
      const grants = `GRANT SELECT, DELETE ON ${finalTableOf(TestLayer.POSTES)} TO sigra_limited;`;
      let state: SigraDbState | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        state = (await inspect([TestLayer.POSTES])).state;
      });

      // Assert
      expect(layerOf(state as SigraDbState).missingPrivileges).toEqual(["INSERT", `USAGE:${gidSequenceOf(TestLayer.POSTES)}`]);
    });

    it("should check each layer on its own: a grant on one table says nothing about another", async () => {
      // Arrange
      const grants = `
        GRANT SELECT, INSERT, DELETE ON ${finalTableOf(TestLayer.ZONAS)} TO sigra_limited;
        GRANT USAGE ON SEQUENCE ${gidSequenceOf(TestLayer.ZONAS)} TO sigra_limited;
      `;
      let state: SigraDbState | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        state = (await inspect([TestLayer.ZONAS, TestLayer.LIMITE_CENTRAL])).state;
      });

      // Assert
      expect(state?.layers.map((layer) => layer.missingPrivileges)).toEqual([
        [],
        ["SELECT", "INSERT", "DELETE", `USAGE:${gidSequenceOf(TestLayer.LIMITE_CENTRAL)}`],
      ]);
    });

    it("should never ask for TRUNCATE: a role with only the DELETE-based grants has no shortfall", async () => {
      // Arrange
      const grants = ALL_FINAL_TABLE_GRANTS;
      let state: SigraDbState | undefined;

      // Act
      await withSigraRole(database, grants, async () => {
        state = (await inspect([TestLayer.TFO])).state;
      });

      // Assert
      expect(grants).not.toMatch(/TRUNCATE/);
      expect(layerOf(state as SigraDbState).missingPrivileges).toEqual([]);
    });
  });

  describe("TEMP privilege", () => {
    it("should allow creating temporary tables by default", async () => {
      // Arrange & Act
      const { state } = await inspect([TestLayer.ZONAS]);

      // Assert
      expect(state.canCreateTemp).toBe(true);
    });

    it("should say canCreateTemp false when the role lacks TEMP on the database", async () => {
      // Arrange
      await revokeTempPrivilege(database);
      let state: SigraDbState | undefined;

      // Act
      await withSigraRole(database, ALL_FINAL_TABLE_GRANTS, async () => {
        state = (await inspect([TestLayer.ZONAS])).state;
      });

      // Assert
      expect(state?.canCreateTemp).toBe(false);
    });
  });

  describe("audit table availability", () => {
    it("should be available when public.etl_auditoria exists and the role may SELECT, INSERT and UPDATE it", async () => {
      // Arrange
      let state: SigraDbState | undefined;
      const grants = `${ALL_FINAL_TABLE_GRANTS} GRANT SELECT, INSERT, UPDATE ON public.etl_auditoria TO sigra_limited;`;

      // Act
      await withSigraRole(database, grants, async () => {
        state = (await inspect([TestLayer.ZONAS])).state;
      });

      // Assert
      expect(state?.auditAvailable).toBe(true);
    });

    it("should be unavailable when the audit table does not exist", async () => {
      // Arrange
      await database.exec("DROP TABLE public.etl_auditoria");

      // Act
      const { state } = await inspect([TestLayer.ZONAS]);

      // Assert
      expect(state.auditAvailable).toBe(false);
    });

    it.each([
      ["SELECT", "GRANT INSERT, UPDATE ON public.etl_auditoria TO sigra_limited;"],
      ["INSERT", "GRANT SELECT, UPDATE ON public.etl_auditoria TO sigra_limited;"],
      ["UPDATE", "GRANT SELECT, INSERT ON public.etl_auditoria TO sigra_limited;"],
      ["INSERT and UPDATE", "GRANT SELECT ON public.etl_auditoria TO sigra_limited;"],
    ])("should be unavailable when the role lacks %s on the audit table", async (_label, auditGrant) => {
      // Arrange
      let state: SigraDbState | undefined;

      // Act
      await withSigraRole(database, ALL_FINAL_TABLE_GRANTS + auditGrant, async () => {
        state = (await inspect([TestLayer.ZONAS])).state;
      });

      // Assert
      expect(state?.auditAvailable).toBe(false);
    });

    it("should not make a missing audit table a privilege shortfall of any layer", async () => {
      // Arrange
      await database.exec("DROP TABLE public.etl_auditoria");

      // Act
      const { state } = await inspect(TEST_LAYER_IDS);

      // Assert
      expect(state.layers.every((layer) => layer.missingPrivileges.length === 0)).toBe(true);
    });
  });

  describe("read only (AC-1)", () => {
    it("should run in BEGIN READ ONLY and record no statement that writes or creates anything", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });

      // Act
      const { rig } = await inspect(TEST_LAYER_IDS);

      // Assert
      const statements = rig.statements();
      expect(statements[0]).toMatch(/^BEGIN READ ONLY/i);
      const writes = statements.filter((statement) =>
        /\b(INSERT INTO|DELETE FROM|CREATE\s+(TEMP|TEMPORARY|TABLE|INDEX|UNIQUE)|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE|LOCK TABLE)\b/i.test(statement) || /^\s*UPDATE\b/i.test(statement),
      );
      expect(writes).toEqual([]);
    });

    it("should leave every final table and every sequence untouched", async () => {
      // Arrange
      await seedFinalRows(database, TestLayer.ZONAS, { count: 3 });
      await seedFinalRows(database, TestLayer.TFO, { count: 2 });
      const before = await snapshotFinalTables(database);
      const gidBefore = await nextGid(database, TestLayer.ZONAS);

      // Act
      await inspect(TEST_LAYER_IDS);

      // Assert
      expect(await snapshotFinalTables(database)).toEqual(before);
      expect(await nextGid(database, TestLayer.ZONAS)).toBe(gidBefore + 1);
    });

    it("should not touch the audit table nor the WFS", async () => {
      // Arrange
      const rig = createRig(database, fetcherFor(TestLayer.ZONAS));

      // Act
      await rig.repository.inspect(CONNECTION, TEST_LAYER_IDS);

      // Assert
      expect(rig.statements().filter((statement) => /^(INSERT|UPDATE)\b[\s\S]*etl_auditoria/i.test(statement))).toEqual([]);
      expect(await database.query("SELECT 1 FROM public.etl_auditoria")).toMatchObject({ rows: [] });
    });

    it("should close the connection it opened", async () => {
      // Arrange & Act
      const { rig } = await inspect([TestLayer.ZONAS]);

      // Assert
      expect(rig.clients.length).toBeGreaterThanOrEqual(1);
      for (const client of rig.clients) expect(client.endCount).toBe(client.connectCount);
    });
  });
});
