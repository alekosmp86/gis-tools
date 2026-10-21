import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  AVANCE_FUENTE,
  AvanceFileKind,
  ELIMINATED_STATUS,
  EXCLUDED_DISTRICT_STATUSES,
  EXCLUDED_ZONE_NAMES,
  INSERT_BATCH_SIZE,
  JUNK_CONCA_LIKE_PATTERN,
  STAGING_FUENTE,
} from "@/modules/coverage-loads/avance-ftth/constants";
import {
  BREAKDOWN_BY_STATUS_SQL,
  COPY_TO_HISTORY_SQL,
  COUNT_UNMATCHED_SQL,
  DELETE_JUNK_SQL,
  INSERT_AVANCE_SQL,
  INSERT_STAGING_SQL,
} from "@/modules/coverage-loads/avance-ftth/services/queries/rebuildQueries";
import { lockStaging, rebuildAvance } from "@/modules/coverage-loads/avance-ftth/services/queries/runRebuildQueries";
import { RecordingPgliteClient } from "../pgliteHarness";
import {
  EDIF_MISSING,
  EDIF_ONE,
  EDIF_TWO,
  OLD_LOAD_DATE,
  STANDARD_ZONES,
  countRows,
  createAvanceDatabase,
  makeParsedFile,
  makeRow,
  resetAvanceDatabase,
  rowFor,
  seedAvance,
  seedPlanillaRows,
  seedZones,
  selectRows,
  standardFiles,
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

const ZONE_SEEDS = STANDARD_ZONES;

async function seedStandardWorld(): Promise<void> {
  await seedZones(database, ZONE_SEEDS);
}

interface AvanceRowShape {
  readonly central: string;
  readonly cable: string;
  readonly zona: string;
  readonly conca: string;
  readonly edificio: string;
  readonly empresa: string;
  readonly fecha: string;
  readonly director: string;
  readonly ejecutor: string;
  readonly estado: string;
  readonly geom: string;
  readonly fuente: string;
  readonly cargado_hoy: boolean;
}

const readAvance = () =>
  selectRows<AvanceRowShape>(
    database,
    `SELECT central, cable, zona, conca, edificio, empresa, fecha, director, ejecutor, estado, geom, fuente,
            (fechacarga = current_date) AS cargado_hoy
     FROM public.avance_uruguay_planilla ORDER BY gid`
  );

const readHistory = () =>
  selectRows<{ edificio: string; cable: string; zona: string; estado: string; fechacarga: string; hoy: boolean }>(
    database,
    `SELECT edificio, cable, zona, estado, to_char(fechacarga, 'YYYY-MM-DD') AS fechacarga,
            (fecha_historico = current_date) AS hoy
     FROM historico.h_avance_uruguay ORDER BY id`
  );

describe("avance-ftth rebuild SQL (AC-13 .. AC-18, AC-20)", () => {
  describe("statement order (AC-13)", () => {
    it("should run the steps in the AC-13 order, each one a named statement", async () => {
      // Arrange
      await seedStandardWorld();
      const client = new RecordingPgliteClient(database);
      const classify = (statement: string): string => {
        const rules: Array<[RegExp, string]> = [
          [/^LOCK TABLE public\.avance_planilla_int/, "lock-int"],
          [/^LOCK TABLE public\.avance_planilla_mvd/, "lock-udpem"],
          [/^TRUNCATE public\.avance_planilla_int/, "truncate-int"],
          [/^TRUNCATE public\.avance_planilla_mvd/, "truncate-udpem"],
          [/^INSERT INTO public\.avance_planilla_int/, "stage-int"],
          [/^INSERT INTO public\.avance_planilla_mvd/, "stage-udpem"],
          [/DELETE FROM public\.avance_planilla_int/, "junk-int"],
          [/DELETE FROM public\.avance_planilla_mvd/, "junk-udpem"],
          [/loaded_today/, "read-avance-state"],
          [/INSERT INTO historico\.h_avance_uruguay/, "history-copy"],
          [/^TRUNCATE TABLE public\.avance_uruguay_planilla/, "truncate-avance"],
          [/GROUP BY 1\s+ORDER BY 1/, "breakdown"],
          [/SELECT DISTINCT trim/, "unmatched"],
          [/INSERT INTO public\.avance_uruguay_planilla/, "insert-avance"],
          [/^UPDATE public\.avance_uruguay_planilla SET fuente/, "update-fuente"],
          [/^SELECT count\(\*\)::int AS total FROM public\.avance_planilla_int/, "count-int"],
          [/^SELECT count\(\*\)::int AS total FROM public\.avance_planilla_mvd/, "count-udpem"],
          [/^SELECT count\(\*\)::int AS total FROM public\.avance_uruguay_planilla/, "count-avance"],
        ];
        return rules.find(([pattern]) => pattern.test(statement))?.[1] ?? `UNKNOWN: ${statement.slice(0, 60)}`;
      };

      // Act
      await client.query("BEGIN", []);
      await lockStaging(client);
      await rebuildAvance(client, standardFiles());
      await client.query("ROLLBACK", []);

      // Assert
      expect(client.statements.slice(1, -1).map(classify)).toEqual([
        "lock-int",
        "lock-udpem",
        "truncate-int",
        "stage-int",
        "truncate-udpem",
        "stage-udpem",
        "junk-int",
        "junk-udpem",
        "read-avance-state",
        "history-copy",
        "truncate-avance",
        "breakdown",
        "unmatched",
        "insert-avance",
        "breakdown",
        "unmatched",
        "insert-avance",
        "update-fuente",
        "count-int",
        "count-udpem",
        "count-avance",
      ]);
    });

    it("should lock both staging tables in ACCESS EXCLUSIVE mode, INT first", async () => {
      // Arrange
      const client = new RecordingPgliteClient(database);

      // Act
      await client.query("BEGIN", []);
      await lockStaging(client);
      await client.query("ROLLBACK", []);

      // Assert
      expect(client.statements.slice(1, 3)).toEqual([
        "LOCK TABLE public.avance_planilla_int IN ACCESS EXCLUSIVE MODE",
        "LOCK TABLE public.avance_planilla_mvd IN ACCESS EXCLUSIVE MODE",
      ]);
    });

    it("should process INT before UDPEM even when the files arrive in the other order", async () => {
      // Arrange
      await seedStandardWorld();
      const client = new RecordingPgliteClient(database);
      const [interior, montevideo] = standardFiles();

      // Act
      const outcome = await rebuildAvance(client, [montevideo, interior]);

      // Assert
      expect(outcome.files.map((file) => file.kind)).toEqual([AvanceFileKind.INT, AvanceFileKind.UDPEM]);
    });
  });

  describe("staging load (AC-6, AC-14)", () => {
    it("should store every valid row with fechaact from the file name, the constant fuente and nulls as NULL", async () => {
      // Arrange
      await seedStandardWorld();
      const row = makeRow({ edificio: EDIF_ONE, zona: "01", ejecutor: null, plano_al_com: "3/9/2020", conca: "ÑANDÚ ñ" });
      const files = [makeParsedFile(AvanceFileKind.INT, [row], { fechaact: "03012027" }), makeParsedFile(AvanceFileKind.UDPEM, [row], { fechaact: "04012027" })];

      // Act
      await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      const staging = await selectRows<{ fechaact: string; fuente: string; ejecutor: string | null; plano_al_com: string; conca: string; hoy: boolean }>(
        database,
        `SELECT fechaact, fuente, ejecutor, plano_al_com, conca, (fechacarga = current_date) AS hoy FROM public.avance_planilla_int`
      );
      const udpem = await selectRows<{ fechaact: string }>(database, `SELECT fechaact FROM public.avance_planilla_mvd`);
      expect(staging).toEqual([
        { fechaact: "03012027", fuente: STAGING_FUENTE, ejecutor: null, plano_al_com: "3/9/2020", conca: "ÑANDÚ ñ", hoy: true },
      ]);
      expect(STAGING_FUENTE).toBe("EXTERNO/J.Pierri");
      expect(udpem).toEqual([{ fechaact: "04012027" }]);
    });

    it("should replace the previous content of both staging tables", async () => {
      // Arrange
      await seedStandardWorld();
      await seedPlanillaRows(database, AvanceFileKind.INT, [{ edificio: "OLD", cable: "01", zona: "01" }]);
      await seedPlanillaRows(database, AvanceFileKind.UDPEM, [{ edificio: "OLD", cable: "01", zona: "01" }]);

      // Act
      await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      const old = await selectRows(database, `SELECT 1 FROM public.avance_planilla_int WHERE edificio = 'OLD'`);
      expect(old).toEqual([]);
      expect(await countRows(database, "public.avance_planilla_int")).toBe(5);
      expect(await countRows(database, "public.avance_planilla_mvd")).toBe(2);
    });

    it("should insert in batches of 1000 rows with bound parameters only", async () => {
      // Arrange
      await seedStandardWorld();
      const rows = Array.from({ length: 2500 }, (_, index) => rowFor(`E${String(index).padStart(6, "0")}`, "01"));
      const client = new RecordingPgliteClient(database);
      const files = [makeParsedFile(AvanceFileKind.INT, rows), makeParsedFile(AvanceFileKind.UDPEM, [rowFor(EDIF_ONE, "01")])];

      // Act
      await rebuildAvance(client, files);

      // Assert
      const inserts = client.calls.filter((call) => /^INSERT INTO public\.avance_planilla_int/.test(call.text.trim()));
      expect(INSERT_BATCH_SIZE).toBe(1000);
      expect(inserts.map((call) => (call.values[0] as unknown[]).length)).toEqual([1000, 1000, 500]);
      for (const call of inserts) {
        expect(call.values).toHaveLength(12);
        expect(call.values[10]).toBe("21092026");
        expect(call.values[11]).toBe(STAGING_FUENTE);
        expect(call.text).not.toContain("E000001");
      }
      expect(await countRows(database, "public.avance_planilla_int")).toBe(2500);
    });

    it("should insert exactly 1000 rows in a single batch and 1001 in two", async () => {
      // Arrange
      await seedStandardWorld();
      const build = (count: number) =>
        Array.from({ length: count }, (_, index) => rowFor(`E${String(index).padStart(6, "0")}`, "01"));

      // Act
      const exact = new RecordingPgliteClient(database);
      await rebuildAvance(exact, [makeParsedFile(AvanceFileKind.INT, build(1000)), makeParsedFile(AvanceFileKind.UDPEM, build(1))]);
      const over = new RecordingPgliteClient(database);
      await rebuildAvance(over, [makeParsedFile(AvanceFileKind.INT, build(1001)), makeParsedFile(AvanceFileKind.UDPEM, build(1))]);

      // Assert
      const stagingInserts = (client: RecordingPgliteClient) =>
        client.calls.filter((call) => /^INSERT INTO public\.avance_planilla_int/.test(call.text.trim())).length;
      expect(stagingInserts(exact)).toBe(1);
      expect(stagingInserts(over)).toBe(2);
    });

    it("should name the staging columns exactly as AC-14 lists them", () => {
      // Arrange & Act & Assert
      expect(INSERT_STAGING_SQL[AvanceFileKind.INT]).toContain(
        "(central, cable, zona, empresa, plano_al_com, ejecutor, director, etiqueta, conca, edificio, fechaact, fuente)"
      );
      expect(INSERT_STAGING_SQL[AvanceFileKind.INT]).toContain("FROM unnest(");
    });
  });

  describe("junk deletion (AC-5, AC-17)", () => {
    it("should delete the CZONA rows of both staging tables and report how many", async () => {
      // Arrange
      await seedStandardWorld();
      const junk = (index: number) => makeRow({ edificio: null, cable: null, zona: null, conca: `CZONA ${index}` });
      const files = [
        makeParsedFile(AvanceFileKind.INT, [rowFor(EDIF_ONE, "01"), junk(1), junk(2), makeRow({ conca: "XCZONA", edificio: EDIF_ONE })]),
        makeParsedFile(AvanceFileKind.UDPEM, [rowFor(EDIF_ONE, "01"), junk(3)]),
      ];

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      expect(outcome.files.map((file) => [file.kind, file.rowsLoaded, file.junkDeleted])).toEqual([
        [AvanceFileKind.INT, 4, 2],
        [AvanceFileKind.UDPEM, 2, 1],
      ]);
      expect(await countRows(database, "public.avance_planilla_int")).toBe(2);
      expect(await countRows(database, "public.avance_planilla_mvd")).toBe(1);
      const kept = await selectRows<{ conca: string }>(database, `SELECT conca FROM public.avance_planilla_int ORDER BY gid`);
      expect(kept.map((row) => row.conca)).toEqual([`${EDIF_ONE} 01`, "XCZONA"]);
    });

    it("should use the LIKE pattern CZONA% as a bound parameter", async () => {
      // Arrange
      await seedStandardWorld();
      const client = new RecordingPgliteClient(database);

      // Act
      await rebuildAvance(client, standardFiles());

      // Assert
      const deletes = client.calls.filter((call) => /DELETE FROM/.test(call.text));
      expect(JUNK_CONCA_LIKE_PATTERN).toBe("CZONA%");
      expect(deletes.map((call) => call.values)).toEqual([["CZONA%"], ["CZONA%"]]);
      expect(DELETE_JUNK_SQL[AvanceFileKind.INT]).toContain("conca LIKE $1::text");
    });

    it("should leave the junk rows out of the Avance and report none of them as unmatched", async () => {
      // Arrange
      await seedStandardWorld();
      const junk = makeRow({ edificio: "#N/A", cable: null, zona: null, conca: "CZONA" });
      const files = [makeParsedFile(AvanceFileKind.INT, [rowFor(EDIF_ONE, "01"), junk]), makeParsedFile(AvanceFileKind.UDPEM, [rowFor(EDIF_ONE, "01")])];

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      expect(outcome.files[0]).toMatchObject({ junkDeleted: 1, avanceInserted: 1, unmatchedKeys: 0 });
    });
  });

  describe("history copy (AC-15, decision O2)", () => {
    it("should append the old Avance to the history keeping its old fechacarga and stamping fecha_historico with today", async () => {
      // Arrange
      await seedStandardWorld();
      await seedAvance(database, [
        { cable: "001", zona: "01", edificio: EDIF_ONE, estado: "EN TRABAJO", fechacarga: OLD_LOAD_DATE },
        { cable: "001", zona: "02", edificio: EDIF_ONE, estado: "EJECUTADA", fechacarga: "2019-05-06" },
      ]);

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      expect(outcome.history).toEqual({ copied: 2, skipped: false, reason: null });
      expect(await readHistory()).toEqual([
        { edificio: EDIF_ONE, cable: "001", zona: "01", estado: "EN TRABAJO", fechacarga: OLD_LOAD_DATE, hoy: true },
        { edificio: EDIF_ONE, cable: "001", zona: "02", estado: "EJECUTADA", fechacarga: "2019-05-06", hoy: true },
      ]);
    });

    it("should not touch the existing history rows: the copy appends", async () => {
      // Arrange
      await seedStandardWorld();
      await database.query(
        `INSERT INTO historico.h_avance_uruguay (edificio, cable, zona, estado, fechacarga, fecha_historico)
         VALUES ('PREVIO', '001', '01', 'EJECUTADA', '2018-01-01', '2018-02-02')`
      );
      await seedAvance(database, [{ cable: "001", zona: "01", edificio: EDIF_ONE, fechacarga: OLD_LOAD_DATE }]);

      // Act
      await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      const history = await selectRows<{ edificio: string; fecha_historico: string }>(
        database,
        `SELECT edificio, to_char(fecha_historico, 'YYYY-MM-DD') AS fecha_historico FROM historico.h_avance_uruguay ORDER BY id`
      );
      expect(history.map((row) => row.edificio)).toEqual(["PREVIO", EDIF_ONE]);
      expect(history[0].fecha_historico).toBe("2018-02-02");
    });

    it("should copy nothing and report 0 copied when the Avance is empty", async () => {
      // Arrange
      await seedStandardWorld();

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      expect(outcome.history).toEqual({ copied: 0, skipped: false, reason: null });
      expect(await countRows(database, "historico.h_avance_uruguay")).toBe(0);
    });

    it("should SKIP the copy and say why when every Avance row was loaded today (same-day re-load)", async () => {
      // Arrange
      await seedStandardWorld();
      await seedAvance(database, [
        { cable: "001", zona: "01", edificio: EDIF_ONE, fechacarga: null },
        { cable: "001", zona: "02", edificio: EDIF_ONE, fechacarga: null },
      ]);

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      expect(outcome.history).toEqual({
        copied: 0,
        skipped: true,
        reason: "historial omitido: el Avance actual ya fue cargado hoy",
      });
      expect(await countRows(database, "historico.h_avance_uruguay")).toBe(0);
      expect(await countRows(database, "public.avance_uruguay_planilla")).toBe(4);
    });

    it("should copy when the Avance mixes today and an older date (one old row is enough)", async () => {
      // Arrange
      await seedStandardWorld();
      await seedAvance(database, [
        { cable: "001", zona: "01", edificio: EDIF_ONE, fechacarga: null },
        { cable: "001", zona: "02", edificio: EDIF_ONE, fechacarga: OLD_LOAD_DATE },
      ]);

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      expect(outcome.history).toMatchObject({ copied: 2, skipped: false });
      const [{ today }] = await selectRows<{ today: string }>(database, "SELECT to_char(current_date, 'YYYY-MM-DD') AS today");
      expect((await readHistory()).map((row) => row.fechacarga).sort()).toEqual([OLD_LOAD_DATE, today].sort());
    });

    it("should copy when the Avance was loaded yesterday (only today skips)", async () => {
      // Arrange
      await seedStandardWorld();
      await database.query(
        `INSERT INTO public.avance_uruguay_planilla (cable, zona, edificio, estado, fechacarga)
         VALUES ('001', '01', $1, 'EJECUTADA', current_date - 1)`,
        [EDIF_ONE]
      );

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      expect(outcome.history.skipped).toBe(false);
      expect(outcome.history.copied).toBe(1);
    });

    it("should evaluate the rule with the database clock: the statement carries current_date and no JS date", async () => {
      // Arrange
      await seedStandardWorld();
      await seedAvance(database, [{ cable: "001", zona: "01", edificio: EDIF_ONE, fechacarga: null }]);
      const client = new RecordingPgliteClient(database);

      // Act
      await rebuildAvance(client, standardFiles());

      // Assert
      const stateCall = client.calls.find((call) => /loaded_today/.test(call.text));
      expect(stateCall?.text).toContain("current_date");
      expect(stateCall?.values).toEqual([]);
    });

    it("should copy the legacy columns only and preserve fechacarga (statement text)", () => {
      // Arrange & Act & Assert
      expect(COPY_TO_HISTORY_SQL).toContain(
        "(central, cable, zona, conca, edificio, empresa, fecha, director, ejecutor, estado, fechacarga)"
      );
      expect(COPY_TO_HISTORY_SQL).toContain("aup.fechacarga");
      expect(COPY_TO_HISTORY_SQL).not.toContain("fecha_historico");
    });
  });

  describe("Avance rebuild (AC-16, AC-17)", () => {
    it("should replace the Avance with the staging rows joined to the zones, with the legacy column mapping", async () => {
      // Arrange
      await seedStandardWorld();
      await seedAvance(database, [{ cable: "001", zona: "09", edificio: "STALE", fechacarga: OLD_LOAD_DATE }]);
      const row = makeRow({
        central: "MERCEDES",
        cable: "01",
        zona: "01",
        empresa: "Gofinal",
        plano_al_com: "3/9/2020",
        ejecutor: "DURLEX",
        director: "Arean",
        etiqueta: "EN TRABAJO",
        conca: "MERCEDESC01ZONA 01",
        edificio: EDIF_ONE,
      });
      const files = [makeParsedFile(AvanceFileKind.INT, [row]), makeParsedFile(AvanceFileKind.UDPEM, [])];

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      expect(outcome.files[0].avanceInserted).toBe(1);
      expect(await readAvance()).toEqual([
        {
          central: "MERCEDES",
          cable: "001",
          zona: "01",
          conca: "MERCEDESC01ZONA 01",
          edificio: EDIF_ONE,
          empresa: "Gofinal",
          fecha: "3/9/2020",
          director: "Arean",
          ejecutor: "DURLEX",
          estado: "EN TRABAJO",
          geom: "GEOM-A",
          fuente: AVANCE_FUENTE,
          cargado_hoy: true,
        },
      ]);
    });

    it("should prefix the cable with a 0 and match edificio|C0cable|Zzona against edificio|codigo_distrito with Z turned into |Z", async () => {
      // Arrange
      await seedZones(database, [{ edificio: "ZZ", codigoDistrito: "C009Z04", status: "Existente", geom: "GEOM-9" }]);
      const row = makeRow({ edificio: "ZZ", cable: "09", zona: "04" });
      const files = [makeParsedFile(AvanceFileKind.INT, [row]), makeParsedFile(AvanceFileKind.UDPEM, [])];

      // Act
      await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      const stored = await readAvance();
      expect(stored).toHaveLength(1);
      expect(stored[0]).toMatchObject({ cable: "009", zona: "04", geom: "GEOM-9" });
    });

    it("should trim edificio, cable and zona of the staging rows before matching", async () => {
      // Arrange
      await seedStandardWorld();
      await seedPlanillaRows(database, AvanceFileKind.INT, []);
      const client = new RecordingPgliteClient(database);
      await client.query(
        `INSERT INTO public.avance_planilla_int (central, cable, zona, empresa, plano_al_com, ejecutor, director, etiqueta, conca, edificio)
         VALUES ('C', ' 01 ', ' 01 ', 'E', 'p', 'j', 'd', 'x', 'k', ' ${EDIF_ONE} ')`,
        []
      );

      // Act
      const inserted = await client.query(INSERT_AVANCE_SQL[AvanceFileKind.INT], [[]]);

      // Assert
      expect((inserted.rows[0] as { total: number }).total).toBe(1);
      expect((await readAvance())[0]).toMatchObject({ cable: "001", edificio: ` ${EDIF_ONE} ` });
    });

    it("should insert INT before UDPEM and collapse identical duplicate staging rows with the GROUP BY", async () => {
      // Arrange
      await seedStandardWorld();
      const duplicated = rowFor(EDIF_ONE, "01");
      const files = [
        makeParsedFile(AvanceFileKind.INT, [duplicated, duplicated, duplicated]),
        makeParsedFile(AvanceFileKind.UDPEM, [rowFor(EDIF_ONE, "02")]),
      ];

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      expect(outcome.files.map((file) => file.avanceInserted)).toEqual([1, 1]);
      expect((await readAvance()).map((row) => [row.zona, row.geom])).toEqual([["01", "GEOM-A"], ["02", "GEOM-B"]]);
    });

    it("should keep two staging rows that share the key but differ in any selected column", async () => {
      // Arrange
      await seedStandardWorld();
      const files = [
        makeParsedFile(AvanceFileKind.INT, [rowFor(EDIF_ONE, "01", { empresa: "UNA" }), rowFor(EDIF_ONE, "01", { empresa: "OTRA" })]),
        makeParsedFile(AvanceFileKind.UDPEM, []),
      ];

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      expect(outcome.files[0].avanceInserted).toBe(2);
    });

    it("should not insert a staging row that finds no zone, and count its key as unmatched", async () => {
      // Arrange
      await seedStandardWorld();

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      expect((await readAvance()).some((row) => row.edificio === EDIF_MISSING)).toBe(false);
      expect(outcome.files[0]).toMatchObject({ avanceInserted: 3, unmatchedKeys: 1 });
    });

    it("should never match zona DO, Primario or PRIMARIO and never count them as unmatched", async () => {
      // Arrange
      await seedZones(database, [{ edificio: EDIF_ONE, codigoDistrito: "C001Z01", status: "Existente" }]);
      const files = [
        makeParsedFile(AvanceFileKind.INT, [rowFor(EDIF_ONE, "DO"), rowFor(EDIF_ONE, "Primario"), rowFor(EDIF_ONE, "PRIMARIO")]),
        makeParsedFile(AvanceFileKind.UDPEM, [rowFor(EDIF_ONE, "01")]),
      ];

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      expect(outcome.files[0]).toMatchObject({ avanceInserted: 0, unmatchedKeys: 0 });
      expect(outcome.files[1]).toMatchObject({ avanceInserted: 1, unmatchedKeys: 0 });
      expect([...EXCLUDED_ZONE_NAMES]).toEqual(["DO", "Primario", "PRIMARIO"]);
    });

    it("should count DISTINCT trimmed keys: a missing key repeated with different other columns counts once", async () => {
      // Arrange
      await seedStandardWorld();
      const files = [
        makeParsedFile(AvanceFileKind.INT, [
          rowFor(EDIF_MISSING, "01", { empresa: "A" }),
          rowFor(EDIF_MISSING, "01", { empresa: "B" }),
          rowFor(EDIF_MISSING, "02"),
          rowFor("EDIF000008", "01"),
        ]),
        makeParsedFile(AvanceFileKind.UDPEM, [rowFor(EDIF_MISSING, "01")]),
      ];

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      expect(outcome.files[0].unmatchedKeys).toBe(3);
      expect(outcome.files[1].unmatchedKeys).toBe(1);
    });

    it("should count a row with a null zona as an unmatched key (it is not one of the excluded zones)", async () => {
      // Arrange
      await seedStandardWorld();
      const files = [
        makeParsedFile(AvanceFileKind.INT, [rowFor(EDIF_ONE, "01"), makeRow({ edificio: EDIF_ONE, zona: null })]),
        makeParsedFile(AvanceFileKind.UDPEM, [rowFor(EDIF_ONE, "01")]),
      ];

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      expect(outcome.files[0].unmatchedKeys).toBe(1);
    });

    it("should write the fuente 'Externo/J.Pierri + WFS/SIGRA' on every Avance row and leave the history fuente alone", async () => {
      // Arrange
      await seedStandardWorld();
      await seedAvance(database, [{ cable: "001", zona: "01", edificio: EDIF_ONE, fechacarga: OLD_LOAD_DATE }]);

      // Act
      await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      const fuentes = (await readAvance()).map((row) => row.fuente);
      expect(AVANCE_FUENTE).toBe("Externo/J.Pierri + WFS/SIGRA");
      expect(fuentes).toHaveLength(4);
      expect(new Set(fuentes)).toEqual(new Set([AVANCE_FUENTE]));
    });

    it("should return the loaded-file figures: rows, junk, inserted and unmatched", async () => {
      // Arrange
      await seedStandardWorld();

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      expect(outcome.files).toEqual([
        { kind: AvanceFileKind.INT, fileName: "SituacionFTTH_INT_21092026.csv", rowsLoaded: 5, junkDeleted: 0, avanceInserted: 3, unmatchedKeys: 1 },
        { kind: AvanceFileKind.UDPEM, fileName: "SituacionFTTH_UDPEM_21092026.csv", rowsLoaded: 2, junkDeleted: 0, avanceInserted: 1, unmatchedKeys: 0 },
      ]);
    });
  });

  describe("district status filter (decision O1) and the by-status breakdown (AC-20)", () => {
    it("should keep the eliminated zone under parity (the constant is empty) and break the inserted rows down by status", async () => {
      // Arrange
      await seedStandardWorld();

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), standardFiles());

      // Assert
      expect([...EXCLUDED_DISTRICT_STATUSES]).toEqual([]);
      expect((await readAvance()).map((row) => row.geom).sort()).toEqual(["GEOM-A", "GEOM-A", "GEOM-B", "GEOM-C"]);
      expect(outcome.byStatus).toEqual([
        { status: "Existente", count: 2 },
        { status: "Proyectado/Eliminacion", count: 1 },
        { status: "Proyectado/Instalacion", count: 1 },
      ]);
    });

    it("should exclude the eliminated zone from the insert when the status is passed as the filter, and keep the others", async () => {
      // Arrange
      await seedStandardWorld();
      const client = new RecordingPgliteClient(database);
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: EDIF_ONE, cable: "01", zona: "01" },
        { edificio: EDIF_TWO, cable: "01", zona: "01" },
      ]);

      // Act
      const inserted = await client.query(INSERT_AVANCE_SQL[AvanceFileKind.INT], [[ELIMINATED_STATUS]]);

      // Assert
      expect((inserted.rows[0] as { total: number }).total).toBe(1);
      expect((await readAvance()).map((row) => row.geom)).toEqual(["GEOM-A"]);
    });

    it("should include the same eliminated zone when the filter is empty", async () => {
      // Arrange
      await seedStandardWorld();
      const client = new RecordingPgliteClient(database);
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: EDIF_ONE, cable: "01", zona: "01" },
        { edificio: EDIF_TWO, cable: "01", zona: "01" },
      ]);

      // Act
      const inserted = await client.query(INSERT_AVANCE_SQL[AvanceFileKind.INT], [[]]);

      // Assert
      expect((inserted.rows[0] as { total: number }).total).toBe(2);
    });

    it("should compute the breakdown before the insert from the same join, and the filter changes it the same way", async () => {
      // Arrange
      await seedStandardWorld();
      const client = new RecordingPgliteClient(database);
      await seedPlanillaRows(database, AvanceFileKind.INT, [
        { edificio: EDIF_ONE, cable: "01", zona: "01" },
        { edificio: EDIF_ONE, cable: "01", zona: "02" },
        { edificio: EDIF_TWO, cable: "01", zona: "01" },
      ]);

      // Act
      const parity = await client.query(BREAKDOWN_BY_STATUS_SQL[AvanceFileKind.INT], [[]]);
      const intent = await client.query(BREAKDOWN_BY_STATUS_SQL[AvanceFileKind.INT], [[ELIMINATED_STATUS]]);

      // Assert
      expect(parity.rows).toEqual([
        { status: "Existente", total: 1 },
        { status: ELIMINATED_STATUS, total: 1 },
        { status: "Proyectado/Instalacion", total: 1 },
      ]);
      expect(intent.rows).toEqual([
        { status: "Existente", total: 1 },
        { status: "Proyectado/Instalacion", total: 1 },
      ]);
      expect(await countRows(database, "public.avance_uruguay_planilla")).toBe(0);
    });

    it("should count a key whose only zone is excluded as unmatched under the intent filter, and not under parity", async () => {
      // Arrange
      await seedStandardWorld();
      const client = new RecordingPgliteClient(database);
      await seedPlanillaRows(database, AvanceFileKind.INT, [{ edificio: EDIF_TWO, cable: "01", zona: "01" }]);
      const names = [...EXCLUDED_ZONE_NAMES];

      // Act
      const parity = await client.query(COUNT_UNMATCHED_SQL[AvanceFileKind.INT], [[], names]);
      const intent = await client.query(COUNT_UNMATCHED_SQL[AvanceFileKind.INT], [[ELIMINATED_STATUS], names]);

      // Assert
      expect((parity.rows[0] as { total: number }).total).toBe(0);
      expect((intent.rows[0] as { total: number }).total).toBe(1);
    });

    it("should carry the filter through the whole rebuild when the constant lists the eliminated status (intent)", async () => {
      // Arrange
      vi.resetModules();
      vi.doMock("@/modules/coverage-loads/avance-ftth/constants", async (importOriginal) => ({
        ...(await importOriginal<typeof import("@/modules/coverage-loads/avance-ftth/constants")>()),
        EXCLUDED_DISTRICT_STATUSES: ["Proyectado/Eliminacion"],
      }));
      const { rebuildAvance: rebuildWithIntent } = await import("@/modules/coverage-loads/avance-ftth/services/queries/runRebuildQueries");
      await seedStandardWorld();

      // Act
      let outcome;
      try {
        outcome = await rebuildWithIntent(new RecordingPgliteClient(database), standardFiles());
      } finally {
        vi.doUnmock("@/modules/coverage-loads/avance-ftth/constants");
        vi.resetModules();
      }

      // Assert
      expect((await readAvance()).map((row) => row.geom).sort()).toEqual(["GEOM-A", "GEOM-A", "GEOM-B"]);
      expect(outcome.byStatus).toEqual([
        { status: "Existente", count: 2 },
        { status: "Proyectado/Instalacion", count: 1 },
      ]);
      expect(outcome.files[0]).toMatchObject({ avanceInserted: 2, unmatchedKeys: 2 });
    });
  });

  describe("consistency check (AC-18)", () => {
    it("should throw and name the numbers when the Avance count differs from the sum of the two inserts", async () => {
      // Arrange
      await seedStandardWorld();
      const lying = new RecordingPgliteClient(database);
      const query = lying.query.bind(lying);
      lying.query = async (text: string, values: unknown[]) =>
        /^SELECT count\(\*\)::int AS total FROM public\.avance_uruguay_planilla/.test(text.trim())
          ? { rows: [{ total: 99 }] }
          : query(text, values);

      // Act
      const attempt = rebuildAvance(lying, standardFiles());

      // Assert
      await expect(attempt).rejects.toThrow("El Avance quedó con 99 filas y los inserts escribieron 4; se deshizo la carga.");
    });

    it("should throw when a staging table holds a different count than loaded minus junk", async () => {
      // Arrange
      await seedStandardWorld();
      const lying = new RecordingPgliteClient(database);
      const query = lying.query.bind(lying);
      lying.query = async (text: string, values: unknown[]) =>
        /^SELECT count\(\*\)::int AS total FROM public\.avance_planilla_mvd/.test(text.trim())
          ? { rows: [{ total: 1 }] }
          : query(text, values);

      // Act
      const attempt = rebuildAvance(lying, standardFiles());

      // Assert
      await expect(attempt).rejects.toThrow(
        "La planilla de Montevideo (UDPEM) quedó con 1 filas y se esperaban 2; se deshizo la carga."
      );
    });

    it("should pass with duplicates collapsed: Avance count below the staging count is fine", async () => {
      // Arrange
      await seedStandardWorld();
      const duplicated = rowFor(EDIF_ONE, "01");
      const files = [makeParsedFile(AvanceFileKind.INT, [duplicated, duplicated]), makeParsedFile(AvanceFileKind.UDPEM, [duplicated])];

      // Act
      const outcome = await rebuildAvance(new RecordingPgliteClient(database), files);

      // Assert
      expect(outcome.files.map((file) => file.avanceInserted)).toEqual([1, 1]);
      expect(await countRows(database, "public.avance_uruguay_planilla")).toBe(2);
      expect(await countRows(database, "public.avance_planilla_int")).toBe(2);
    });
  });
});
