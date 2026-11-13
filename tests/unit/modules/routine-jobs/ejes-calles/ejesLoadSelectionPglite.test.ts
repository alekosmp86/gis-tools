import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildCopyTableSql,
  buildExistTableSql,
  buildMultiPartCountSql,
  buildPairTableSql,
  buildRenumTableSql,
  buildStateTableSql,
  buildSurplusTableSql,
  LOAD_TEMP,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadSelectionSql";
import { ejesLayouts } from "./ejesFixtures";
import { createEjesDatabase, insertPadron, insertPoints, insertSection, insertStaging, insertWay, rowsOf } from "./ejesLoadHarness";

const HOOK_TIMEOUT_MS = 60_000;

describe("ejes load selection SQL on PGlite (EJL-6, EJL-7)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await createEjesDatabase(PGlite);
    await database.exec("BEGIN");
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  const select = async (): Promise<void> => {
    const layouts = ejesLayouts();
    for (const sql of [
      buildCopyTableSql(layouts),
      buildRenumTableSql(layouts),
      buildExistTableSql(layouts),
      buildPairTableSql(),
      buildStateTableSql(layouts),
      buildSurplusTableSql(layouts),
    ]) {
      await database.exec(sql);
    }
  };

  const copies = async (): Promise<Array<{ ref: string; localidad: string | null; departamento: string | null }>> =>
    rowsOf(database, `SELECT ref, localidad, departamento FROM pg_temp."${LOAD_TEMP.COPY}" ORDER BY copy_id`) as Promise<
      Array<{ ref: string; localidad: string | null; departamento: string | null }>
    >;

  const pairs = async (): Promise<Array<{ ref: string; road_id: number | null }>> =>
    rowsOf(
      database,
      `SELECT c.ref, p.road_id FROM pg_temp."${LOAD_TEMP.COPY}" c LEFT JOIN pg_temp."${LOAD_TEMP.PAIR}" p ON p.copy_id = c.copy_id ORDER BY c.copy_id`
    ) as Promise<Array<{ ref: string; road_id: number | null }>>;

  describe("copies kept by the twin rules (EJL-6)", () => {
    it("should keep one copy per reftramo, locality and department", async () => {
      await insertStaging(database, [
        { ref: "1", localidad: "A", departamento: "D1", geom: "0:10" },
        { ref: "1", localidad: "A", departamento: "D1", geom: "0:10" },
        { ref: "2", localidad: "A", departamento: "D1", geom: "20:30" },
      ]);

      await select();

      expect((await copies()).map((row) => row.ref)).toEqual(["1", "2"]);
    });

    it("should keep a copy per department when the same locality name appears in two departments", async () => {
      await insertStaging(database, [
        { ref: "1", localidad: "A", departamento: "D1", geom: "0:10" },
        { ref: "1", localidad: "A", departamento: "D2", geom: "0:10" },
      ]);

      await select();

      expect(await copies()).toEqual([
        { ref: "1", localidad: "A", departamento: "D1" },
        { ref: "1", localidad: "A", departamento: "D2" },
      ]);
    });

    it("should keep both copies of a twin next to urban and rural padrones", async () => {
      await insertPadron(database, "URBANO", "0:50");
      await insertPadron(database, "RURAL", "0:50");
      await insertStaging(database, [
        { ref: "7", localidad: "TRINIDAD", geom: "0:50" },
        { ref: "7", localidad: "FLORES RURAL", geom: "0:50" },
      ]);

      await select();

      expect((await copies()).map((row) => row.localidad)).toEqual(["FLORES RURAL", "TRINIDAD"]);
    });

    it("should drop the rural-named copy of a twin next to urban padrones only", async () => {
      await insertPadron(database, "URBANO", "0:50");
      await insertStaging(database, [
        { ref: "7", localidad: "TRINIDAD", geom: "0:50" },
        { ref: "7", localidad: "FLORES RURAL", geom: "0:50" },
      ]);

      await select();

      expect((await copies()).map((row) => row.localidad)).toEqual(["TRINIDAD"]);
    });

    it("should drop the urban copy of a twin next to rural padrones only", async () => {
      await insertPadron(database, "RURAL", "0:50");
      await insertStaging(database, [
        { ref: "7", localidad: "TRINIDAD", geom: "0:50" },
        { ref: "7", localidad: "FLORES RURAL", geom: "0:50" },
      ]);

      await select();

      expect((await copies()).map((row) => row.localidad)).toEqual(["FLORES RURAL"]);
    });

    it("should skip rows with an empty or invalid geometry or a non-integer reftramo", async () => {
      await insertStaging(database, [
        { ref: "1", geom: "" },
        { ref: "2", geom: "BAD" },
        { ref: "x3", geom: "0:10" },
        { ref: "4", geom: "0:10" },
      ]);

      await select();

      expect((await copies()).map((row) => row.ref)).toEqual(["4"]);
    });

    it("should trim the reftramo so a padded value pairs with its section", async () => {
      await insertWay(database, 10, "CALLE UNO");
      const id = await insertSection(database, { ref: 12, calle: 10, geom: "0:10" });
      await insertStaging(database, [{ ref: " 12 ", geom: "0:10" }]);

      await select();

      expect(await pairs()).toEqual([{ ref: "12", road_id: id }]);
    });
  });

  describe("pairing by reftramo (EJL-7)", () => {
    const twinBoth = async (ref: string): Promise<void> => {
      await insertPadron(database, "URBANO", "0:50");
      await insertPadron(database, "RURAL", "0:50");
      await insertStaging(database, [
        { ref, calle: "10", nombre: "CALLE UNO", localidad: "TRINIDAD", geom: "0:50" },
        { ref, calle: "10", nombre: "CALLE UNO", localidad: "FLORES RURAL", geom: "0:50" },
      ]);
    };

    it("K = E: should pair each copy with one existing row, each row once", async () => {
      await insertWay(database, 10, "CALLE UNO");
      const a = await insertSection(database, { ref: 7, calle: 10, geom: "0:50" });
      const b = await insertSection(database, { ref: 7, calle: 10, geom: "0:50" });
      await twinBoth("7");

      await select();

      const found = await pairs();
      expect(found).toHaveLength(2);
      expect(found.map((row) => row.road_id).sort()).toEqual([a, b].sort());
    });

    it("K = E: should pair by idcalle and name first, then by the lowest id", async () => {
      await insertWay(database, 10, "CALLE UNO");
      await insertWay(database, 11, "CALLE ONCE");
      const lowOther = await insertSection(database, { ref: 7, calle: 11, geom: "0:50" });
      const highSame = await insertSection(database, { ref: 7, calle: 10, geom: "0:50" });
      await insertPadron(database, "URBANO", "0:50");
      await insertPadron(database, "RURAL", "0:50");
      await insertStaging(database, [
        { ref: "7", calle: "10", nombre: "CALLE UNO", localidad: "TRINIDAD", geom: "0:50" },
        { ref: "7", calle: "12", nombre: "OTRA", localidad: "ZETA", geom: "0:50" },
      ]);

      await select();

      const found = await rowsOf<{ localidad: string; road_id: number }>(
        database,
        `SELECT c.localidad, p.road_id FROM pg_temp."${LOAD_TEMP.COPY}" c JOIN pg_temp."${LOAD_TEMP.PAIR}" p ON p.copy_id = c.copy_id ORDER BY c.localidad`
      );
      expect(found.find((row) => row.localidad === "TRINIDAD")?.road_id).toBe(highSame);
      expect(found.find((row) => row.localidad === "ZETA")?.road_id).toBe(lowOther);
    });

    it("K > E: should pair E copies and leave K-E copies unpaired (NEW)", async () => {
      await insertWay(database, 10, "CALLE UNO");
      const existing = await insertSection(database, { ref: 7, calle: 10, geom: "0:50" });
      await twinBoth("7");

      await select();

      const found = await pairs();
      expect(found.filter((row) => row.road_id !== null)).toEqual([{ ref: "7", road_id: existing }]);
      expect(found.filter((row) => row.road_id === null)).toHaveLength(1);
    });

    it("K > E with E = 0: should leave every copy unpaired", async () => {
      await twinBoth("7");

      await select();

      expect((await pairs()).every((row) => row.road_id === null)).toBe(true);
      expect(await pairs()).toHaveLength(2);
    });

    it("K < E: should pair the K copies and list the E-K surplus rows with reftramo, id and points", async () => {
      await insertWay(database, 10, "CALLE UNO");
      const a = await insertSection(database, { ref: 7, calle: 10, geom: "0:50" });
      const b = await insertSection(database, { ref: 7, calle: 10, geom: "0:50" });
      const c = await insertSection(database, { ref: 7, calle: 10, geom: "0:50" });
      await insertPoints(database, "7", 5);
      await insertStaging(database, [{ ref: "7", calle: "10", nombre: "CALLE UNO", geom: "0:50" }]);

      await select();

      expect(await pairs()).toEqual([{ ref: "7", road_id: a }]);
      const surplus = await rowsOf<{ id: number; ref: string; points: string }>(
        database,
        `SELECT id, ref, points FROM pg_temp."${LOAD_TEMP.SURPLUS}" ORDER BY id`
      );
      expect(surplus.map((row) => [row.id, row.ref, Number(row.points)])).toEqual([
        [b, "7", 5],
        [c, "7", 5],
      ]);
    });

    it("should not list as surplus an existing reftramo that has no copy in the staging", async () => {
      await insertWay(database, 10, "CALLE UNO");
      await insertSection(database, { ref: 99, calle: 10, geom: "0:50" });
      await insertStaging(database, [{ ref: "1", geom: "500:510" }]);

      await select();

      expect(await rowsOf(database, `SELECT * FROM pg_temp."${LOAD_TEMP.SURPLUS}"`)).toEqual([]);
    });

    it("should flag ATTR and GEOM per pair against the existing row", async () => {
      await insertWay(database, 10, "CALLE UNO");
      await insertSection(database, { ref: 5, calle: 10, geom: "0:50", type: 4, font: 1 });
      await insertSection(database, { ref: 6, calle: 10, geom: "0:50", type: 4, font: 1 });
      await insertStaging(database, [
        { ref: "5", calle: "10", tipo: "PASAJE", fuente: "IDE", geom: "0:50" },
        { ref: "6", calle: "10", tipo: "CALLE", fuente: "OSM", geom: "0:70" },
      ]);

      await select();

      const state = await rowsOf<Record<string, unknown>>(
        database,
        `SELECT e.ref, s.idcalle_changed, s.type_changed, s.font_changed, s.geom_changed FROM pg_temp."${LOAD_TEMP.STATE}" s JOIN pg_temp."${LOAD_TEMP.EXIST}" e ON e.id = s.road_id ORDER BY e.ref`
      );
      expect(state).toEqual([
        { ref: "5", idcalle_changed: false, type_changed: true, font_changed: false, geom_changed: false },
        { ref: "6", idcalle_changed: false, type_changed: false, font_changed: true, geom_changed: true },
      ]);
    });

    it("should count a geometry that stays multi-part as a blocker candidate only for NEW or GEOM-changed copies", async () => {
      await insertWay(database, 10, "CALLE UNO");
      await insertSection(database, { ref: 5, calle: 10, geom: "0:10|20:30" });
      await insertStaging(database, [
        { ref: "5", calle: "10", geom: "0:10|20:30" },
        { ref: "6", calle: "10", geom: "40:50|60:70" },
      ]);

      await select();

      const result = await rowsOf<{ multi_part: string }>(database, buildMultiPartCountSql());
      expect(Number(result[0].multi_part)).toBe(1);
    });
  });
});
