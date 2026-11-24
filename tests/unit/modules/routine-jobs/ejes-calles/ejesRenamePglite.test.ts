import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { NO_ACCEPTED } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadMapping";
import type { EjesAcceptedRename, EjesAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { ejesLayouts } from "./ejesFixtures";
import {
  createEjesDatabase,
  insertStaging,
  insertWay,
  loadContextOn,
  paramsWith,
  rowsOf,
  sessionOn,
  snapshotOf,
  summaryOn,
  type Row,
  type SqlLog,
} from "./ejesLoadHarness";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;
const ANALYSIS_CHANGED = /vuelva a analizar/;
const timer = () => createStepTimer({ now: () => 0, total: 20 });
const STREET = 77;
const ITALIA = "AVENIDA ITALIA";
const CALLE_NUEVA = "CALLE NUEVA";

describe("renamed streets on PGlite (EJL-31)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-rename-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const persist = async (renamedStreets: EjesAcceptedRename[] = [], log: SqlLog = []): Promise<EjesPersistOutcome> => {
    const summary = await summaryOn(database);
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(
      sessionOn(database, log),
      { ...paramsWith(summary), accepted: { ...NO_ACCEPTED, renamedStreets } },
      context,
      timer()
    );
  };

  const analysis = async (): Promise<EjesAnalysis> => readAnalysis(sessionOn(database), ejesLayouts());

  const waysOf = async (): Promise<Row[]> => rowsOf(database, "SELECT id, id_calle, name, short_name FROM carto.circulation_way ORDER BY id");

  const waysWithTypesOf = async (): Promise<Row[]> =>
    rowsOf(database, "SELECT id, id_calle, name, short_name, id_road_type, id_font FROM carto.circulation_way ORDER BY id");

  const readBackup = async (outcome: EjesPersistOutcome): Promise<string> => {
    const entry = getRevertBackup(outcome.load.backup?.token ?? "");
    expect(entry).toBeDefined();
    return gunzipSync(await readFile(entry?.filePath ?? "")).toString("utf8");
  };

  describe("an accepted rename (EJL-31)", () => {
    it("should rename every way row of the accepted street whose name differs and create no second way", async () => {
      const first = await insertWay(database, STREET, "NOMBRE VIEJO A");
      const second = await insertWay(database, STREET, "NOMBRE VIEJO B");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" }]);

      const outcome = await persist([{ idcalle: String(STREET) }]);

      expect(outcome.load.counts).toMatchObject({ waysCreated: 0, waysRenamed: 2 });
      expect(await waysOf()).toEqual([
        { id: first, id_calle: STREET, name: ITALIA, short_name: "AV ITALIA" },
        { id: second, id_calle: STREET, name: ITALIA, short_name: "AV ITALIA" },
      ]);
    });

    it("should rename the way of a street whose only row holds NULL as its name, and restore NULL with the revert file", async () => {
      await database.query("INSERT INTO carto.circulation_way (id_calle, name, short_name, id_road_type, id_font) VALUES (77, NULL, NULL, 4, 1)");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" }]);
      const before = await waysOf();
      const listed = (await analysis()).renamedStreets;
      expect(listed.map((row) => [row.idcalle, row.currentNames, row.newName])).toEqual([["77", null, ITALIA]]);

      const outcome = await persist([{ idcalle: String(STREET) }]);

      expect(outcome.load.counts).toMatchObject({ waysCreated: 0, waysRenamed: 1 });
      expect(await waysOf()).toEqual([{ id: before[0].id, id_calle: STREET, name: ITALIA, short_name: "AV ITALIA" }]);

      await database.exec(await readBackup(outcome));

      expect(await waysOf()).toEqual(before);
    });

    it("should restore the old names of every renamed way when the revert SQL is applied", async () => {
      await insertWay(database, STREET, "NOMBRE VIEJO A");
      await insertWay(database, STREET, "NOMBRE VIEJO B");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" }]);
      const before = await waysOf();
      const outcome = await persist([{ idcalle: String(STREET) }]);
      expect(outcome.load.counts.waysRenamed).toBe(2);

      await database.exec(await readBackup(outcome));

      expect(await waysOf()).toEqual(before);
    });

    it("should set the road type and font of the file to the renamed way, and the revert restore all four values", async () => {
      const way = await insertWay(database, STREET, "NOMBRE VIEJO", 4, 1);
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, tipo: "PASAJE", fuente: "INE", geom: "0:10" }]);
      const before = await waysWithTypesOf();

      const outcome = await persist([{ idcalle: String(STREET) }]);

      expect(outcome.load.counts).toMatchObject({ waysRenamed: 1 });
      expect(await waysWithTypesOf()).toEqual([
        { id: way, id_calle: STREET, name: ITALIA, short_name: "AV ITALIA", id_road_type: 10, id_font: 3 },
      ]);

      await database.exec(await readBackup(outcome));

      expect(await waysWithTypesOf()).toEqual(before);
    });
  });

  describe("a rename that is not accepted (EJL-31)", () => {
    it("should leave the existing way row unrenamed and create no way, while the load still inserts the section", async () => {
      await insertWay(database, STREET, "NOMBRE VIEJO");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" }]);
      const before = await waysOf();

      const outcome = await persist([]);

      expect(outcome.load.counts).toMatchObject({ waysRenamed: 0, waysCreated: 0, inserted: 1 });
      expect(outcome.targetModified).toBe(true);
      expect(await waysOf()).toEqual(before);
    });
  });

  describe("an accepted idcalle that is not a rename candidate (EJL-31)", () => {
    it("should fail closed with the analysis-changed message and write nothing when the street has no way in carto", async () => {
      await insertWay(database, 10, "CALLE UNO");
      await insertStaging(database, [{ ref: "1001", calle: "99", nombre: "CALLE NUEVA", geom: "0:10" }]);
      const before = await snapshotOf(database);

      await expect(persist([{ idcalle: "99" }])).rejects.toThrow(ANALYSIS_CHANGED);

      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should fail closed with the analysis-changed message when the accepted street holds the file's name already", async () => {
      await insertWay(database, STREET, ITALIA);
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" }]);
      const before = await snapshotOf(database);

      await expect(persist([{ idcalle: String(STREET) }])).rejects.toThrow(ANALYSIS_CHANGED);

      expect(await snapshotOf(database)).toEqual(before);
    });
  });

  describe("names that differ only in case, accents or spacing (EJL-31)", () => {
    it.each(["Avenida Itália", "AVENIDA  ITALIA ", "avenida italia"])(
      "should neither list nor rename a way named %j when the file names the street AVENIDA ITALIA",
      async (cartoName) => {
        await insertWay(database, STREET, cartoName);
        await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" }]);
        const before = await waysOf();

        const result = await analysis();
        const outcome = await persist([]);

        expect(result.renamedStreets).toEqual([]);
        expect(result.counts.renamedStreets ?? 0).toBe(0);
        expect(outcome.load.counts).toMatchObject({ waysRenamed: 0, waysCreated: 0 });
        expect(await waysOf()).toEqual(before);
      }
    );

    it("should refuse an accepted rename of a street whose way differs only in case, accents or spacing", async () => {
      await insertWay(database, STREET, "Avenida Itália");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" }]);

      await expect(persist([{ idcalle: String(STREET) }])).rejects.toThrow(ANALYSIS_CHANGED);
    });
  });

  describe("the analysis list of renamed streets (EJL-31)", () => {
    it("should list the street with its current names, new name, sections, ways and the counts", async () => {
      await insertWay(database, STREET, "NOMBRE VIEJO A");
      await insertWay(database, STREET, "NOMBRE VIEJO B");
      await insertStaging(database, [
        { ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" },
        { ref: "1002", calle: "77", nombre: ITALIA, geom: "20:30" },
      ]);

      const result = await analysis();

      expect(result.renamedStreets).toEqual([
        { idcalle: "77", currentNames: "NOMBRE VIEJO A / NOMBRE VIEJO B", newName: ITALIA, names: [ITALIA], sections: 2, ways: 2, multiName: false },
      ]);
      expect(result.counts.renamedStreets).toBe(1);
      expect(result.counts.renamedStreetsHeld).toBe(0);
    });

    it("should list no renamed street and count none when the file names every street as carto does", async () => {
      await insertWay(database, STREET, ITALIA);
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" }]);

      const result = await analysis();

      expect(result.renamedStreets).toEqual([]);
      expect(result.counts.renamedStreets ?? 0).toBe(0);
      expect(result.counts.renamedStreetsHeld ?? 0).toBe(0);
    });
  });

  describe("the names of a renamed street (EJL-31)", () => {
    it("should order the names by their normalised form, so a name with an accent sorts by its letter", async () => {
      await insertWay(database, STREET, "NOMBRE VIEJO");
      await insertStaging(database, [
        { ref: "1001", calle: "77", nombre: "Zeta Calle", geom: "0:10" },
        { ref: "1002", calle: "77", nombre: "Ñandú Calle", geom: "20:30" },
      ]);

      const [row] = (await analysis()).renamedStreets;

      expect(row.names).toEqual(["Ñandú Calle", "Zeta Calle"]);
      expect(row.newName).toBe("Ñandú Calle");
    });

    it("should count two spellings of one normalised name as ONE name, with the lowest spelling as its representative", async () => {
      await insertWay(database, STREET, "NOMBRE VIEJO");
      await insertStaging(database, [
        { ref: "1001", calle: "77", nombre: "Avenida Itália", geom: "0:10" },
        { ref: "1002", calle: "77", nombre: "AVENIDA ITALIA", geom: "20:30" },
        { ref: "1003", calle: "77", nombre: "avenida italia", geom: "40:50" },
      ]);

      const result = await analysis();

      expect(result.renamedStreets).toEqual([
        { idcalle: "77", currentNames: "NOMBRE VIEJO", newName: ITALIA, names: [ITALIA], sections: 3, ways: 1, multiName: false },
      ]);
      expect(result.counts.renamedStreetsHeld).toBe(0);
    });

    it("should list a street whose copies name it two ways as multiName, with every file name in names", async () => {
      await insertWay(database, STREET, "NOMBRE VIEJO");
      await insertStaging(database, [
        { ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" },
        { ref: "1002", calle: "77", nombre: CALLE_NUEVA, geom: "20:30" },
      ]);

      const result = await analysis();

      expect(result.renamedStreets).toEqual([
        { idcalle: "77", currentNames: "NOMBRE VIEJO", newName: ITALIA, names: [ITALIA, CALLE_NUEVA], sections: 2, ways: 1, multiName: true },
      ]);
      expect(result.counts.renamedStreets).toBe(1);
      expect(result.counts.renamedStreetsHeld).toBe(1);
    });
  });

  describe("a multi-name street accepted with a chosen name (EJL-31)", () => {
    const seedTwoNames = async (): Promise<number[]> => {
      const first = await insertWay(database, STREET, "NOMBRE VIEJO A");
      const second = await insertWay(database, STREET, "NOMBRE VIEJO B");
      await insertStaging(database, [
        { ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" },
        { ref: "1002", calle: "77", nombre: CALLE_NUEVA, geom: "20:30" },
      ]);
      return [first, second];
    };

    it("should apply the chosen name, not the first file name, to every way row of the street with its short name", async () => {
      const [first, second] = await seedTwoNames();

      const outcome = await persist([{ idcalle: String(STREET), name: CALLE_NUEVA }]);

      expect(outcome.load.counts).toMatchObject({ waysRenamed: 2 });
      const renamed = (await waysOf()).filter((way) => way.id === first || way.id === second);
      expect(renamed).toEqual([
        { id: first, id_calle: STREET, name: CALLE_NUEVA, short_name: "CL NUEVA" },
        { id: second, id_calle: STREET, name: CALLE_NUEVA, short_name: "CL NUEVA" },
      ]);
    });

    it("should restore the old names of every way row of the street when the revert SQL is applied", async () => {
      await seedTwoNames();
      const before = await waysOf();
      const outcome = await persist([{ idcalle: String(STREET), name: CALLE_NUEVA }]);

      await database.exec(await readBackup(outcome));

      expect(await waysOf()).toEqual(before);
    });

    it("should fail closed with the Spanish choice message and write nothing when a multi-name street is accepted without a name", async () => {
      await seedTwoNames();
      const before = await snapshotOf(database);

      await expect(persist([{ idcalle: String(STREET) }])).rejects.toThrow("Elija el nombre de la calle 77 entre los del archivo.");

      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should fail closed with the analysis-changed message and write nothing when the chosen name is not one of the file's names", async () => {
      await seedTwoNames();
      const before = await snapshotOf(database);

      await expect(persist([{ idcalle: String(STREET), name: "CALLE INVENTADA" }])).rejects.toThrow(ANALYSIS_CHANGED);

      expect(await snapshotOf(database)).toEqual(before);
    });
  });

  describe("a single-name street with an optional name (EJL-31)", () => {
    it("should apply the one file name when the name given equals it", async () => {
      const way = await insertWay(database, STREET, "NOMBRE VIEJO");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" }]);

      const outcome = await persist([{ idcalle: String(STREET), name: ITALIA }]);

      expect(outcome.load.counts).toMatchObject({ waysCreated: 0, waysRenamed: 1 });
      expect(await waysOf()).toEqual([{ id: way, id_calle: STREET, name: ITALIA, short_name: "AV ITALIA" }]);
    });

    it("should fail closed with the analysis-changed message and write nothing when the name given differs from the one file name", async () => {
      await insertWay(database, STREET, "NOMBRE VIEJO");
      await insertStaging(database, [{ ref: "1001", calle: "77", nombre: ITALIA, geom: "0:10" }]);
      const before = await snapshotOf(database);

      await expect(persist([{ idcalle: String(STREET), name: CALLE_NUEVA }])).rejects.toThrow(ANALYSIS_CHANGED);

      expect(await snapshotOf(database)).toEqual(before);
    });
  });
});
