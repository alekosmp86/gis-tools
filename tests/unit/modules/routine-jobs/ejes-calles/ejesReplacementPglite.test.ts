import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { EJES_SKIP_KIND, EJES_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { splitGroupsSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/splitHoldSql";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import type { EjesAccepted } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesLayouts } from "./ejesFixtures";
import {
  createEjesDatabase,
  insertAddress,
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
  type Row,
  type StagingRow,
} from "./ejesLoadHarness";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;
const timer = () => createStepTimer({ now: () => 0, total: 20 });
const OLD_REF = "6001";
const NEW_REF = "6002";
const NO_ACCEPTED: EjesAccepted = { splits: [], plainRemovals: [], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false };
const replacementOf = (): EjesAccepted => ({
  splits: [{ oldRef: OLD_REF, choices: [] }],
  plainRemovals: [],
  merges: [],
  twinRemovals: [],
  twinPicks: [], manualSplits: [], autoPlainRemovals: false,
});

describe("one-piece replacements on PGlite (EJS-3, EJS-10, EJS-11, EJS-16, EJ-10, EJ-21)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-replacement-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const analysisOf = () => readAnalysis(sessionOn(database), ejesLayouts());

  const persist = async (accepted: EjesAccepted = NO_ACCEPTED): Promise<EjesPersistOutcome> => {
    const summary = await summaryOn(database);
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(sessionOn(database), { ...paramsWith(summary), accepted }, context, timer());
  };

  const readBackup = async (outcome: EjesPersistOutcome): Promise<string> => {
    const entry = getRevertBackup(outcome.load.backup?.token ?? "");
    expect(entry).toBeDefined();
    return gunzipSync(await readFile(entry?.filePath ?? "")).toString("utf8");
  };

  const sectionsByRef = async (ref: number | string): Promise<Row[]> =>
    rowsOf(database, `SELECT * FROM carto.road_section WHERE reftramo_ideuy = ${ref} ORDER BY id`);

  const accessPointsCount = async (): Promise<number> =>
    Number((await rowsOf(database, "SELECT count(*)::int AS n FROM carto.access_point"))[0].n);

  const refOfPoint = async (id: number): Promise<string | null> =>
    (await rowsOf<{ ref: string | null }>(database, `SELECT id_road_section AS ref FROM carto.access_point WHERE id = ${id}`))[0].ref;

  /** The old section 6001 (0:100) with its master, as the replacement tests read it. */
  const seedOldSection = async (): Promise<number> => {
    await insertWay(database, 30, "CALLE TREINTA");
    await database.query("INSERT INTO carto.addresses_master (addresses_master_id, urn, latitud, longitud) VALUES (6001, 'seed', 0, 0)");
    return insertSection(database, { ref: 6001, calle: 30, geom: "0:100", distance: "100.00", master: 6001 });
  };

  /** A new section of the test street under `NEW_REF`, with the given geometry (the interval of one street line). */
  const stageNew = (geom: string, extra: Partial<StagingRow> = {}): Promise<void> =>
    insertStaging(database, [{ ref: NEW_REF, calle: "30", nombre: "CALLE TREINTA", geom, ...extra }]);

  /** One access point of `ref` with its address geometry; undefined means no address row at all. */
  const pointAt = async (ref: string | null, geometry: string | null | undefined): Promise<number> => {
    const [id] = await insertPoints(database, ref, 1);
    if (geometry !== undefined) await insertAddress(database, id, geometry);
    return id;
  };

  describe("a longer new section covering a three-point old section (EJS-3, EJS-10, EJS-11)", () => {
    const seedGrownReplacement = async (): Promise<number[]> => {
      await seedOldSection();
      await stageNew("0:150");
      return [await pointAt(OLD_REF, "10:10"), await pointAt(OLD_REF, "40:40"), await pointAt(OLD_REF, "80:80")];
    };

    it("should list one split row with one new piece and its three points, none for review, when the new section covers the old one", async () => {
      await seedGrownReplacement();

      const analysis = await analysisOf();

      expect(analysis.splits.map((row) => [row.oldRef, row.newRefs, row.points, row.reviewPoints, row.heldReason])).toEqual([
        [OLD_REF, [NEW_REF], 3, 0, null],
      ]);
    });

    it("should move every point to the new reftramo, delete the old row and insert the new one when the replacement is accepted", async () => {
      const points = await seedGrownReplacement();
      const pointsBefore = await accessPointsCount();

      const outcome = await persist(replacementOf());

      expect(await sectionsByRef(6001)).toEqual([]);
      expect(await sectionsByRef(6002)).toHaveLength(1);
      for (const id of points) expect(await refOfPoint(id)).toBe(NEW_REF);
      expect(await accessPointsCount()).toBe(pointsBefore);
      expect(outcome.load.counts).toMatchObject({ splitsApplied: 1, deleted: 1, inserted: 1, pointsMoved: 3 });
      expect(outcome.load.skipped).toEqual([]);
    });

    it("should restore the points to the old reftramo and the old row when the revert of the replacement is applied", async () => {
      const points = await seedGrownReplacement();
      const before = await snapshotOf(database);
      const outcome = await persist(replacementOf());
      expect(await refOfPoint(points[0])).toBe(NEW_REF);

      await database.exec(await readBackup(outcome));

      for (const id of points) expect(await refOfPoint(id)).toBe(OLD_REF);
      expect(await sectionsByRef(6001)).toHaveLength(1);
      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should change nothing and count nothing when the replacement is not accepted", async () => {
      await seedGrownReplacement();
      const before = await snapshotOf(database);

      const outcome = await persist(NO_ACCEPTED);

      expect(await snapshotOf(database)).toEqual(before);
      expect(outcome.load.counts).toEqual(zeroLoadCounts());
    });
  });

  describe("points of a replacement (EJS-3, EJS-5)", () => {
    it.each<[string, string | null | undefined]>([
      ["NULL", null],
      ["no address row", undefined],
    ])("should assign a point with %s address geometry to the one piece automatically, deleting the old row", async (_label, geometry) => {
      await seedOldSection();
      await stageNew("0:150");
      const point = await pointAt(OLD_REF, geometry);

      const outcome = await persist(replacementOf());

      expect(await refOfPoint(point)).toBe(NEW_REF);
      expect(await sectionsByRef(6001)).toEqual([]);
      expect(outcome.load.skipped).toEqual([]);
    });
  });

  describe("holds of a replacement (EJS-8, EJS-16)", () => {
    it("should hold the replacement with points_by_id, moving and deleting nothing, when a point is linked by road_section.id", async () => {
      await seedOldSection();
      await stageNew("0:150");
      const sectionId = Number((await sectionsByRef(6001))[0].id);
      await pointAt(String(sectionId), "10:10");
      const before = await snapshotOf(database);

      const outcome = await persist(replacementOf());
      const analysis = await analysisOf();

      expect(analysis.splits.map((row) => row.heldReason)).toEqual([EJES_SKIP_REASON.ID_LINKED_POINTS]);
      expect(await snapshotOf(database)).toEqual(before);
      expect(outcome.load.skipped).toEqual([
        {
          kind: EJES_SKIP_KIND.SPLIT,
          refs: [OLD_REF],
          newRefs: [NEW_REF],
          idcalle: "30",
          points: 1,
          reason: EJES_SKIP_REASON.ID_LINKED_POINTS,
        },
      ]);
    });

    it("should hold a replacement whose new piece is also a merge member (shared_piece) and keep the piece out of the merges", async () => {
      await database.exec(`
        CREATE TABLE t_pieces (old_id int, old_ref text, idcalle text, points bigint, id_points bigint, old_rows bigint, new_ref text, geom_variant boolean, manual boolean);
        CREATE TABLE t_merges (new_ref text);
        CREATE TABLE t_copy_refs (ref text, copies bigint);
        INSERT INTO t_pieces VALUES (1, '6001', '30', 3, 0, 1, '6002', false, false);
        INSERT INTO t_copy_refs VALUES ('6002', 1);
        INSERT INTO t_merges VALUES ('6002');
      `);

      const holds = await rowsOf<{ old_id: number; hold_reason: string | null }>(
        database,
        splitGroupsSql("t_pieces", "t_merges", "t_copy_refs")
      );

      expect(holds.map((row) => [row.old_id, row.hold_reason])).toEqual([[1, EJES_SKIP_REASON.SHARED_PIECE]]);
    });

    it("should leave a replacement with no hold reason when its piece is no merge member and no other split uses it", async () => {
      await database.exec(`
        CREATE TABLE t_pieces (old_id int, old_ref text, idcalle text, points bigint, id_points bigint, old_rows bigint, new_ref text, geom_variant boolean, manual boolean);
        CREATE TABLE t_merges (new_ref text);
        CREATE TABLE t_copy_refs (ref text, copies bigint);
        INSERT INTO t_pieces VALUES (1, '6001', '30', 3, 0, 1, '6002', false, false);
        INSERT INTO t_copy_refs VALUES ('6002', 1);
      `);

      const holds = await rowsOf<{ old_id: number; hold_reason: string | null }>(
        database,
        splitGroupsSql("t_pieces", "t_merges", "t_copy_refs")
      );

      expect(holds.map((row) => [row.old_id, row.hold_reason])).toEqual([[1, null]]);
    });
  });

  describe("a one-piece split whose new reftramo is not a single copy (EJS-16)", () => {
    it("should keep a one-piece removal with points as a plain removal, not a replacement, when the new reftramo holds two copies", async () => {
      await seedOldSection();
      await pointAt(OLD_REF, "10:10");
      await insertStaging(database, [
        { ref: NEW_REF, calle: "30", nombre: "CALLE TREINTA", localidad: "TRINIDAD", departamento: "FLORES", geom: "0:150" },
        { ref: NEW_REF, calle: "30", nombre: "CALLE TREINTA", localidad: "TRINIDAD", departamento: "SAN JOSE", geom: "0:150" },
      ]);

      const analysis = await analysisOf();

      expect(analysis.splits).toEqual([]);
      expect(analysis.plainRemovals.map((row) => [row.ref, row.points])).toEqual([[OLD_REF, 1]]);
    });
  });

  describe("merge precedence and NULL reftramo over a one-piece replacement (EJ-10, EJS-16)", () => {
    it("should keep a two-section merge into one piece as a merge, not a replacement, when each old section passes the piece test", async () => {
      await insertWay(database, 31, "CALLE TREINTA Y UNO");
      await insertSection(database, { ref: 6101, calle: 31, geom: "0:50", distance: "50.00" });
      await insertSection(database, { ref: 6102, calle: 31, geom: "50:100", distance: "50.00" });
      await insertStaging(database, [{ ref: "6103", calle: "31", nombre: "CALLE TREINTA Y UNO", geom: "0:100" }]);

      const analysis = await analysisOf();

      expect(analysis.splits).toEqual([]);
      expect(analysis.merges.map((row) => [row.newRef, row.oldRefs])).toEqual([["6103", ["6101", "6102"]]]);
    });

    it("should keep a one-piece NULL-reftramo section as a plain removal, not a replacement, when a new section covers it fully", async () => {
      await insertWay(database, 30, "CALLE TREINTA");
      await insertSection(database, { ref: null, calle: 30, geom: "0:100", distance: "100.00" });
      await stageNew("0:150");

      const analysis = await analysisOf();

      expect(analysis.splits).toEqual([]);
      expect(analysis.plainRemovals).toHaveLength(1);
      expect(analysis.plainRemovals).toMatchObject([{ idcalle: "30" }]);
    });
  });

  describe("a renumber pair is not a replacement (EJ-10, EJL-27)", () => {
    it("should list the pair as a renumber and no split when the new section has the same geometry as the old one", async () => {
      await seedOldSection();
      await stageNew("0:100");

      const analysis = await analysisOf();

      expect(analysis.splits).toEqual([]);
      expect(analysis.renumbered.map((row) => [row.oldRef, row.newRef])).toEqual([[OLD_REF, NEW_REF]]);
    });
  });

  describe("the replacement guard: a short old section or a piece over 3 times it sends its points to review (EJS-17)", () => {
    const seedOldOfLength = async (length: number): Promise<void> => {
      await insertWay(database, 30, "CALLE TREINTA");
      await database.query("INSERT INTO carto.addresses_master (addresses_master_id, urn, latitud, longitud) VALUES (6001, 'seed', 0, 0)");
      await insertSection(database, { ref: 6001, calle: 30, geom: `0:${length}`, distance: length.toFixed(2), master: 6001 });
    };

    it("should send both points of a 1 m old section to review, not accepted, when a 3 m new section covers it", async () => {
      await seedOldOfLength(1);
      await stageNew("0:3");
      await pointAt(OLD_REF, "0.2:0.2");
      await pointAt(OLD_REF, "0.8:0.8");
      const before = await snapshotOf(database);

      const row = (await analysisOf()).splits[0];
      const outcome = await persist(replacementOf());

      expect([row.newRefs, row.points, row.reviewPoints, row.heldReason]).toEqual([[NEW_REF], 2, 2, null]);
      expect(await snapshotOf(database)).toEqual(before);
      expect(outcome.load.skipped).toEqual([expect.objectContaining({ kind: EJES_SKIP_KIND.SPLIT, reason: EJES_SKIP_REASON.REVIEW_REQUIRED })]);
    });

    it("should move both points, delete the old row and keep the access point count when the user chooses the piece of each", async () => {
      await seedOldOfLength(1);
      await stageNew("0:3");
      const first = await pointAt(OLD_REF, "0.2:0.2");
      const second = await pointAt(OLD_REF, "0.8:0.8");
      const pointsBefore = await accessPointsCount();

      const outcome = await persist({
        splits: [
          {
            oldRef: OLD_REF,
            choices: [
              { pointId: String(first), newRef: NEW_REF },
              { pointId: String(second), newRef: NEW_REF },
            ],
          },
        ],
        plainRemovals: [],
        merges: [],
        twinRemovals: [],
        twinPicks: [], manualSplits: [], autoPlainRemovals: false,
      });

      expect(await refOfPoint(first)).toBe(NEW_REF);
      expect(await refOfPoint(second)).toBe(NEW_REF);
      expect(await sectionsByRef(6001)).toEqual([]);
      expect(await sectionsByRef(6002)).toHaveLength(1);
      expect(await accessPointsCount()).toBe(pointsBefore);
      expect(outcome.load.skipped).toEqual([]);
    });

    it.each([
      { label: "a new section four times the old one", oldLength: 10, newLength: 40, review: true },
      { label: "a new section 2.5 times the old one", oldLength: 10, newLength: 25, review: false },
      { label: "a new section exactly three times the old one", oldLength: 10, newLength: 30, review: false },
      { label: "an old section of exactly 2 m", oldLength: 2, newLength: 4, review: false },
    ])("should send the point to review=$review for $label", async ({ oldLength, newLength, review }) => {
      await seedOldOfLength(oldLength);
      await stageNew(`0:${newLength}`);
      const point = await pointAt(OLD_REF, "1:1");

      const row = (await analysisOf()).splits[0];
      const outcome = await persist(replacementOf());

      expect(row.reviewPoints).toBe(review ? 1 : 0);
      expect(await refOfPoint(point)).toBe(review ? OLD_REF : NEW_REF);
      expect(outcome.load.skipped).toEqual(
        review ? [expect.objectContaining({ kind: EJES_SKIP_KIND.SPLIT, reason: EJES_SKIP_REASON.REVIEW_REQUIRED })] : []
      );
    });
  });
});
