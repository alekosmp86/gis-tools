import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discardRevertBackup, getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
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
  summaryOn,
  zeroLoadCounts,
  type FailRule,
  type Row,
  type SqlLog,
} from "./ejesLoadHarness";
import { ejesLayouts } from "./ejesFixtures";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;
const timer = () => createStepTimer({ now: () => 0, total: 20 });

type RevertRegistry = Map<string, { filePath: string }>;

const registeredFiles = (): string[] => {
  const registry = (globalThis as Record<string, unknown>).__gisToolsRevertBackups as RevertRegistry | undefined;
  return Array.from(registry?.values() ?? []).map((entry) => entry.filePath);
};

describe("ejes load rules on PGlite (EJL-12, EJL-14, EJL-17, EJL-18, EJL-19, EJL-20, EJL-21, EJL-23)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-rules-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const persist = async (log: SqlLog = [], failOn?: FailRule): Promise<EjesPersistOutcome> => {
    const summary = await summaryOn(database);
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(sessionOn(database, log, failOn), paramsWith(summary), context, timer());
  };

  const backupFiles = async (): Promise<string[]> => {
    const folder = path.join(directory, "gis-tools-routine-jobs");
    return (await readdir(folder).catch((): string[] => [])).filter((name) => name.endsWith(".sql.gz"));
  };

  const sectionsByRef = async (ref: number): Promise<Row[]> =>
    rowsOf(database, `SELECT * FROM carto.road_section WHERE reftramo_ideuy = ${ref} ORDER BY id`);

  const ways = async (): Promise<Row[]> => rowsOf(database, "SELECT id, name, id_calle FROM carto.circulation_way ORDER BY id");

  describe("held renumber pairs (EJL-12)", () => {
    const seedTwoCopies = async (): Promise<number> => {
      await insertWay(database, 5, "CALLE UNO");
      const old = await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertPoints(database, "3001", 2);
      await insertStaging(database, [
        { ref: "3002", calle: "5", nombre: "CALLE UNO", localidad: "TRINIDAD", departamento: "FLORES", geom: "1000:1100" },
        { ref: "3002", calle: "5", nombre: "CALLE UNO", localidad: "TRINIDAD", departamento: "SAN JOSE", geom: "1000:1100" },
      ]);
      return old;
    };

    it("should leave the old section untouched, insert no copy of the new reftramo, and report one skipped renumber with both refs", async () => {
      const old = await seedTwoCopies();
      const before = await snapshotOf(database);

      const outcome = await persist();

      expect(await sectionsByRef(3001)).toEqual(before["carto.road_section"].filter((row) => row.id === old));
      expect(await sectionsByRef(3002)).toEqual([]);
      expect(await snapshotOf(database)).toEqual(before);
      expect(outcome.load.skipped).toEqual([
        { kind: "renumber", refs: ["3001"], newRefs: ["3002"], idcalle: "5", points: 2, reason: "not_single_copy" },
      ]);
    });

    it("should count the held sections neither as removed nor as new, and report the held pair in the analysis", async () => {
      await seedTwoCopies();

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.counts).toMatchObject({ removed: 0, newSections: 0, renumbered: 0, renumberSkipped: 1, plainRemovals: 0 });
      expect(analysis.renumberSkipped).toEqual([
        { oldRef: "3001", newRef: "3002", idcalle: "5", points: 2, reason: "not_single_copy" },
      ]);
    });

    it("should not create a way for the held copies, and change nothing on a second run (EJL-14)", async () => {
      await seedTwoCopies();
      const waysBefore = await ways();
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      await persist();
      const afterFirst = await snapshotOf(database);
      vi.setSystemTime(new Date("2026-01-01T10:05:00Z"));

      const second = await persist();

      expect(await ways()).toEqual(waysBefore);
      expect(await snapshotOf(database)).toEqual(afterFirst);
      expect(second.load.counts).toEqual(zeroLoadCounts({ renumberSkipped: 1 }));
      expect(second.load.skipped).toHaveLength(1);
    });

    it("should report the load's held count equal to the analysis renumberSkipped of the same staging (EJL-13)", async () => {
      await seedTwoCopies();
      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      const outcome = await persist();

      expect(analysis.counts.renumberSkipped).toBe(1);
      expect(outcome.load.counts.renumberSkipped).toBe(analysis.counts.renumberSkipped);
      expect(outcome.load.counts.renumberSkipped).toBe(outcome.analysis.counts.renumberSkipped);
      expect(outcome.load.counts.renumberSkipped).toBe(outcome.load.skipped.filter((row) => row.kind === "renumber").length);
    });

    it("should count each distinct held pair once in the load, as the analysis does, when two candidates share the pair", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);
      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      const outcome = await persist();

      expect(outcome.load.counts.renumberSkipped).toBe(1);
      expect(outcome.load.counts.renumberSkipped).toBe(analysis.counts.renumberSkipped);
      expect(outcome.load.counts.renumberSkipped).toBe(outcome.analysis.counts.renumberSkipped);
    });

    it("should report zero held renumbers in the load when no renumber is held back", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);

      const outcome = await persist();

      expect(outcome.load.counts.renumbered).toBe(1);
      expect(outcome.load.counts.renumberSkipped).toBe(0);
      expect(outcome.analysis.counts.renumberSkipped).toBe(0);
    });

    it("should hold a pair whose old reftramo names two rows as repeated_old_ref, both sections untouched", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);
      const before = await snapshotOf(database);

      const outcome = await persist();

      expect(await snapshotOf(database)).toEqual(before);
      expect(outcome.load.counts.renumbered).toBe(0);
      expect(outcome.load.skipped.map((row) => row.reason)).toEqual(["repeated_old_ref"]);
    });

    it("should list one held row per distinct (old, new) pair when an old reftramo names two rows, and count the same pairs in the load (EJL-12, EJL-13)", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);

      const outcome = await persist();

      expect(outcome.analysis.renumberSkipped).toEqual([{ oldRef: "3001", newRef: "3002", idcalle: "5", points: 0, reason: "repeated_old_ref" }]);
      expect(outcome.load.skipped.filter((row) => row.kind === "renumber")).toEqual([
        { kind: "renumber", refs: ["3001"], newRefs: ["3002"], idcalle: "5", points: 0, reason: "repeated_old_ref" },
      ]);
      expect(outcome.load.counts.renumberSkipped).toBe(outcome.analysis.renumberSkipped.length);
    });

    it("should list one held row per distinct pair when one repeated old reftramo meets two new reftramos, and count two pairs in the analysis and the load (EJL-12, EJL-13)", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertStaging(database, [
        { ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000.4:1100" },
        { ref: "3003", calle: "5", nombre: "CALLE UNO", localidad: "SAN JOSE", geom: "999.6:1100" },
      ]);
      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      const outcome = await persist();

      expect(analysis.counts.renumberSkipped).toBe(2);
      expect(analysis.renumberSkipped.map((row) => [row.oldRef, row.newRef])).toEqual([
        ["3001", "3002"],
        ["3001", "3003"],
      ]);
      expect(outcome.load.counts.renumberSkipped).toBe(analysis.counts.renumberSkipped);
      expect(outcome.load.skipped.filter((row) => row.kind === "renumber")).toHaveLength(2);
    });
  });

  describe("renumber uniqueness (EJL-17)", () => {
    it("should renumber the unique pair and hold the other pair, and the analysis count equals the load count", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertPoints(database, "3001", 2);
      await insertSection(database, { ref: 4001, calle: 5, geom: "2000:2100", distance: "100.00" });
      await insertStaging(database, [
        { ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" },
        { ref: "4002", calle: "5", nombre: "CALLE UNO", localidad: "TRINIDAD", departamento: "FLORES", geom: "2000:2100" },
        { ref: "4002", calle: "5", nombre: "CALLE UNO", localidad: "TRINIDAD", departamento: "SAN JOSE", geom: "2000:2100" },
      ]);
      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      const outcome = await persist();

      expect(outcome.load.counts.renumbered).toBe(analysis.counts.renumbered);
      expect(outcome.load.renumbered.map((row) => [row.oldRef, row.newRef])).toEqual(analysis.renumbered.map((row) => [row.oldRef, row.newRef]));
      expect(outcome.load.renumbered.map((row) => [row.oldRef, row.newRef])).toEqual([["3001", "3002"]]);
      expect(outcome.load.skipped.map((row) => [row.refs.join("/"), row.newRefs.join("/"), row.reason])).toEqual([["4001", "4002", "not_single_copy"]]);
      expect(await sectionsByRef(4001)).toHaveLength(1);
      expect(await sectionsByRef(4002)).toEqual([]);
    });

    it("should refuse both candidates of an old reftramo named twice as held, and write no renumber", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());
      const outcome = await persist();

      expect(analysis.counts.renumberSkipped).toBe(1);
      expect(outcome.load.counts.renumbered).toBe(0);
      expect(await rowsOf(database, "SELECT count(*)::int AS n FROM carto.road_section WHERE reftramo_ideuy = 3001")).toEqual([{ n: 2 }]);
    });
  });

  describe("sections without reftramo (EJL-26)", () => {
    const sectionRowsOf = (snapshot: Record<string, Row[]>, ids: number[]): Row[] =>
      snapshot["carto.road_section"].filter((row) => ids.includes(row.id as number));

    it("should neither renumber nor hold a NULL-reftramo section that matches a new section, and keep it a plain removal", async () => {
      await insertWay(database, 5, "CALLE UNO");
      const nullSection = await insertSection(database, { ref: null, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);
      const before = await snapshotOf(database);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());
      const outcome = await persist();

      expect(analysis.counts).toMatchObject({ renumbered: 0, renumberSkipped: 0, removed: 1, plainRemovals: 1, newSections: 1 });
      expect(analysis.renumberSkipped).toEqual([]);
      expect(analysis.plainRemovals).toMatchObject([{ points: 0 }]);
      expect(outcome.load.counts).toMatchObject({ renumbered: 0, renumberSkipped: 0, inserted: 1 });
      expect(outcome.load.skipped.filter((row) => row.kind === "renumber")).toEqual([]);
      expect(sectionRowsOf(await snapshotOf(database), [nullSection])).toEqual(sectionRowsOf(before, [nullSection]));
      expect(await sectionsByRef(3002)).toHaveLength(1);
    });

    it("should never report a repeated NULL-reftramo group as repeated_old_ref, and leave both sections untouched", async () => {
      await insertWay(database, 5, "CALLE UNO");
      const first = await insertSection(database, { ref: null, calle: 5, geom: "1000:1100", distance: "100.00" });
      const second = await insertSection(database, { ref: null, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);
      const before = await snapshotOf(database);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());
      const outcome = await persist();

      expect(analysis.counts).toMatchObject({ renumbered: 0, renumberSkipped: 0, removed: 2 });
      expect(analysis.renumberSkipped).toEqual([]);
      expect(outcome.load.counts).toMatchObject({ renumbered: 0, renumberSkipped: 0 });
      expect(outcome.load.skipped.filter((row) => row.kind === "renumber")).toEqual([]);
      expect(sectionRowsOf(await snapshotOf(database), [first, second])).toEqual(sectionRowsOf(before, [first, second]));
    });
  });

  describe("moved sections get their way (EJL-18)", () => {
    it("should create the way of a section moved to a brand-new idcalle and point the section at it", async () => {
      await insertWay(database, 5, "CALLE UNO");
      const id = await insertSection(database, { ref: 2001, calle: 5, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [{ ref: "2001", calle: "77", nombre: "CALLE NUEVA", geom: "0:50" }]);

      const outcome = await persist();

      expect(outcome.load.counts).toMatchObject({ updated: 1, inserted: 0, waysCreated: 1 });
      expect((await sectionsByRef(2001))[0]).toMatchObject({ id, id_circulation_way: 77 });
      expect(await ways()).toMatchObject([
        { id_calle: 5, name: "CALLE UNO" },
        { id_calle: 77, name: "CALLE NUEVA" },
      ]);
    });

    it("should move a section to an existing (idcalle, name) pair without creating a way", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertWay(database, 77, "CALLE NUEVA");
      await insertSection(database, { ref: 2001, calle: 5, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [{ ref: "2001", calle: "77", nombre: "CALLE NUEVA", geom: "0:50" }]);

      const outcome = await persist();

      expect(outcome.load.counts).toMatchObject({ updated: 1, waysCreated: 0 });
      expect((await sectionsByRef(2001))[0]).toMatchObject({ id_circulation_way: 77 });
      expect(await ways()).toHaveLength(2);
    });
  });

  describe("reference normalisation (EJL-19)", () => {
    it("should pair a staging reftramo with leading zeros with its section and write nothing on a second run", async () => {
      await insertStaging(database, [{ ref: "0012", calle: "077", nombre: "CALLE A", geom: "0:10" }]);

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T10:00:00Z"));
      const first = await persist();
      const afterFirst = await snapshotOf(database);
      vi.setSystemTime(new Date("2026-01-01T10:05:00Z"));
      const second = await persist();

      expect(first.load.counts).toMatchObject({ inserted: 1, waysCreated: 1 });
      expect((await sectionsByRef(12))[0]).toMatchObject({ reftramo_ideuy: 12, id_circulation_way: 77 });
      expect(second.load.counts).toEqual(zeroLoadCounts());
      expect(await snapshotOf(database)).toEqual(afterFirst);
    });

    it("should read the existing section as 12 when its staging row has '0012', so a re-run over the same data is a no-op", async () => {
      await insertWay(database, 77, "CALLE A");
      await insertSection(database, { ref: 12, calle: 77, geom: "0:10", distance: "10.00" });
      await insertStaging(database, [{ ref: "0012", calle: "077", nombre: "CALLE A", geom: "0:10" }]);
      const before = await snapshotOf(database);

      const outcome = await persist();

      expect(outcome.load.counts).toEqual(zeroLoadCounts());
      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should move the access points stored with leading zeros together with their section", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 12, calle: 5, geom: "1000:1100", distance: "100.00" });
      await database.query("INSERT INTO carto.access_point (id_road_section) VALUES ('0012'), ('12')");
      await insertStaging(database, [{ ref: "13", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);

      const outcome = await persist();

      expect(outcome.load.counts).toMatchObject({ renumbered: 1, pointsMoved: 2 });
      expect(await rowsOf(database, "SELECT id_road_section FROM carto.access_point ORDER BY id")).toEqual([
        { id_road_section: "13" },
        { id_road_section: "13" },
      ]);
    });

    it("should group the rows '007' and '7' as one twin group, so the rural copy next to urban padrones is dropped (EJL-19)", async () => {
      await insertWay(database, 10, "CALLE UNO");
      await insertSection(database, { ref: 7, calle: 10, geom: "0:50", distance: "50.00" });
      await insertPadron(database, "URBANO", "0:50");
      await insertStaging(database, [
        { ref: "007", calle: "10", nombre: "CALLE UNO", localidad: "TRINIDAD", geom: "0:50" },
        { ref: "7", calle: "10", nombre: "CALLE UNO", localidad: "FLORES RURAL", geom: "0:50" },
      ]);

      const outcome = await persist();

      expect(outcome.load.counts).toMatchObject({ inserted: 0, updated: 0 });
      expect(await sectionsByRef(7)).toHaveLength(1);
    });

    it("should count the access points stored with leading zeros in the surplus points of their section (EJL-19)", async () => {
      await insertWay(database, 10, "CALLE UNO");
      await insertSection(database, { ref: 7, calle: 10, geom: "0:50", distance: "50.00" });
      const surplus = await insertSection(database, { ref: 7, calle: 10, geom: "0:50", distance: "50.00" });
      await database.query("INSERT INTO carto.access_point (id_road_section) VALUES ('007'), ('7'), ('0007')");
      await insertStaging(database, [{ ref: "7", calle: "10", nombre: "CALLE UNO", geom: "0:50" }]);

      const outcome = await persist();

      expect(outcome.load.surplus).toEqual([{ ref: "7", id: String(surplus), points: 3 }]);
      expect(outcome.load.surplusTotal).toBe(1);
    });

    it("should pick the staging row with the smallest full content when a reftramo repeats, whatever the insertion order (EJL-19)", async () => {
      await insertStaging(database, [
        { ref: "0100", calle: "9", nombre: "ZETA", geom: "0:10" },
        { ref: "100", calle: "9", nombre: "ALFA", geom: "0:10" },
      ]);

      const outcome = await persist();

      expect(outcome.load.counts.inserted).toBe(1);
      expect((await sectionsByRef(100))).toHaveLength(1);
      expect(await ways()).toMatchObject([{ id_calle: 9, name: "ALFA" }]);
    });
  });

  describe("staging fingerprint (EJL-20)", () => {
    const seedOne = async (): Promise<void> => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 2001, calle: 5, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [{ ref: "2001", calle: "5", nombre: "CALLE UNO", geom: "0:50" }]);
    };

    it("should give the dry-run analysis the staging row count and a digest that changes with the content", async () => {
      await seedOne();
      const before = (await readAnalysis(sessionOn(database), ejesLayouts())).fingerprint;

      await database.query("UPDATE bdj_carto.ide_ejesviacirculacion SET geom = '0:50.0004'");
      const after = (await readAnalysis(sessionOn(database), ejesLayouts())).fingerprint;

      expect(before.rows).toBe(1);
      expect(before.digest).toMatch(/^[0-9a-f]{32}$/);
      expect(after.rows).toBe(1);
      expect(after.digest).not.toBe(before.digest);
    });

    it("should abort before the backup when only a geometry digest changed with identical counts", async () => {
      await seedOne();
      const summary = await summaryOn(database);
      await database.query("UPDATE bdj_carto.ide_ejesviacirculacion SET geom = '0:50.0004'");
      const before = await snapshotOf(database);

      await expect(runEjesPersistTransaction(sessionOn(database), paramsWith(summary), await loadContextOn(database), timer())).rejects.toThrow(
        /vuelva a analizar/
      );

      expect(await backupFiles()).toEqual([]);
      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should abort before the backup when only an attribute changed with identical counts", async () => {
      await seedOne();
      const summary = await summaryOn(database);
      await database.query("UPDATE bdj_carto.ide_ejesviacirculacion SET nombre = 'CALLE UNO '");

      await expect(runEjesPersistTransaction(sessionOn(database), paramsWith(summary), await loadContextOn(database), timer())).rejects.toThrow(
        /vuelva a analizar/
      );

      expect(await backupFiles()).toEqual([]);
    });

    it("should abort when the row count changed with identical counts", async () => {
      await seedOne();
      const summary = await summaryOn(database);
      await insertStaging(database, [{ ref: "2001", calle: "5", nombre: "CALLE UNO", geom: "0:50" }]);

      await expect(runEjesPersistTransaction(sessionOn(database), paramsWith(summary), await loadContextOn(database), timer())).rejects.toThrow(
        /vuelva a analizar/
      );
    });
  });

  describe("revert file cleanup (EJL-21)", () => {
    const seedChange = async (): Promise<void> => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 2001, calle: 5, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [{ ref: "2001", calle: "5", nombre: "CALLE UNO", tipo: "PASAJE", geom: "0:50" }]);
    };

    it("should leave no revert file registered when a write fails after the backup", async () => {
      await seedChange();
      await expect(persist([], (sql) => /^WITH "written" AS \(UPDATE/.test(sql))).rejects.toThrow(/No se pudo completar/);

      expect(await backupFiles()).toEqual([]);
      expect(registeredFiles().filter((filePath) => filePath.startsWith(directory))).toEqual([]);
    });

    it("should leave no revert file when the ANALYZE of a changed table fails", async () => {
      await seedChange();

      await expect(persist([], (sql) => /^ANALYZE "carto"/.test(sql))).rejects.toThrow(/No se pudo completar/);

      expect(await backupFiles()).toEqual([]);
    });

    it("should keep the revert file and its registration when COMMIT fails, because the outcome is unknown", async () => {
      await seedChange();

      const outcome = await persist([], "COMMIT");
      const token = outcome.load.backup?.token ?? "";

      expect(outcome.outcomeUnknown).toBe(true);
      expect(getRevertBackup(token)).toBeDefined();
      expect(await backupFiles()).toHaveLength(1);
    });

    it("should delete the file and unregister it when the backup is discarded", async () => {
      await seedChange();
      const outcome = await persist();
      const token = outcome.load.backup?.token ?? "";
      expect(await backupFiles()).toHaveLength(1);

      await discardRevertBackup(token);

      expect(getRevertBackup(token)).toBeUndefined();
      expect(await backupFiles()).toEqual([]);
    });
  });

  describe("selection of the classified rows (EJL-23)", () => {
    it("should classify once: the renumber sink and the load agree on the same pairs, with no second classification in the load log", async () => {
      await insertWay(database, 5, "CALLE UNO");
      await insertSection(database, { ref: 3001, calle: 5, geom: "1000:1100", distance: "100.00" });
      await insertStaging(database, [{ ref: "3002", calle: "5", nombre: "CALLE UNO", geom: "1000:1100" }]);
      const log: SqlLog = [];

      await persist(log);

      const classifications = log.filter((sql) => /"stg" AS \(/.test(sql));
      expect(classifications).toHaveLength(1);
      expect(log.filter((sql) => /INSERT INTO pg_temp\."ej_renum"/.test(sql))).toHaveLength(1);
    });
  });
});
