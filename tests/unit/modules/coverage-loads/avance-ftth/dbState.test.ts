import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  AVANCE,
  AvanceFileKind,
  CENTRAL_LIMITS,
  HISTORY,
  SEQUENCE_OWNERS,
  STAGING_INT,
  STAGING_UDPEM,
  ZONES,
} from "@/modules/coverage-loads/avance-ftth/constants";
import { buildPlan } from "@/modules/coverage-loads/avance-ftth/domain/plan";
import { readDbState } from "@/modules/coverage-loads/avance-ftth/services/queries/runStateQueries";
import { RecordingPgliteClient } from "../pgliteHarness";
import {
  EDIF_ONE,
  EDIF_TWO,
  OLD_LOAD_DATE,
  STANDARD_ZONES,
  createAvanceDatabase,
  ensureAvanceSchema,
  installPrivileges,
  makeParsedFile,
  makeRow,
  resetAvanceDatabase,
  seedAvance,
  seedHistoryRows,
  seedPlanillaRows,
  seedZones,
} from "./avanceHarness";

let database: PGlite;

beforeAll(async () => {
  database = await createAvanceDatabase();
}, 60000);

afterAll(async () => {
  await database.close();
});

beforeEach(async () => {
  await resetAvanceDatabase(database);
});

const state = () => readDbState(new RecordingPgliteClient(database));

const ALL_GRANTS = `
  GRANT SELECT, INSERT, DELETE ON public.avance_planilla_int, public.avance_planilla_mvd TO avance_limited;
  GRANT SELECT, INSERT, UPDATE, DELETE ON public.avance_uruguay_planilla TO avance_limited;
  GRANT SELECT, INSERT ON historico.h_avance_uruguay TO avance_limited;
  GRANT SELECT ON public.area_zonas_ftth_f, public.limite_central_ftth TO avance_limited;
`;

const SEQUENCE_GRANTS = `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public, historico TO avance_limited;`;

describe("avance-ftth database state read (AC-7, AC-12, AC-20b)", () => {
  describe("counts and dates", () => {
    it("should read an empty database as zeros and nulls with no shortfalls", async () => {
      // Arrange & Act
      const result = await state();

      // Assert
      expect(result).toEqual({
        staging: {
          [AvanceFileKind.INT]: { rows: 0, fechaact: null },
          [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
        },
        avance: { rows: 0, oldestLoad: null, newestLoad: null, loadedToday: false },
        historyRows: 0,
        zoneRows: 0,
        zoneStatuses: [],
        avanceByStatus: [],
        shortfalls: [],
      });
    });

    it("should read the row count and fechaact of each staging table", async () => {
      // Arrange
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: "A", cable: "01", zona: "01" },
        { edificio: "B", cable: "01", zona: "01" },
        { edificio: "C", cable: "01", zona: "01" },
      ]);
      await seedPlanillaRows(database, AvanceFileKind.UDPEM, [{ edificio: "D", cable: "01", zona: "01" }]);

      // Act
      const result = await state();

      // Assert
      expect(result.staging[AvanceFileKind.INT]).toEqual({ rows: 3, fechaact: "01012020" });
      expect(result.staging[AvanceFileKind.UDPEM]).toEqual({ rows: 1, fechaact: "01012020" });
    });

    it("should read the Avance count and the oldest and newest fechacarga as YYYY-MM-DD text", async () => {
      // Arrange
      await seedAvance(database, [
        { cable: "001", zona: "01", edificio: EDIF_ONE, fechacarga: OLD_LOAD_DATE },
        { cable: "001", zona: "02", edificio: EDIF_ONE, fechacarga: "2026-03-04" },
        { cable: "001", zona: "03", edificio: EDIF_ONE, fechacarga: "2021-12-31" },
      ]);

      // Act
      const { avance } = await state();

      // Assert
      expect(avance).toEqual({ rows: 3, oldestLoad: OLD_LOAD_DATE, newestLoad: "2026-03-04", loadedToday: false });
    });

    it("should say loadedToday only when the Avance has rows and every one carries today's date", async () => {
      // Arrange
      await seedAvance(database, [
        { cable: "001", zona: "01", edificio: EDIF_ONE, fechacarga: null },
        { cable: "001", zona: "02", edificio: EDIF_ONE, fechacarga: null },
      ]);

      // Act
      const allToday = await state();
      await seedAvance(database, [{ cable: "001", zona: "03", edificio: EDIF_ONE, fechacarga: OLD_LOAD_DATE }]);
      const mixed = await state();
      await database.exec("TRUNCATE public.avance_uruguay_planilla");
      const empty = await state();

      // Assert
      expect(allToday.avance.loadedToday).toBe(true);
      expect(mixed.avance.loadedToday).toBe(false);
      expect(empty.avance.loadedToday).toBe(false);
    });

    it("should not call the Avance loaded today when it was loaded yesterday", async () => {
      // Arrange
      await database.query(
        `INSERT INTO public.avance_uruguay_planilla (cable, zona, edificio, fechacarga) VALUES ('001', '01', 'X', current_date - 1)`
      );

      // Act
      const { avance } = await state();

      // Assert
      expect(avance.loadedToday).toBe(false);
    });

    it("should count the history and the zones", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);
      await seedHistoryRows(database, [
        { edificio: "A", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2020-01-01" },
        { edificio: "B", cable: "001", zona: "01", estado: "EJECUTADA", fechacarga: "2020-01-01" },
      ]);

      // Act
      const result = await state();

      // Assert
      expect(result.historyRows).toBe(2);
      expect(result.zoneRows).toBe(3);
    });
  });

  describe("district statuses (AC-20b)", () => {
    it("should list the zone statuses with counts, sorted, and show a missing status as the empty string", async () => {
      // Arrange
      await seedZones(database, [
        ...STANDARD_ZONES,
        { edificio: EDIF_TWO, codigoDistrito: "C001Z09", status: "Existente" },
        { edificio: EDIF_TWO, codigoDistrito: "C001Z08", status: null },
      ]);

      // Act
      const { zoneStatuses } = await state();

      // Assert
      expect(zoneStatuses).toEqual([
        { status: "", count: 1 },
        { status: "Existente", count: 2 },
        { status: "Proyectado/Eliminacion", count: 1 },
        { status: "Proyectado/Instalacion", count: 1 },
      ]);
    });

    it("should break the current Avance rows down by the status of the zone they join (key edificio|Ccable|Zzona)", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);
      await seedAvance(database, [
        { cable: "001", zona: "01", edificio: EDIF_ONE, fechacarga: null },
        { cable: "001", zona: "02", edificio: EDIF_ONE, fechacarga: null },
        { cable: "001", zona: "01", edificio: EDIF_TWO, fechacarga: null },
        { cable: "001", zona: "01", edificio: EDIF_TWO, fechacarga: null },
        { cable: "001", zona: "07", edificio: EDIF_ONE, fechacarga: null },
      ]);

      // Act
      const { avanceByStatus } = await state();

      // Assert: the zone-07 row joins nothing and is not counted
      expect(avanceByStatus).toEqual([
        { status: "Existente", count: 1 },
        { status: "Proyectado/Eliminacion", count: 2 },
        { status: "Proyectado/Instalacion", count: 1 },
      ]);
    });

    it("should trim the Avance key parts before joining", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);
      await seedAvance(database, [{ cable: " 001 ", zona: " 01 ", edificio: ` ${EDIF_ONE} `, fechacarga: null }]);

      // Act
      const { avanceByStatus } = await state();

      // Assert
      expect(avanceByStatus).toEqual([{ status: "Existente", count: 1 }]);
    });

    it("should feed the eliminated-zone warning of the plan under parity", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);
      await seedAvance(database, [
        { cable: "001", zona: "01", edificio: EDIF_TWO, fechacarga: OLD_LOAD_DATE },
        { cable: "001", zona: "01", edificio: EDIF_TWO, fechacarga: OLD_LOAD_DATE },
      ]);
      const files = [
        makeParsedFile(AvanceFileKind.INT, [makeRow()]),
        makeParsedFile(AvanceFileKind.UDPEM, [makeRow()]),
      ];

      // Act
      const plan = buildPlan(files, [], await state());

      // Assert
      expect(plan.warnings).toEqual([
        "2 filas del Avance actual provienen de zonas Proyectado/Eliminacion y se incluyen, igual que el job anterior.",
      ]);
    });
  });

  describe("privileges (AC-12)", () => {
    it("should find no shortfall for a role with exactly the documented table grants and sequence usage", async () => {
      // Arrange
      let result;

      // Act
      await installPrivileges(database, ALL_GRANTS + SEQUENCE_GRANTS, async () => {
        result = await state();
      });

      // Assert
      expect(result).toMatchObject({ shortfalls: [] });
    });

    it("should not require TRUNCATE on any table: a role holding only the DELETE-based grants has no shortfall", async () => {
      // Arrange
      let result: Awaited<ReturnType<typeof state>> | undefined;
      const noTruncateAnywhere = ALL_GRANTS + SEQUENCE_GRANTS;

      // Act
      await installPrivileges(database, noTruncateAnywhere, async () => {
        result = await state();
      });

      // Assert
      expect(noTruncateAnywhere).not.toMatch(/TRUNCATE/);
      expect(result?.shortfalls).toEqual([]);
    });

    it.each([
      [STAGING_INT, "DELETE ON public.avance_planilla_int", "DELETE"],
      [STAGING_UDPEM, "DELETE ON public.avance_planilla_mvd", "DELETE"],
      [AVANCE, "UPDATE ON public.avance_uruguay_planilla", "UPDATE"],
      [AVANCE, "DELETE ON public.avance_uruguay_planilla", "DELETE"],
      [HISTORY, "INSERT ON historico.h_avance_uruguay", "INSERT"],
    ])("should name the missing privilege on %s when %s is not granted", async (table, revoked, privilege) => {
      // Arrange
      let result;

      // Act
      await installPrivileges(database, ALL_GRANTS + SEQUENCE_GRANTS + `REVOKE ${revoked} FROM avance_limited;`, async () => {
        result = await state();
      });

      // Assert
      expect(result).toMatchObject({ shortfalls: [{ table, tableExists: true, missing: [privilege] }] });
    });

    it("should name SELECT on the zones and the central limits when it is missing, and stop reading what it cannot read", async () => {
      // Arrange
      await seedZones(database, STANDARD_ZONES);
      let result;

      // Act
      await installPrivileges(
        database,
        ALL_GRANTS + SEQUENCE_GRANTS + "REVOKE SELECT ON public.area_zonas_ftth_f, public.limite_central_ftth FROM avance_limited;",
        async () => {
          result = await state();
        }
      );

      // Assert
      expect(result).toMatchObject({
        shortfalls: [
          { table: ZONES, tableExists: true, missing: ["SELECT"] },
          { table: CENTRAL_LIMITS, tableExists: true, missing: ["SELECT"] },
        ],
        zoneRows: 0,
        zoneStatuses: [],
        avanceByStatus: [],
      });
    });

    it("should report the missing USAGE on the serial sequences, which the table grants do not cover", async () => {
      // Arrange
      let result: Awaited<ReturnType<typeof state>> | undefined;
      const grantUsageOnHistoryOnly = "GRANT USAGE ON SEQUENCE historico.h_avance_uruguay_id_seq TO avance_limited;";

      // Act
      await installPrivileges(database, ALL_GRANTS + grantUsageOnHistoryOnly, async () => {
        result = await state();
      });

      // Assert
      expect(result?.shortfalls).toEqual([
        { table: STAGING_INT, tableExists: true, missing: ["USAGE (secuencia de gid)"] },
        { table: STAGING_UDPEM, tableExists: true, missing: ["USAGE (secuencia de gid)"] },
        { table: AVANCE, tableExists: true, missing: ["USAGE (secuencia de gid)"] },
      ]);
    });

    it("should add the sequence shortfall to the table shortfalls of the same table", async () => {
      // Arrange
      let result: Awaited<ReturnType<typeof state>> | undefined;

      // Act
      await installPrivileges(database, ALL_GRANTS + "REVOKE DELETE ON public.avance_planilla_int FROM avance_limited;", async () => {
        result = await state();
      });

      // Assert
      expect(result?.shortfalls.find((shortfall) => shortfall.table === STAGING_INT)).toEqual({
        table: STAGING_INT,
        tableExists: true,
        missing: ["DELETE", "USAGE (secuencia de gid)"],
      });
    });

    it("should cover every serial column the load writes (staging x2, Avance gid, history id)", () => {
      // Arrange & Act & Assert
      expect(SEQUENCE_OWNERS).toEqual([
        { table: STAGING_INT, column: "gid" },
        { table: STAGING_UDPEM, column: "gid" },
        { table: AVANCE, column: "gid" },
        { table: HISTORY, column: "id" },
      ]);
    });

    it("should report a missing table as not existing, keep reading the rest and not fail", async () => {
      // Arrange
      await database.exec("DROP TABLE historico.h_avance_uruguay");
      await seedZones(database, STANDARD_ZONES);

      // Act
      const result = await state();

      // Assert
      expect(result.shortfalls).toEqual([{ table: HISTORY, tableExists: false, missing: [] }]);
      expect(result.historyRows).toBe(0);
      expect(result.zoneRows).toBe(3);
    });

    it("should let the HGDesa dry run decide when a table has no serial sequence (undetermined is not a shortfall)", async () => {
      // Arrange
      await database.exec("DROP TABLE public.avance_planilla_int");
      await database.exec(`CREATE TABLE public.avance_planilla_int (gid integer, fechaact text, fechacarga date)`);

      // Act
      let result;
      try {
        result = await state();
      } finally {
        await database.exec("DROP TABLE public.avance_planilla_int");
        await ensureAvanceSchema(database);
      }

      // Assert
      expect(result.shortfalls).toEqual([]);
    });
  });
});
