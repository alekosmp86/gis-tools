import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { buildAcceptedTablesSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/acceptedSql";
import { buildCreateGeoTwinTableSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/geoTwinSql";
import { summaryOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadMapping";
import { buildCopyTableSql, LOAD_TEMP } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadSelectionSql";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import { ANALYSIS_CHANGED_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeStatements";
import type { EjesAccepted, EjesSummary, EjesTwinPick } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesLayouts } from "./ejesFixtures";
import {
  createEjesDatabase,
  insertPadron,
  insertPoints,
  insertSection,
  insertStaging,
  insertWay,
  loadContextOn,
  paramsWith,
  rowsOf,
  sessionOn,
  snapshotOf,
  type Row,
  type SqlLog,
} from "./ejesLoadHarness";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;
const timer = () => createStepTimer({ now: () => 0, total: 20 });
const NO_PICKS: EjesAccepted = { splits: [], plainRemovals: [], merges: [], twinRemovals: [], twinPicks: [] };
const WRITE_SQL = /^WITH "written"|^(INSERT INTO|UPDATE|DELETE FROM) "?carto/;
const INVALID_PICK_MESSAGE = /no existe en el origen con esa localidad y departamento\. Vuelva a analizar\./;

const withPicks = (twinPicks: EjesTwinPick[]): EjesAccepted => ({ ...NO_PICKS, twinPicks });

const pickOf = (ref: string, department: string, locality: string): EjesTwinPick => ({ ref, department, locality });

const CROSS_PICK = pickOf("3002", "SORIANO", "MERCEDES");

describe("manual twin copy picks on PGlite (ET-28 to ET-33)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "true");
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-twin-picks-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const backupFiles = async (): Promise<string[]> => {
    const folder = path.join(directory, "gis-tools-routine-jobs");
    return (await readdir(folder).catch((): string[] => [])).filter((name) => name.endsWith(".sql.gz"));
  };

  const sectionsByRef = async (ref: number): Promise<Row[]> =>
    rowsOf(database, `SELECT * FROM carto.road_section WHERE reftramo_ideuy = ${ref} ORDER BY id`);

  /** Two copies of reftramo 3002 in two departments, and the old section 3001 with two points that the renumber would move. */
  const seedCrossDepartmentPair = async (): Promise<number> => {
    await insertWay(database, 5, "CALLE UNO");
    const old = await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
    await insertPoints(database, "3001", 2);
    await insertStaging(database, [
      { ref: "3002", calle: "5", nombre: "CALLE UNO", departamento: "FLORES", localidad: "TRINIDAD", geom: "1000:1100" },
      { ref: "3002", calle: "5", nombre: "CALLE UNO", departamento: "SORIANO", localidad: "MERCEDES", geom: "1000:1100" },
    ]);
    return old;
  };

  /** Copies of one reftramo in one department, each locality with its own copy, next to an urban padron (the URBAN class). */
  const seedUrbanTwin = async (ref: string, localities: string[]): Promise<void> => {
    await insertWay(database, 7, "CALLE SIETE");
    await insertPadron(database, "URBANO", "0:50");
    await insertStaging(
      database,
      localities.map((localidad) => ({ ref, calle: "7", nombre: "CALLE SIETE", departamento: "FLORES", localidad, geom: "0:50" }))
    );
  };

  const analysisWith = (twinPicks: EjesTwinPick[] = []) => readAnalysis(sessionOn(database), ejesLayouts(), twinPicks);

  const summaryWith = async (twinPicks: EjesTwinPick[] = []): Promise<EjesSummary> => summaryOf(await analysisWith(twinPicks));

  const runLoad = async (accepted: EjesAccepted, summary: EjesSummary, log: SqlLog = []): Promise<EjesPersistOutcome> => {
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(sessionOn(database, log), { ...paramsWith(summary), accepted }, context, timer());
  };

  const persistWith = async (twinPicks: EjesTwinPick[], log: SqlLog = []): Promise<EjesPersistOutcome> =>
    runLoad(withPicks(twinPicks), await summaryWith(twinPicks), log);

  /** The kept copies of one reftramo as the copy table of the load holds them, the analysis transaction's temp tables included. */
  const keptCopiesOf = async (twinPicks: EjesTwinPick[], ref: string): Promise<Array<{ localidad: string | null; departamento: string | null }>> => {
    await database.exec("BEGIN");
    for (const sql of [...buildAcceptedTablesSql(withPicks(twinPicks)), buildCreateGeoTwinTableSql(LOAD_TEMP.GEO_TWIN), buildCopyTableSql(ejesLayouts())]) {
      await database.exec(sql);
    }
    const rows = await rowsOf<{ localidad: string | null; departamento: string | null }>(
      database,
      `SELECT localidad, departamento FROM pg_temp."${LOAD_TEMP.COPY}" WHERE ref = '${ref}'`
    );
    await database.exec("ROLLBACK");
    return rows.sort((first, second) => String(first.localidad).localeCompare(String(second.localidad)));
  };

  describe("the copy rule keeps the picked copy (ET-28)", () => {
    it("should keep the locality rule's copy of an urban twin when no pick names its reftramo", async () => {
      await seedUrbanTwin("8001", ["TRINIDAD", "FLORES RURAL"]);

      expect(await keptCopiesOf([], "8001")).toEqual([{ localidad: "TRINIDAD", departamento: "FLORES" }]);
    });

    it("should keep the locality rule's copy when the pick names no copy of its reftramo, as if no pick were made", async () => {
      await seedUrbanTwin("8001", ["TRINIDAD", "FLORES RURAL"]);

      expect(await keptCopiesOf([pickOf("8001", "FLORES", "NO EXISTE")], "8001")).toEqual([{ localidad: "TRINIDAD", departamento: "FLORES" }]);
    });

    it("should keep the same copies as with no pick when the pick names a locality of the reftramo in another department", async () => {
      await seedUrbanTwin("8002", ["TRINIDAD", "SAN JOSE", "FLORES RURAL"]);

      expect(await keptCopiesOf([pickOf("8002", "SORIANO", "SAN JOSE")], "8002")).toEqual(await keptCopiesOf([], "8002"));
      expect(await keptCopiesOf([], "8002")).toEqual([
        { localidad: "SAN JOSE", departamento: "FLORES" },
        { localidad: "TRINIDAD", departamento: "FLORES" },
      ]);
    });

    it("should keep the picked copy over the locality rule and drop the other copy of its reftramo", async () => {
      await seedUrbanTwin("8001", ["TRINIDAD", "FLORES RURAL"]);

      expect(await keptCopiesOf([pickOf("8001", "FLORES", "FLORES RURAL")], "8001")).toEqual([
        { localidad: "FLORES RURAL", departamento: "FLORES" },
      ]);
    });

    it("should keep only the picked one of three copies of a reftramo", async () => {
      await seedUrbanTwin("8002", ["TRINIDAD", "SAN JOSE", "FLORES RURAL"]);

      expect(await keptCopiesOf([pickOf("8002", "FLORES", "SAN JOSE")], "8002")).toEqual([{ localidad: "SAN JOSE", departamento: "FLORES" }]);
    });

    it("should keep both copies of a reftramo in two departments when no pick names one of them", async () => {
      await seedCrossDepartmentPair();

      expect(await keptCopiesOf([], "3002")).toEqual([
        { localidad: "MERCEDES", departamento: "SORIANO" },
        { localidad: "TRINIDAD", departamento: "FLORES" },
      ]);
    });

    it("should keep one copy of a reftramo in two departments once a pick names one of them", async () => {
      await seedCrossDepartmentPair();

      expect(await keptCopiesOf([CROSS_PICK], "3002")).toEqual([{ localidad: "MERCEDES", departamento: "SORIANO" }]);
    });
  });

  describe("the analysis lists the copies still undecided (ET-29, ET-30)", () => {
    it("should list a reftramo with copies in two departments as undecided, with its copies and the held renumber waiting for it", async () => {
      await seedCrossDepartmentPair();

      const analysis = await analysisWith();

      expect(analysis.twinUndecided).toEqual([
        {
          ref: "3002",
          idcalle: "5",
          name: "CALLE UNO",
          copies: [
            { department: "FLORES", locality: "TRINIDAD" },
            { department: "SORIANO", locality: "MERCEDES" },
          ],
          points: 0,
          waiting: 1,
        },
      ]);
      expect(analysis.counts).toMatchObject({ twinsUndecided: 1, twinPicksApplied: 0, renumberSkipped: 1, renumbered: 0 });
    });

    it("should drop the reftramo from the undecided list and let the renumber through once a pick keeps one copy", async () => {
      await seedCrossDepartmentPair();

      const analysis = await analysisWith([CROSS_PICK]);

      expect(analysis.twinUndecided).toEqual([]);
      expect(analysis.counts).toMatchObject({ twinsUndecided: 0, twinPicksApplied: 1, renumbered: 1, renumberSkipped: 0 });
      expect(analysis.renumbered.map((row) => [row.oldRef, row.newRef])).toEqual([["3001", "3002"]]);
      expect(analysis.renumberSkipped).toEqual([]);
    });

    it("should not count a pick that names no copy of the staging as applied, and keep the reftramo undecided", async () => {
      await seedCrossDepartmentPair();

      const analysis = await analysisWith([pickOf("3002", "NO EXISTE", "NINGUNA")]);

      expect(analysis.counts).toMatchObject({ twinPicksApplied: 0, twinsUndecided: 1 });
      expect(analysis.twinUndecided.map((row) => row.ref)).toEqual(["3002"]);
    });

    it("should count the applied picks in the summary, so a summary taken without them differs", async () => {
      await seedCrossDepartmentPair();

      const without = await summaryWith();
      const withPick = await summaryWith([CROSS_PICK]);

      expect(without.counts.twinPicksApplied).toBe(0);
      expect(withPick.counts.twinPicksApplied).toBe(1);
      expect(withPick.counts.renumbered).not.toBe(without.counts.renumbered);
    });
  });

  describe("the load applies the picks (ET-28, ET-31, ET-32)", () => {
    it("should renumber the old section onto the picked reftramo and hold nothing, when a pick keeps one copy of the pair", async () => {
      const old = await seedCrossDepartmentPair();

      const outcome = await persistWith([CROSS_PICK]);

      expect(outcome.load.counts).toMatchObject({ renumbered: 1 });
      expect(outcome.load.skipped).toEqual([]);
      expect(await sectionsByRef(3001)).toEqual([]);
      expect((await sectionsByRef(3002)).map((row) => Number(row.id))).toEqual([old]);
    });

    it("should hold the same pair and leave the old section where it is, when no pick names a copy", async () => {
      const old = await seedCrossDepartmentPair();
      const before = await snapshotOf(database);

      const outcome = await persistWith([]);

      expect(await snapshotOf(database)).toEqual(before);
      expect((await sectionsByRef(3001)).map((row) => Number(row.id))).toEqual([old]);
      expect(outcome.load.skipped.map((row) => row.reason)).toEqual(["not_single_copy"]);
    });

    it("should abort before any write when a pick names no copy of the staging, with the Spanish message and its reftramo", async () => {
      await seedCrossDepartmentPair();
      const before = await snapshotOf(database);
      const log: SqlLog = [];
      const invalid = [pickOf("3002", "FLORES", "NO EXISTE")];

      await expect(runLoad(withPicks(invalid), await summaryWith(invalid), log)).rejects.toThrow(INVALID_PICK_MESSAGE);
      await expect(runLoad(withPicks(invalid), await summaryWith(invalid), log)).rejects.toThrow("Tramos: 3002.");

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
      expect(log.filter((sql) => WRITE_SQL.test(sql))).toEqual([]);
    });

    it("should name only the picks that name no copy in the abort message, and not the valid ones", async () => {
      await seedCrossDepartmentPair();
      const mixed = [CROSS_PICK, pickOf("9999", "FLORES", "NO EXISTE")];

      const failure = await runLoad(withPicks(mixed), await summaryWith(mixed)).catch((error: unknown) => error as Error);

      expect((failure as Error).message).toContain("Tramos: 9999.");
      expect((failure as Error).message).not.toContain("3002");
    });

    it("should refuse a real run whose summary was taken without the picks as stale, writing nothing", async () => {
      await seedCrossDepartmentPair();
      const before = await snapshotOf(database);
      const staleSummary = await summaryWith();

      await expect(runLoad(withPicks([CROSS_PICK]), staleSummary)).rejects.toThrow(ANALYSIS_CHANGED_MESSAGE);

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
    });

    it("should refuse a real run whose picks differ from the ones the summary was taken with, writing nothing", async () => {
      await seedCrossDepartmentPair();
      const before = await snapshotOf(database);
      const pickSummary = await summaryWith([CROSS_PICK]);

      await expect(runLoad(withPicks([]), pickSummary)).rejects.toThrow(ANALYSIS_CHANGED_MESSAGE);

      expect(await snapshotOf(database)).toEqual(before);
    });
  });
});
