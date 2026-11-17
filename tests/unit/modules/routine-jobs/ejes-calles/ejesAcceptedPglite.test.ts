import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { EJES_SKIP_KIND, EJES_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import type { EjesAccepted } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { ejesLayouts } from "./ejesFixtures";
import {
  createEjesDatabase,
  insertPoints,
  insertSection,
  insertStaging,
  insertWay,
  loadContextOn,
  paramsWith,
  PASSWORD,
  rowsOf,
  sessionOn,
  snapshotOf,
  summaryOn,
  zeroLoadCounts,
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
const NO_ACCEPTED: EjesAccepted = { splits: [], plainRemovals: [], merges: [] };
const ANALYSIS_CHANGED = /vuelva a analizar/;

describe("ejes accepted removals, merges and held groups on PGlite (EJS-4, EJS-9, EJS-10, EJS-11, EJL-12, EJL-13, EJL-14, EJ-19, EJ-21)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "true");
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-accepted-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const persist = async (accepted: EjesAccepted = NO_ACCEPTED, log: SqlLog = [], failOn?: (sql: string) => boolean): Promise<EjesPersistOutcome> => {
    const summary = await summaryOn(database);
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(
      sessionOn(database, log, failOn),
      { ...paramsWith(summary), accepted },
      context,
      timer()
    );
  };

  const readBackup = async (outcome: EjesPersistOutcome): Promise<string> => {
    const entry = getRevertBackup(outcome.load.backup?.token ?? "");
    expect(entry).toBeDefined();
    return gunzipSync(await readFile(entry?.filePath ?? "")).toString("utf8");
  };

  const sectionsByRef = async (ref: number): Promise<Row[]> =>
    rowsOf(database, `SELECT * FROM carto.road_section WHERE reftramo_ideuy = ${ref} ORDER BY id`);

  const pointsOn = async (ref: string): Promise<number> =>
    Number((await rowsOf(database, `SELECT count(*)::int AS n FROM carto.access_point WHERE id_road_section = '${ref}'`))[0].n);

  const backupFiles = async (): Promise<string[]> => {
    const folder = path.join(directory, "gis-tools-routine-jobs");
    return (await readdir(folder).catch((): string[] => [])).filter((name) =>
      name.endsWith(".sql.gz")
    );
  };

  const seedMaster = async (id: number): Promise<void> => {
    await database.query("INSERT INTO carto.addresses_master (addresses_master_id, urn, latitud, longitud) VALUES ($1, 'seed', 0, 0)", [id]);
  };

  const mastersCount = async (): Promise<number> => Number((await rowsOf(database, "SELECT count(*)::int AS n FROM carto.addresses_master"))[0].n);

  /** A plain removal: section 5001 with its master 901, no staging row and no new street covering it. */
  const seedPlainRemoval = async (ref = 5001, points = 0): Promise<number> => {
    await insertWay(database, 5, "CALLE CINCO");
    await seedMaster(900 + ref);
    const id = await insertSection(database, { ref, calle: 5, geom: "0:50", distance: "50.00", master: 900 + ref });
    if (points > 0) await insertPoints(database, String(ref), points);
    await insertStaging(database, [{ ref: "6001", calle: "6", nombre: "CALLE SEIS", geom: "900:950" }]);
    return id;
  };

  /** Two old sections of street 7 (0:50 and 50:100) and their new section 6103 (0:100), each old one with its points. */
  const seedMerge = async (): Promise<void> => {
    await insertWay(database, 7, "CALLE SIETE");
    await seedMaster(6101);
    await seedMaster(6102);
    await insertSection(database, { ref: 6101, calle: 7, geom: "0:50", distance: "50.00", master: 6101 });
    await insertSection(database, { ref: 6102, calle: 7, geom: "50:100", distance: "50.00", master: 6102 });
    await insertPoints(database, "6101", 1);
    await insertPoints(database, "6102", 2);
    await insertStaging(database, [{ ref: "6103", calle: "7", nombre: "CALLE SIETE", geom: "0:100" }]);
  };

  describe("accepted plain removal (EJS-9, EJ-21)", () => {
    it("should delete the accepted section without points and its address master, and count it as removed and deleted", async () => {
      await seedPlainRemoval();
      const mastersBefore = await mastersCount();

      const outcome = await persist({ splits: [], plainRemovals: ["5001"], merges: [] });

      expect(await sectionsByRef(5001)).toEqual([]);
      expect(await rowsOf(database, "SELECT addresses_master_id FROM carto.addresses_master WHERE addresses_master_id = 901")).toEqual([]);
      expect(await mastersCount()).toBe(mastersBefore);
      expect(outcome.load.counts).toMatchObject({ removed: 1, deleted: 1, merged: 0 });
      expect(outcome.load.skipped.filter((row) => row.refs.includes("5001"))).toEqual([]);
    });

    it("should restore the removed section and its master with their original ids when the revert SQL is applied", async () => {
      const id = await seedPlainRemoval();
      const before = await snapshotOf(database);
      const outcome = await persist({ splits: [], plainRemovals: ["5001"], merges: [] });
      expect(await sectionsByRef(5001)).toEqual([]);

      await database.exec(await readBackup(outcome));

      expect(await sectionsByRef(5001)).toHaveLength(1);
      expect((await sectionsByRef(5001))[0].id).toBe(id);
      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should keep an accepted plain removal that still holds points, skipped with reason has_points and no point touched", async () => {
      await seedPlainRemoval(5002, 2);
      const log: SqlLog = [];

      const outcome = await persist({ splits: [], plainRemovals: ["5002"], merges: [] }, log);

      expect(await sectionsByRef(5002)).toHaveLength(1);
      expect(await pointsOn("5002")).toBe(2);
      expect(outcome.load.skipped).toEqual([
        { kind: EJES_SKIP_KIND.REMOVAL, refs: ["5002"], newRefs: [], idcalle: "5", points: 2, reason: EJES_SKIP_REASON.HAS_POINTS },
      ]);
      expect(outcome.load.counts).toMatchObject({ removed: 0, deleted: 0 });
      expect(log.some((sql) => /DELETE FROM "carto"\."road_section"/.test(sql))).toBe(false);
    });

    it("should report a plain removal that holds points as not deleted in the analysis, with its point count", async () => {
      await seedPlainRemoval(5002, 2);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.plainRemovals).toEqual([{ ref: "5002", idcalle: "5", points: 2 }]);
      expect(analysis.counts.plainHeld).toBe(1);
    });

    it("should write nothing when the accepted key is not a plain removal of this analysis, and abort before the backup", async () => {
      await seedPlainRemoval();
      const before = await snapshotOf(database);
      const log: SqlLog = [];

      await expect(persist({ splits: [], plainRemovals: ["9999"], merges: [] }, log)).rejects.toThrow(ANALYSIS_CHANGED);

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
      expect(log.filter((sql) => /^WITH "written"|^(INSERT INTO|UPDATE|DELETE FROM) "?carto/.test(sql))).toEqual([]);
    });
  });

  describe("accepted merge (EJS-4, EJS-10, EJS-11)", () => {
    it("should move every point of the old sections to the new reftramo, delete the old sections and masters, and insert the new one", async () => {
      await seedMerge();

      const outcome = await persist({ splits: [], plainRemovals: [], merges: ["6103"] });

      expect(await sectionsByRef(6101)).toEqual([]);
      expect(await sectionsByRef(6102)).toEqual([]);
      expect(await sectionsByRef(6103)).toHaveLength(1);
      expect(await pointsOn("6103")).toBe(3);
      expect(await pointsOn("6101")).toBe(0);
      expect(await rowsOf(database, "SELECT addresses_master_id FROM carto.addresses_master WHERE addresses_master_id IN (6101, 6102)")).toEqual([]);
      expect(outcome.load.counts).toMatchObject({ merged: 1, deleted: 2, inserted: 1, pointsMoved: 3, removed: 0 });
    });

    it("should move the points before deleting the old sections", async () => {
      await seedMerge();
      const log: SqlLog = [];

      await persist({ splits: [], plainRemovals: [], merges: ["6103"] }, log);

      const move = log.findIndex((sql) => /UPDATE "carto"\."access_point"/.test(sql));
      const remove = log.findIndex((sql) => /DELETE FROM "carto"\."road_section"/.test(sql));
      expect(move).toBeGreaterThan(-1);
      expect(remove).toBeGreaterThan(move);
    });

    it("should restore the old sections with their ids, their masters and their points when the revert SQL is applied", async () => {
      await seedMerge();
      const before = await snapshotOf(database);
      const outcome = await persist({ splits: [], plainRemovals: [], merges: ["6103"] });
      expect(await snapshotOf(database)).not.toEqual(before);

      await database.exec(await readBackup(outcome));

      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should change nothing on a second run when the merge is no longer in the analysis, with no accepted key", async () => {
      await seedMerge();
      await persist({ splits: [], plainRemovals: [], merges: ["6103"] });
      const afterFirst = await snapshotOf(database);

      const second = await persist(NO_ACCEPTED);

      expect(await snapshotOf(database)).toEqual(afterFirst);
      expect(second.load.counts).toEqual(zeroLoadCounts());
    });

    it("should keep the merge's new section and points untouched when the same accepted key is sent again", async () => {
      await seedMerge();
      await persist({ splits: [], plainRemovals: [], merges: ["6103"] });
      const afterFirst = await snapshotOf(database);

      await expect(persist({ splits: [], plainRemovals: [], merges: ["6103"] })).rejects.toThrow(ANALYSIS_CHANGED);

      expect(await snapshotOf(database)).toEqual(afterFirst);
    });
  });

  describe("accepted merges refused with nothing deleted (EJS-4, EJL-12)", () => {
    it("should refuse a merge whose old reftramo names two current sections (repeated_old_ref), deleting nothing", async () => {
      await insertWay(database, 8, "CALLE OCHO");
      await insertSection(database, { ref: 6201, calle: 8, geom: "0:50", distance: "50.00" });
      await insertSection(database, { ref: 6201, calle: 8, geom: "50:100", distance: "50.00" });
      await insertStaging(database, [{ ref: "6202", calle: "8", nombre: "CALLE OCHO", geom: "0:100" }]);
      const before = await snapshotOf(database);

      const outcome = await persist({ splits: [], plainRemovals: [], merges: ["6202"] });

      expect(await snapshotOf(database)).toEqual(before);
      expect(outcome.load.skipped.map((row) => [row.kind, row.newRefs, row.reason])).toEqual([
        [EJES_SKIP_KIND.MERGE, ["6202"], EJES_SKIP_REASON.REPEATED_OLD_REF],
      ]);
      expect(outcome.load.counts).toMatchObject({ merged: 0, deleted: 0, inserted: 0 });
    });

    it("should refuse a merge whose new reftramo has two kept copies (not_single_copy, twins), deleting nothing and inserting no copy", async () => {
      await insertWay(database, 9, "CALLE NUEVE");
      await insertSection(database, { ref: 6301, calle: 9, geom: "0:50", distance: "50.00" });
      await insertSection(database, { ref: 6311, calle: 9, geom: "50:100", distance: "50.00" });
      await insertStaging(database, [
        { ref: "6302", calle: "9", nombre: "CALLE NUEVE", localidad: "TRINIDAD", geom: "0:100" },
        { ref: "6302", calle: "9", nombre: "CALLE NUEVE", localidad: "SAN JOSE", geom: "0:100" },
      ]);
      const before = await snapshotOf(database);

      const outcome = await persist({ splits: [], plainRemovals: [], merges: ["6302"] });

      expect(await snapshotOf(database)).toEqual(before);
      expect(outcome.load.skipped.map((row) => [row.kind, row.newRefs, row.reason])).toEqual([
        [EJES_SKIP_KIND.MERGE, ["6302"], EJES_SKIP_REASON.NOT_SINGLE_COPY],
      ]);
      expect(await sectionsByRef(6302)).toEqual([]);
    });

    it("should refuse a merge whose old section has no reftramo (no_reftramo), deleting nothing", async () => {
      await insertWay(database, 11, "CALLE ONCE");
      await insertSection(database, { ref: null, calle: 11, geom: "0:50", distance: "50.00" });
      await insertSection(database, { ref: 6401, calle: 11, geom: "50:100", distance: "50.00" });
      await insertStaging(database, [{ ref: "6402", calle: "11", nombre: "CALLE ONCE", geom: "0:100" }]);
      const before = await snapshotOf(database);

      const outcome = await persist({ splits: [], plainRemovals: [], merges: ["6402"] });

      expect(await snapshotOf(database)).toEqual(before);
      expect(outcome.load.skipped.map((row) => row.reason)).toEqual([EJES_SKIP_REASON.NO_REFTRAMO]);
    });

    it("should refuse a merge whose new reftramo is also a split piece (shared_piece), deleting nothing and inserting no piece", async () => {
      await insertWay(database, 13, "CALLE TRECE");
      await insertSection(database, { ref: 6701, calle: 13, geom: "0:100", distance: "100.00" });
      await insertSection(database, { ref: 6704, calle: 13, geom: "0:20", distance: "20.00" });
      await insertSection(database, { ref: 6705, calle: 13, geom: "20:45", distance: "25.00" });
      await insertStaging(database, [
        { ref: "6702", calle: "13", nombre: "CALLE TRECE", geom: "0:50" },
        { ref: "6703", calle: "13", nombre: "CALLE TRECE", geom: "50:100" },
      ]);
      const before = await snapshotOf(database);

      const outcome = await persist({ splits: [], plainRemovals: [], merges: ["6702"] });

      expect(await snapshotOf(database)).toEqual(before);
      expect(await sectionsByRef(6702)).toEqual([]);
      expect(await sectionsByRef(6703)).toEqual([]);
      expect(outcome.load.skipped.map((row) => [row.kind, row.reason]).sort()).toEqual(
        [
          [EJES_SKIP_KIND.MERGE, EJES_SKIP_REASON.SHARED_PIECE],
          [EJES_SKIP_KIND.SPLIT, EJES_SKIP_REASON.NOT_ACCEPTED],
        ].sort()
      );
    });
  });

  describe("accepted rows that cannot be applied atomically (EJS-10, EJL-2)", () => {
    it("should abort the whole transaction when the delete guard finds a point that still holds the old reftramo", async () => {
      await seedMerge();
      const before = await snapshotOf(database);
      const base = sessionOn(database);
      const racing = {
        query: async (sql: string, values?: unknown[]) => {
          if (/DELETE FROM "carto"\."road_section"/.test(sql)) {
            await database.query("INSERT INTO carto.access_point (id_road_section) VALUES ('6101')");
          }
          return base.query(sql, values);
        },
        close: base.close,
      };
      const summary = await summaryOn(database);
      const context = await loadContextOn(database);

      await expect(
        runEjesPersistTransaction(racing, { ...paramsWith(summary), accepted: { splits: [], plainRemovals: [], merges: ["6103"] } }, context, timer())
      ).rejects.toThrow();

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
    });

    it("should never print the password in the error of a refused accepted merge", async () => {
      await seedMerge();

      const failure = await persist({ splits: [], plainRemovals: [], merges: ["9999"] }).catch((error: unknown) => error as Error);

      expect((failure as Error).message).not.toContain(PASSWORD);
    });
  });

  describe("held groups (EJL-12, EJS-1)", () => {
    it("should hold a split: old section untouched, pieces not inserted, one skipped row with old and new refs and not_accepted", async () => {
      await insertWay(database, 14, "CALLE CATORCE");
      await seedMaster(7901);
      await insertSection(database, { ref: 6901, calle: 14, geom: "0:100", distance: "100.00", master: 7901 });
      await insertPoints(database, "6901", 1);
      await insertStaging(database, [
        { ref: "6902", calle: "14", nombre: "CALLE CATORCE", geom: "0:50" },
        { ref: "6903", calle: "14", nombre: "CALLE CATORCE", geom: "50:100" },
      ]);
      const before = await snapshotOf(database);

      const outcome = await persist();

      expect(await sectionsByRef(6901)).toEqual(before["carto.road_section"].filter((row) => row.reftramo_ideuy === 6901));
      expect(await sectionsByRef(6902)).toEqual([]);
      expect(await sectionsByRef(6903)).toEqual([]);
      expect(outcome.load.skipped).toEqual([
        { kind: EJES_SKIP_KIND.SPLIT, refs: ["6901"], newRefs: ["6902", "6903"], idcalle: "14", points: 1, reason: EJES_SKIP_REASON.NOT_ACCEPTED },
      ]);
      expect(outcome.load.counts).toMatchObject({ inserted: 0, deleted: 0, merged: 0 });
    });

    it("should create no circulation_way, address master or section for the copies of a held split", async () => {
      await insertWay(database, 14, "CALLE CATORCE");
      await insertSection(database, { ref: 6911, calle: 14, geom: "0:100", distance: "100.00" });
      await insertStaging(database, [
        { ref: "6912", calle: "14", nombre: "CALLE NUEVA", geom: "0:50" },
        { ref: "6913", calle: "14", nombre: "CALLE NUEVA", geom: "50:100" },
      ]);
      const before = await snapshotOf(database);

      const outcome = await persist();

      expect(await snapshotOf(database)).toEqual(before);
      expect(outcome.load.counts.waysCreated).toBe(0);
      expect(outcome.load.counts.inserted).toBe(0);
    });

    it("should hold a merge that is not accepted: its new reftramo is inserted by no one, its old sections stay, and it is skipped once", async () => {
      await seedMerge();
      const before = await snapshotOf(database);

      const outcome = await persist();

      expect(await snapshotOf(database)).toEqual(before);
      expect(await sectionsByRef(6103)).toEqual([]);
      expect(outcome.load.skipped).toEqual([
        { kind: EJES_SKIP_KIND.MERGE, refs: ["6101", "6102"], newRefs: ["6103"], idcalle: "7", points: 3, reason: EJES_SKIP_REASON.NOT_ACCEPTED },
      ]);
    });

    it("should count the held pieces neither as new sections nor as new streets in the analysis, and agree with the load", async () => {
      await insertWay(database, 14, "CALLE CATORCE");
      await insertSection(database, { ref: 6921, calle: 14, geom: "0:100", distance: "100.00" });
      await insertStaging(database, [
        { ref: "6922", calle: "14", nombre: "CALLE NUEVA", geom: "0:50" },
        { ref: "6923", calle: "14", nombre: "CALLE NUEVA", geom: "50:100" },
      ]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());
      const outcome = await persist();

      expect(analysis.counts).toMatchObject({ newSections: 0, splits: 1, removed: 1 });
      expect(analysis.newStreets).toEqual([]);
      expect(outcome.analysis.counts.newSections).toBe(analysis.counts.newSections);
      expect(outcome.load.counts.inserted).toBe(0);
    });

    it("should change nothing on a second run after holds, with the same skipped row", async () => {
      await seedMerge();
      await insertStaging(database, [{ ref: "6930", calle: "20", nombre: "CALLE VEINTE", geom: "500:600" }]);
      await persist();
      const afterFirst = await snapshotOf(database);

      const second = await persist();

      expect(await snapshotOf(database)).toEqual(afterFirst);
      expect(second.load.counts).toEqual(zeroLoadCounts());
      expect(second.load.skippedTotal).toBe(1);
    });
  });

  describe("skipped list cap (EJL-13, Q2)", () => {
    /** Plain removals without points that nobody accepted (not_accepted), and accepted ones that hold points (has_points). */
    const seedManyRemovals = async (): Promise<{ total: number; hasPoints: number; accepted: EjesAccepted }> => {
      const plain = DETAIL_LIST_LIMIT + 1;
      const withPoints = 3;
      await insertWay(database, 30, "CALLE TREINTA");
      for (let index = 0; index < plain + withPoints; index += 1) {
        const ref = 10000 + index;
        await insertSection(database, { ref, calle: 30, geom: `${index * 1000}:${index * 1000 + 50}`, distance: "50.00" });
      }
      for (let index = plain; index < plain + withPoints; index += 1) {
        await insertPoints(database, String(10000 + index), 1);
      }

      const accepted = { splits: [], plainRemovals: Array.from({ length: withPoints }, (_, offset) => String(10000 + plain + offset)), merges: [] };
      return { total: plain + withPoints, hasPoints: withPoints, accepted };
    };

    it("should list at most DETAIL_LIST_LIMIT skipped rows while the total and the per-reason counts cover every row", async () => {
      const { total, hasPoints, accepted } = await seedManyRemovals();

      const outcome = await persist(accepted);

      expect(outcome.load.skipped).toHaveLength(DETAIL_LIST_LIMIT);
      expect(outcome.load.skippedTotal).toBe(total);
      expect(outcome.load.skippedByReason).toHaveLength(2);
      expect(outcome.load.skippedByReason).toEqual(
        expect.arrayContaining([
          { reason: EJES_SKIP_REASON.NOT_ACCEPTED, count: total - hasPoints },
          { reason: EJES_SKIP_REASON.HAS_POINTS, count: hasPoints },
        ])
      );
      expect(outcome.load.skippedByReason.reduce((sum, entry) => sum + entry.count, 0)).toBe(total);
    });

    it("should write none of the skipped removals while listing only part of them", async () => {
      const { accepted } = await seedManyRemovals();
      const before = await snapshotOf(database);

      await persist(accepted);

      expect(await snapshotOf(database)).toEqual(before);
    });
  });

  describe("classification of a plain replacement next to a continuing street (EJ-10)", () => {
    it("should classify a removed section replaced by one new section as a plain removal, not a split, when another new section only touches its end", async () => {
      await insertWay(database, 15, "CALLE QUINCE");
      await insertSection(database, { ref: 6801, calle: 15, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [
        { ref: "6802", calle: "15", nombre: "CALLE QUINCE", geom: "0:50.6" },
        { ref: "6803", calle: "15", nombre: "CALLE QUINCE", geom: "50:100" },
      ]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.splits.map((row) => row.oldRef)).toEqual([]);
      expect(analysis.plainRemovals.map((row) => row.ref)).toEqual(["6801"]);
    });
  });

  describe("touching neighbours and the 2 m cover of a split piece or a merge member (EJ-10, SPLIT_PIECE_MIN_COVER_M)", () => {
    it("should not list a neighbour that only overlaps the removed section by 1 m as a merge member, and keep the section a plain removal", async () => {
      await insertWay(database, 15, "CALLE QUINCE");
      await insertSection(database, { ref: 6801, calle: 15, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [
        { ref: "6802", calle: "15", nombre: "CALLE QUINCE", geom: "0:50.6" },
        { ref: "6803", calle: "15", nombre: "CALLE QUINCE", geom: "50:100" },
      ]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.merges).toEqual([]);
      expect(analysis.splits).toEqual([]);
      expect(analysis.plainRemovals.map((row) => row.ref)).toEqual(["6801"]);
    });

    it("should not count a neighbour whose cover of the removed section is exactly 2 m as a split piece", async () => {
      await insertWay(database, 17, "CALLE DIECISIETE");
      await insertSection(database, { ref: 6811, calle: 17, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [
        { ref: "6812", calle: "17", nombre: "CALLE DIECISIETE", geom: "0:30" },
        { ref: "6813", calle: "17", nombre: "CALLE DIECISIETE", geom: "49:100" },
      ]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.splits).toEqual([]);
      expect(analysis.merges).toEqual([]);
      expect(analysis.plainRemovals.map((row) => row.ref)).toEqual(["6811"]);
    });

    it("should count a neighbour whose cover of the removed section is above 2 m as a split piece", async () => {
      await insertWay(database, 17, "CALLE DIECISIETE");
      await insertSection(database, { ref: 6821, calle: 17, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [
        { ref: "6822", calle: "17", nombre: "CALLE DIECISIETE", geom: "0:30" },
        { ref: "6823", calle: "17", nombre: "CALLE DIECISIETE", geom: "48.5:100" },
      ]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.splits.map((row) => [row.oldRef, row.newRefs])).toEqual([["6821", ["6822", "6823"]]]);
      expect(analysis.plainRemovals).toEqual([]);
    });

    it("should not count a merge member of a long section whose cover is exactly 2 m, so one section alone is no merge", async () => {
      await insertWay(database, 18, "CALLE DIECIOCHO");
      await insertSection(database, { ref: 6831, calle: 18, geom: "0:50", distance: "50.00" });
      await insertSection(database, { ref: 6832, calle: 18, geom: "98:150", distance: "52.00" });
      await insertStaging(database, [{ ref: "6833", calle: "18", nombre: "CALLE DIECIOCHO", geom: "0:99" }]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.merges).toEqual([]);
      expect(analysis.splits).toEqual([]);
      expect(analysis.plainRemovals.map((row) => row.ref)).toEqual(["6831", "6832"]);
    });

    it("should count a 2 m stub covered in full as a merge member through the 95% ratio, so the two sections merge", async () => {
      await insertWay(database, 18, "CALLE DIECIOCHO");
      await insertSection(database, { ref: 6831, calle: 18, geom: "0:50", distance: "50.00" });
      await insertSection(database, { ref: 6832, calle: 18, geom: "98:100", distance: "2.00" });
      await insertStaging(database, [{ ref: "6833", calle: "18", nombre: "CALLE DIECIOCHO", geom: "0:100" }]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.merges.map((row) => [row.newRef, row.oldRefs])).toEqual([["6833", ["6831", "6832"]]]);
      expect(analysis.splits).toEqual([]);
      expect(analysis.plainRemovals).toEqual([]);
    });

    it("should count a merge member whose cover is above 2 m, so the two removed sections merge into their new section", async () => {
      await insertWay(database, 19, "CALLE DIECINUEVE");
      await insertSection(database, { ref: 6841, calle: 19, geom: "0:50", distance: "50.00" });
      await insertSection(database, { ref: 6842, calle: 19, geom: "97:100", distance: "3.00" });
      await insertStaging(database, [{ ref: "6843", calle: "19", nombre: "CALLE DIECINUEVE", geom: "0:100" }]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.merges.map((row) => [row.newRef, row.oldRefs])).toEqual([["6843", ["6841", "6842"]]]);
      expect(analysis.splits).toEqual([]);
      expect(analysis.plainRemovals).toEqual([]);
    });

    it("should still classify a genuine two-piece replacement of one section as a split", async () => {
      await insertWay(database, 20, "CALLE VEINTE");
      await insertSection(database, { ref: 6851, calle: 20, geom: "0:50", distance: "50.00" });
      await insertStaging(database, [
        { ref: "6852", calle: "20", nombre: "CALLE VEINTE", geom: "0:25" },
        { ref: "6853", calle: "20", nombre: "CALLE VEINTE", geom: "25:50" },
      ]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.splits.map((row) => [row.oldRef, row.newRefs])).toEqual([["6851", ["6852", "6853"]]]);
      expect(analysis.merges).toEqual([]);
      expect(analysis.plainRemovals).toEqual([]);
    });

    it("should still classify a genuine merge of two removed sections into one new section as a merge", async () => {
      await seedMerge();

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.merges.map((row) => [row.newRef, row.oldRefs])).toEqual([["6103", ["6101", "6102"]]]);
      expect(analysis.splits).toEqual([]);
      expect(analysis.plainRemovals).toEqual([]);
    });
  });

  describe("points matched by road_section.id (EJ-21, D2)", () => {
    const pointsByIdOn = async (id: number): Promise<Row[]> =>
      rowsOf(database, `SELECT id_road_section FROM carto.access_point WHERE id_road_section = '${id}'`);

    /** A plain removal, section 5003 with one point held by its road_section.id, and a staging row elsewhere. */
    const seedPlainRemovalByIdPoint = async (): Promise<number> => {
      await insertWay(database, 16, "CALLE DIECISEIS");
      await seedMaster(7003);
      const id = await insertSection(database, { ref: 5003, calle: 16, geom: "0:50", distance: "50.00", master: 7003 });
      await insertPoints(database, String(id), 1);
      await insertStaging(database, [{ ref: "6003", calle: "16", nombre: "CALLE DIECISEIS", geom: "900:950" }]);
      return id;
    };

    it("should keep an accepted plain removal whose road_section.id holds a point, skipped with has_points and nothing deleted", async () => {
      const id = await seedPlainRemovalByIdPoint();
      const log: SqlLog = [];

      const outcome = await persist({ splits: [], plainRemovals: ["5003"], merges: [] }, log);

      expect(await sectionsByRef(5003)).toHaveLength(1);
      expect(await pointsByIdOn(id)).toHaveLength(1);
      expect(outcome.load.skipped).toEqual([
        { kind: EJES_SKIP_KIND.REMOVAL, refs: ["5003"], newRefs: [], idcalle: "16", points: 1, reason: EJES_SKIP_REASON.HAS_POINTS },
      ]);
      expect(outcome.load.counts).toMatchObject({ removed: 0, deleted: 0 });
      expect(log.some((sql) => /DELETE FROM "carto"\."road_section"/.test(sql))).toBe(false);
    });

    it("should list a plain removal whose road_section.id holds a point with its point count, and count it as held", async () => {
      await seedPlainRemovalByIdPoint();

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.plainRemovals).toEqual([{ ref: "5003", idcalle: "16", points: 1 }]);
      expect(analysis.counts.plainHeld).toBe(1);
    });

    it("should refuse an accepted merge whose old section holds a point by road_section.id (points_by_id), moving and deleting nothing, with the total points", async () => {
      await seedMerge();
      const id = Number((await sectionsByRef(6102))[0].id);
      await insertPoints(database, String(id), 1);
      const before = await snapshotOf(database);

      const outcome = await persist({ splits: [], plainRemovals: [], merges: ["6103"] });

      expect(await snapshotOf(database)).toEqual(before);
      expect(outcome.load.skipped).toEqual([
        { kind: EJES_SKIP_KIND.MERGE, refs: ["6101", "6102"], newRefs: ["6103"], idcalle: "7", points: 4, reason: EJES_SKIP_REASON.ID_LINKED_POINTS },
      ]);
      expect(outcome.load.counts).toMatchObject({ merged: 0, deleted: 0, inserted: 0 });
    });

    it("should list a merge at the total of its reftramo points and its road_section.id points", async () => {
      await seedMerge();
      const id = Number((await sectionsByRef(6102))[0].id);
      await insertPoints(database, String(id), 1);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.merges.map((row) => [row.newRef, row.points])).toEqual([["6103", 4]]);
    });

    it("should list a split at the total of its reftramo points and its road_section.id points", async () => {
      await insertWay(database, 21, "CALLE VEINTIUNO");
      const id = await insertSection(database, { ref: 6861, calle: 21, geom: "0:50", distance: "50.00" });
      await insertPoints(database, "6861", 1);
      await insertPoints(database, String(id), 1);
      await insertStaging(database, [
        { ref: "6862", calle: "21", nombre: "CALLE VEINTIUNO", geom: "0:25" },
        { ref: "6863", calle: "21", nombre: "CALLE VEINTIUNO", geom: "25:50" },
      ]);

      const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

      expect(analysis.splits.map((row) => [row.oldRef, row.points])).toEqual([["6861", 2]]);
    });

    it("should move the reftramo points of an applied merge and leave a point held by another section's road_section.id where it is", async () => {
      await seedMerge();
      await insertSection(database, { ref: 6150, calle: 7, geom: "200:300", distance: "100.00" });
      await insertStaging(database, [{ ref: "6150", calle: "7", nombre: "CALLE SIETE", geom: "200:300" }]);
      const unchanged = Number((await sectionsByRef(6150))[0].id);
      await insertPoints(database, String(unchanged), 1);

      const outcome = await persist({ splits: [], plainRemovals: [], merges: ["6103"] });

      expect(await pointsOn("6103")).toBe(3);
      expect(outcome.load.counts).toMatchObject({ merged: 1, deleted: 2, inserted: 1, pointsMoved: 3 });
      expect(await pointsByIdOn(unchanged)).toHaveLength(1);
      expect(await sectionsByRef(6150)).toHaveLength(1);
    });

    it("should abort the whole transaction when the delete guard finds a point holding the road_section.id of a section being deleted", async () => {
      await seedMerge();
      const id = Number((await sectionsByRef(6101))[0].id);
      const before = await snapshotOf(database);
      const base = sessionOn(database);
      const racing = {
        query: async (sql: string, values?: unknown[]) => {
          if (/DELETE FROM "carto"\."road_section"/.test(sql)) {
            await database.query("INSERT INTO carto.access_point (id_road_section) VALUES ($1)", [String(id)]);
          }
          return base.query(sql, values);
        },
        close: base.close,
      };
      const summary = await summaryOn(database);
      const context = await loadContextOn(database);

      await expect(
        runEjesPersistTransaction(racing, { ...paramsWith(summary), accepted: { splits: [], plainRemovals: [], merges: ["6103"] } }, context, timer())
      ).rejects.toThrow();

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
    });
  });
});
