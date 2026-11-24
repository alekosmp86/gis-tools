import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveEjesLayouts } from "@/modules/routine-jobs/jobs/ejes-calles/services/resolveLayouts";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { ejesLayouts } from "./ejesFixtures";
import { createEjesDatabase, insertDepartment, insertSection, insertStaging, insertWay, paramsWith, sessionOn } from "./ejesLoadHarness";

const HOOK_TIMEOUT_MS = 60_000;
const FLORES = "FLORES";
const MONTEVIDEO = "MONTEVIDEO";

/**
 * The catalog of the harness reports a PostGIS geometry column as the bare `geometry` type of its stub domain; a real column reports
 * `geometry(Geometry,32721)`, which is the SRID the scope check reads. Only the type text is adapted, every row comes from PGlite.
 */
const catalogOf = (database: PGlite): CatalogQuerySession => {
  const session = sessionOn(database);
  return {
    async query(sql: string, values?: unknown[]) {
      const result = await session.query(sql, values);
      return {
        rows: result.rows.map((row) => (row.data_type === "geometry" ? { ...row, data_type: "geometry(Geometry,32721)" } : row)),
      } as Awaited<ReturnType<CatalogQuerySession["query"]>>;
    },
  };
};

const scopedParams = (department: string) => ({ ...paramsWith(undefined), department });

describe("department scope by reference on PGlite (EJ-scope, scopedLayoutsOf, assertDepartmentScope)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await createEjesDatabase(PGlite);
    await insertWay(database, 77, "CALLE UNO");
    await insertDepartment(database, FLORES, "0:100");
    await insertDepartment(database, MONTEVIDEO, "200:300", "01");
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  describe("the analysis of one department", () => {
    it("should classify only the references whose centre lies in the department, so a section outside it is not a removal", async () => {
      await insertSection(database, { ref: 1001, calle: 77, geom: "10:20", distance: "10.00" });
      await insertSection(database, { ref: 2001, calle: 77, geom: "210:220", distance: "10.00" });
      await insertStaging(database, [
        { ref: "1001", calle: "77", nombre: "CALLE UNO", geom: "10:20" },
        { ref: "3001", calle: "77", nombre: "CALLE UNO", geom: "400:410" },
      ]);

      const { layouts } = await resolveEjesLayouts(catalogOf(database), scopedParams(FLORES));
      const analysis = await readAnalysis(sessionOn(database), layouts);

      expect(analysis.counts).toMatchObject({ unchanged: 1, newSections: 0, removed: 0 });
      expect(analysis.plainRemovals).toEqual([]);
    });

    it("should classify the same data without a scope: the section outside the department becomes a removal and its staging row a new section", async () => {
      await insertSection(database, { ref: 1001, calle: 77, geom: "10:20", distance: "10.00" });
      await insertSection(database, { ref: 2001, calle: 77, geom: "210:220", distance: "10.00" });
      await insertStaging(database, [
        { ref: "1001", calle: "77", nombre: "CALLE UNO", geom: "10:20" },
        { ref: "3001", calle: "77", nombre: "CALLE UNO", geom: "400:410" },
      ]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.plainRemovals.map((row) => row.ref)).toEqual(["2001"]);
      expect(analysis.counts.newSections).toBe(1);
    });

    it("should read both sides of a reference when only its section lies in the department, so the staging row outside it is still compared", async () => {
      await insertSection(database, { ref: 1002, calle: 77, geom: "40:50", distance: "10.00" });
      await insertStaging(database, [{ ref: "1002", calle: "77", nombre: "CALLE UNO", geom: "60:70" }]);

      const { layouts } = await resolveEjesLayouts(catalogOf(database), scopedParams(FLORES));
      const analysis = await readAnalysis(sessionOn(database), layouts);

      expect(analysis.plainRemovals).toEqual([]);
      expect(analysis.counts.geom).toBe(1);
    });
  });

  describe("assertDepartmentScope", () => {
    it("should refuse a department that names no polygon, naming it", async () => {
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "CALLE UNO", geom: "10:20" }]);

      await expect(resolveEjesLayouts(catalogOf(database), scopedParams("NOWHERE"))).rejects.toThrow(
        "El departamento NOWHERE no está en la tabla de departamentos."
      );
    });

    it("should refuse a department whose scope holds no staging row, naming it", async () => {
      await insertSection(database, { ref: 1001, calle: 77, geom: "10:20", distance: "10.00" });
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: "CALLE UNO", geom: "10:20" }]);

      await expect(resolveEjesLayouts(catalogOf(database), scopedParams(MONTEVIDEO))).rejects.toThrow(
        `El archivo de ejes no tiene tramos del departamento ${MONTEVIDEO}.`
      );
    });
  });
});
