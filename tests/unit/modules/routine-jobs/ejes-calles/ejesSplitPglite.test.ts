import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getRevertBackup } from "@/modules/routine-jobs/jobs/actualizar-padron/services/revertBackupStore";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { EJES_SKIP_KIND, EJES_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { runEjesPersistTransaction, type EjesPersistOutcome } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
import { ANALYSIS_CHANGED_MESSAGE, CHOICE_NOT_APPLICABLE_MESSAGE } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeStatements";
import type { EjesAccepted, EjesPointChoice } from "@/modules/routine-jobs/jobs/ejes-calles/types";
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
} from "./ejesLoadHarness";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;
const timer = () => createStepTimer({ now: () => 0, total: 20 });
const OLD_REF = "6001";
const NO_SPLIT: EjesAccepted = { splits: [], plainRemovals: [], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false };

const acceptedSplit = (choices: EjesPointChoice[] = []): EjesAccepted => ({
  splits: [{ oldRef: OLD_REF, choices }],
  plainRemovals: [],
  merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false,
});

describe("accepted splits on PGlite (EJS-3, EJS-5, EJS-6, EJS-7, EJS-8, EJS-10, EJS-11, EJS-16)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "true");
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-split-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const persist = async (accepted: EjesAccepted = NO_SPLIT): Promise<EjesPersistOutcome> => {
    const summary = await summaryOn(database);
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(sessionOn(database), { ...paramsWith(summary), accepted }, context, timer());
  };

  const readBackup = async (outcome: EjesPersistOutcome): Promise<string> => {
    const entry = getRevertBackup(outcome.load.backup?.token ?? "");
    expect(entry).toBeDefined();
    return gunzipSync(await readFile(entry?.filePath ?? "")).toString("utf8");
  };

  const backupFiles = async (): Promise<string[]> => {
    const folder = path.join(directory, "gis-tools-routine-jobs");
    return (await readdir(folder).catch((): string[] => [])).filter((name) => name.endsWith(".sql.gz"));
  };

  const sectionsByRef = async (ref: string | number): Promise<Row[]> =>
    rowsOf(database, `SELECT * FROM carto.road_section WHERE reftramo_ideuy = ${ref} ORDER BY id`);

  /** The old section 6001 (0:100) with its master, and two pieces 6002 and 6003 given by their text intervals. */
  const seedSplit = async (pieces: [string, string] = ["0:50", "50:100"]): Promise<number> => {
    await insertWay(database, 30, "CALLE TREINTA");
    await database.query("INSERT INTO carto.addresses_master (addresses_master_id, urn, latitud, longitud) VALUES (6001, 'seed', 0, 0)");
    const id = await insertSection(database, { ref: 6001, calle: 30, geom: "0:100", distance: "100.00", master: 6001 });
    await insertStaging(database, [
      { ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: pieces[0] },
      { ref: "6003", calle: "30", nombre: "CALLE TREINTA", geom: pieces[1] },
    ]);
    return id;
  };

  /** One access point of `ref` (null for none) with its address geometry: undefined means no address row at all. */
  const pointAt = async (ref: string | null, geometry: string | null | undefined): Promise<number> => {
    const [id] = await insertPoints(database, ref, 1);
    if (geometry !== undefined) await insertAddress(database, id, geometry);
    return id;
  };

  const refOfPoint = async (id: number): Promise<string | null> =>
    (await rowsOf<{ ref: string | null }>(database, `SELECT id_road_section AS ref FROM carto.access_point WHERE id = ${id}`))[0].ref;

  describe("automatic points (EJS-3, EJS-5, EJS-10, EJS-11)", () => {
    it("should insert the pieces, move each point to its nearest piece, and delete the old section and its master", async () => {
      await seedSplit();
      const near = await pointAt(OLD_REF, "10:10");
      const far = await pointAt(OLD_REF, "80:80");

      const outcome = await persist(acceptedSplit());

      expect(await sectionsByRef(6001)).toEqual([]);
      expect(await sectionsByRef(6002)).toHaveLength(1);
      expect(await sectionsByRef(6003)).toHaveLength(1);
      expect(await refOfPoint(near)).toBe("6002");
      expect(await refOfPoint(far)).toBe("6003");
      expect(await rowsOf(database, "SELECT addresses_master_id FROM carto.addresses_master WHERE addresses_master_id = 6001")).toEqual([]);
      expect(outcome.load.counts).toMatchObject({ splitsApplied: 1, deleted: 1, pointsMoved: 2 });
    });

    it("should leave the points of other sections and the points with no or another reftramo exactly as they were", async () => {
      await seedSplit();
      await insertSection(database, { ref: 7001, calle: 30, geom: "300:350", distance: "50.00" });
      const otherSection = await pointAt("7001", "310:310");
      const noRef = await pointAt(null, "10:10");
      const zero = await pointAt("0", "10:10");
      const otherValue = await pointAt("9999", "10:10");
      const before = await snapshotOf(database);

      await persist(acceptedSplit());

      const after = await snapshotOf(database);
      const pointsOf = (snapshot: Record<string, Row[]>): Row[] => snapshot["carto.access_point"];
      for (const id of [otherSection, noRef, zero, otherValue]) {
        expect(pointsOf(after).find((row) => row.id === id)).toEqual(pointsOf(before).find((row) => row.id === id));
      }
      expect(await sectionsByRef(7001)).toHaveLength(1);
    });

    it("should change nothing on a second run when the split is no longer in the analysis", async () => {
      await seedSplit();
      await pointAt(OLD_REF, "10:10");
      await persist(acceptedSplit());
      const afterFirst = await snapshotOf(database);

      const second = await persist(NO_SPLIT);

      expect(await snapshotOf(database)).toEqual(afterFirst);
      expect(second.load.counts).toEqual(zeroLoadCounts());
    });

    it("should restore the old section with its id, its master and every point's raw reftramo when the revert SQL is applied", async () => {
      await seedSplit();
      const near = await pointAt(OLD_REF, "10:10");
      const far = await pointAt(OLD_REF, "80:80");
      const before = await snapshotOf(database);
      const outcome = await persist(acceptedSplit());
      expect(await refOfPoint(near)).toBe("6002");

      await database.exec(await readBackup(outcome));

      expect(await refOfPoint(near)).toBe(OLD_REF);
      expect(await refOfPoint(far)).toBe(OLD_REF);
      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should move a point beyond 25 m of every piece to its nearest piece like any other point (far points, EJS-8)", async () => {
      await seedSplit();
      const far = await pointAt(OLD_REF, "200:200");

      await persist(acceptedSplit());

      expect(await refOfPoint(far)).toBe("6003");
    });

    it("should assign a point to the nearer piece when the gap is exactly 5 m (boundary, EJS-5)", async () => {
      await seedSplit(["0:52", "48:100"]);
      const boundary = await pointAt(OLD_REF, "43:43");

      await persist(acceptedSplit());

      expect(await refOfPoint(boundary)).toBe("6002");
    });
  });

  describe("review points and the hold (EJS-5, EJS-6, EJS-16)", () => {
    it("should hold a split with an ambiguous point under 5 m and no choice: no piece inserted, the old section and every point untouched", async () => {
      await seedSplit(["0:52", "48:100"]);
      await pointAt(OLD_REF, "10:10");
      const ambiguous = await pointAt(OLD_REF, "43.001:43.001");
      const before = await snapshotOf(database);

      const outcome = await persist(acceptedSplit());

      expect(await snapshotOf(database)).toEqual(before);
      expect(await refOfPoint(ambiguous)).toBe(OLD_REF);
      expect(outcome.load.skipped).toEqual([
        {
          kind: EJES_SKIP_KIND.SPLIT,
          refs: [OLD_REF],
          newRefs: ["6002", "6003"],
          idcalle: "30",
          points: 2,
          reason: EJES_SKIP_REASON.REVIEW_REQUIRED,
        },
      ]);
      expect(outcome.load.counts).toMatchObject({ splitsApplied: 0, inserted: 0, deleted: 0 });
    });

    it("should send an ambiguous point to the piece the user chose, even when it is not the nearest one", async () => {
      await seedSplit(["0:52", "48:100"]);
      await pointAt(OLD_REF, "10:10");
      const ambiguous = await pointAt(OLD_REF, "43.001:43.001");

      await persist(acceptedSplit([{ pointId: String(ambiguous), newRef: "6003" }]));

      expect(await refOfPoint(ambiguous)).toBe("6003");
      expect(await sectionsByRef(6001)).toEqual([]);
    });

    it("should restore the point's raw reftramo by id when the revert of a split with a user choice is applied", async () => {
      await seedSplit(["0:52", "48:100"]);
      const ambiguous = await pointAt(OLD_REF, "43.001:43.001");
      const before = await snapshotOf(database);
      const outcome = await persist(acceptedSplit([{ pointId: String(ambiguous), newRef: "6003" }]));

      await database.exec(await readBackup(outcome));

      expect(await snapshotOf(database)).toEqual(before);
    });

    it.each([
      ["NULL", null],
      ["empty", ""],
    ])("should never assign a point whose address geometry is %s automatically: held as review_required without a choice", async (_label, geometry) => {
      await seedSplit();
      const noGeometry = await pointAt(OLD_REF, geometry);
      const before = await snapshotOf(database);

      const outcome = await persist(acceptedSplit());

      expect(await snapshotOf(database)).toEqual(before);
      expect(await refOfPoint(noGeometry)).toBe(OLD_REF);
      expect(outcome.load.skipped.map((row) => row.reason)).toEqual([EJES_SKIP_REASON.REVIEW_REQUIRED]);
    });

    it("should never assign a point with no address row automatically: held as review_required without a choice", async () => {
      await seedSplit();
      const missing = await pointAt(OLD_REF, undefined);
      const before = await snapshotOf(database);

      const outcome = await persist(acceptedSplit());

      expect(await snapshotOf(database)).toEqual(before);
      expect(await refOfPoint(missing)).toBe(OLD_REF);
      expect(outcome.load.skipped.map((row) => row.reason)).toEqual([EJES_SKIP_REASON.REVIEW_REQUIRED]);
    });

    it("should apply a split whose point has no geometry once the user chose its piece, moving only that point", async () => {
      await seedSplit();
      const noGeometry = await pointAt(OLD_REF, null);

      await persist(acceptedSplit([{ pointId: String(noGeometry), newRef: "6002" }]));

      expect(await refOfPoint(noGeometry)).toBe("6002");
      expect(await sectionsByRef(6001)).toEqual([]);
    });
  });

  describe("choices that cannot be applied (EJS-16, CHOICE_NOT_APPLICABLE)", () => {
    it("should abort with nothing written when the choice names an automatic point", async () => {
      await seedSplit(["0:52", "48:100"]);
      const automatic = await pointAt(OLD_REF, "10:10");
      await pointAt(OLD_REF, "43.001:43.001");
      const before = await snapshotOf(database);

      await expect(persist(acceptedSplit([{ pointId: String(automatic), newRef: "6003" }]))).rejects.toThrow(CHOICE_NOT_APPLICABLE_MESSAGE);

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
    });

    it("should abort with nothing written when the chosen piece is not one of the split's pieces", async () => {
      await seedSplit(["0:52", "48:100"]);
      const ambiguous = await pointAt(OLD_REF, "43.001:43.001");
      const before = await snapshotOf(database);

      await expect(persist(acceptedSplit([{ pointId: String(ambiguous), newRef: "9999" }]))).rejects.toThrow(CHOICE_NOT_APPLICABLE_MESSAGE);

      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should abort with nothing written when the choice names a point of another section", async () => {
      await seedSplit(["0:52", "48:100"]);
      await pointAt(OLD_REF, "43.001:43.001");
      const elsewhere = await pointAt("7001", "43:43");
      const before = await snapshotOf(database);

      await expect(persist(acceptedSplit([{ pointId: String(elsewhere), newRef: "6003" }]))).rejects.toThrow(CHOICE_NOT_APPLICABLE_MESSAGE);

      expect(await snapshotOf(database)).toEqual(before);
    });

    it("should abort with nothing written when the accepted split is held, even with a choice for its review point", async () => {
      await seedSplit();
      const ambiguousOnHeld = await pointAt(OLD_REF, null);
      const linked = await rowsOf<{ id: number }>(database, "SELECT id FROM carto.road_section WHERE reftramo_ideuy = 6001");
      await insertPoints(database, String(linked[0].id), 1);
      const before = await snapshotOf(database);

      await expect(persist(acceptedSplit([{ pointId: String(ambiguousOnHeld), newRef: "6002" }]))).rejects.toThrow(CHOICE_NOT_APPLICABLE_MESSAGE);

      expect(await snapshotOf(database)).toEqual(before);
    });
  });

  describe("accepted splits that are no longer the analysis (ANALYSIS_CHANGED)", () => {
    it("should abort before any write when the accepted split is not in the analysis", async () => {
      await seedSplit();
      await pointAt(OLD_REF, "10:10");
      const before = await snapshotOf(database);

      await expect(persist({ splits: [{ oldRef: "9999", choices: [] }], plainRemovals: [], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false })).rejects.toThrow(ANALYSIS_CHANGED_MESSAGE);

      expect(await snapshotOf(database)).toEqual(before);
      expect(await backupFiles()).toEqual([]);
    });
  });

  describe("points that are not held by the old reftramo (EJS-8)", () => {
    it("should hold the split with points_by_id, and never delete its old section, when a point is linked by road_section.id", async () => {
      await seedSplit();
      const sectionId = Number((await sectionsByRef(6001))[0].id);
      const linked = await pointAt(String(sectionId), "10:10");
      const before = await snapshotOf(database);

      const outcome = await persist(acceptedSplit());

      expect(await snapshotOf(database)).toEqual(before);
      expect(await refOfPoint(linked)).toBe(String(sectionId));
      expect(outcome.load.skipped).toEqual([
        {
          kind: EJES_SKIP_KIND.SPLIT,
          refs: [OLD_REF],
          newRefs: ["6002", "6003"],
          idcalle: "30",
          points: 1,
          reason: EJES_SKIP_REASON.ID_LINKED_POINTS,
        },
      ]);
    });
  });
});
