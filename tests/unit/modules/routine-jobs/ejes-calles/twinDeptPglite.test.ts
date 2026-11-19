import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import type { EjesAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesLayouts } from "./ejesFixtures";
import { createEjesDatabase, insertDepartment, insertPadron, insertStaging, sessionOn, type StagingRow } from "./ejesLoadHarness";

const HOOK_TIMEOUT_MS = 60_000;
const SECTION = "0:100";
const URBAN_PADRON = "0:50";

const copyOf = (departamento: string | null, localidad: string, ref = "3002", geom = SECTION): StagingRow => ({
  ref,
  calle: "7",
  nombre: "CALLE SIETE",
  departamento,
  localidad,
  geom,
});

describe("twin department choice on PGlite (ET-2a)", () => {
  let database: PGlite;

  beforeEach(async () => {
    database = await createEjesDatabase(PGlite);
    await insertPadron(database, "URBANO", URBAN_PADRON);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  const analysis = (): Promise<EjesAnalysis> => readAnalysis(sessionOn(database), ejesLayouts());

  const flores = (): StagingRow[] => [copyOf("FLORES", "TRINIDAD"), copyOf("FLORES", "FLORES RURAL")];

  describe("a reftramo with copies in several departments", () => {
    it("should keep the copies of the department whose polygon the section overlaps most, and drop the copies of the other department", async () => {
      await insertDepartment(database, "FLORES", "0:80");
      await insertDepartment(database, "SORIANO", "80:200");
      await insertStaging(database, [...flores(), copyOf("SORIANO", "MERCEDES")]);

      const result = await analysis();

      expect(result.twins).toHaveLength(1);
      expect(result.twins[0]).toMatchObject({
        ref: "3002",
        department: "FLORES",
        localities: ["FLORES RURAL", "TRINIDAD"],
        class: "URBAN",
        dropLocalities: ["FLORES RURAL"],
      });
      expect(result.counts).toMatchObject({ twinsCrossDepartment: 0, twinsUndecided: 0 });
    });

    it("should keep the copies of the other department when the section overlaps its polygon the most", async () => {
      await insertDepartment(database, "FLORES", "80:200");
      await insertDepartment(database, "SORIANO", "0:80");
      await insertStaging(database, [...flores(), copyOf("SORIANO", "MERCEDES"), copyOf("SORIANO", "MERCEDES RURAL")]);

      const result = await analysis();

      expect(result.twins).toHaveLength(1);
      expect(result.twins[0]).toMatchObject({
        ref: "3002",
        department: "SORIANO",
        localities: ["MERCEDES", "MERCEDES RURAL"],
        dropLocalities: ["MERCEDES RURAL"],
      });
    });

    it("should keep the department with the lowest name when two polygons overlap the section equally", async () => {
      await insertDepartment(database, "SORIANO", "50:100");
      await insertDepartment(database, "FLORES", "0:50");
      await insertStaging(database, [...flores(), copyOf("SORIANO", "MERCEDES")]);

      const result = await analysis();

      expect(result.twins[0]).toMatchObject({ department: "FLORES", dropLocalities: ["FLORES RURAL"] });
    });

    it("should match the department polygon name trimmed and in any case", async () => {
      await insertDepartment(database, " flores ", "0:80");
      await insertDepartment(database, "SORIANO", "80:200");
      await insertStaging(database, [...flores(), copyOf("SORIANO", "MERCEDES")]);

      const result = await analysis();

      expect(result.twins[0]).toMatchObject({ department: "FLORES", dropLocalities: ["FLORES RURAL"] });
    });

    it("should drop the copies of every other department at once when the section lies in one of three", async () => {
      await insertDepartment(database, "FLORES", "0:100");
      await insertDepartment(database, "SORIANO", "150:200");
      await insertDepartment(database, "CANELONES", "200:300");
      await insertStaging(database, [...flores(), copyOf("SORIANO", "MERCEDES"), copyOf("CANELONES", "LAS PIEDRAS")]);

      const result = await analysis();

      expect(result.twins[0]).toMatchObject({ department: "FLORES", localities: ["FLORES RURAL", "TRINIDAD"], dropLocalities: ["FLORES RURAL"] });
      expect(result.counts.twinsCrossDepartment).toBe(0);
    });

    it("should keep a copy with no department whatever the choice, and treat it with the chosen department's copies", async () => {
      await insertDepartment(database, "FLORES", "0:80");
      await insertDepartment(database, "SORIANO", "80:200");
      await insertStaging(database, [copyOf("FLORES", "TRINIDAD"), copyOf("SORIANO", "MERCEDES"), copyOf(null, "BARRIO")]);

      const result = await analysis();

      expect(result.twins[0]).toMatchObject({ department: "FLORES", localities: ["BARRIO", "TRINIDAD"], dropLocalities: ["TRINIDAD"] });
    });

    it("should keep every copy and count the reftramo as cross-department when no department polygon exists", async () => {
      await insertStaging(database, [copyOf("FLORES", "TRINIDAD"), copyOf("SORIANO", "MERCEDES")]);

      const result = await analysis();

      expect(result.twins).toEqual([]);
      expect(result.counts).toMatchObject({ twinsCrossDepartment: 1, twinsUndecided: 1 });
      expect(result.twinUndecided).toHaveLength(1);
      expect(result.twinUndecided[0]).toMatchObject({
        ref: "3002",
        copies: [
          { department: "FLORES", locality: "TRINIDAD" },
          { department: "SORIANO", locality: "MERCEDES" },
        ],
      });
    });

    it("should keep every copy and count the reftramo as cross-department when no department polygon intersects the section", async () => {
      await insertDepartment(database, "FLORES", "500:600");
      await insertDepartment(database, "SORIANO", "700:800");
      await insertStaging(database, [copyOf("FLORES", "TRINIDAD"), copyOf("SORIANO", "MERCEDES")]);

      const result = await analysis();

      expect(result.twins).toEqual([]);
      expect(result.counts).toMatchObject({ twinsCrossDepartment: 1, twinsUndecided: 1 });
      expect(result.twinUndecided[0].copies).toHaveLength(2);
    });
  });

  describe("a reftramo with copies in one department", () => {
    it("should apply the one-department rules as before, whatever the department polygons say", async () => {
      await insertDepartment(database, "SORIANO", "0:100");
      await insertStaging(database, flores());

      const result = await analysis();

      expect(result.twins).toHaveLength(1);
      expect(result.twins[0]).toMatchObject({ ref: "3002", department: "FLORES", dropLocalities: ["FLORES RURAL"] });
      expect(result.counts).toMatchObject({ twinsCrossDepartment: 0, twinsUndecided: 0 });
    });
  });
});
