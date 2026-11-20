import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStepTimer } from "@/modules/routine-jobs/jobs/cargar-padrones/services/runSteps";
import { EJES_SKIP_KIND, EJES_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesAnalysis, EjesAccepted, EjesStoredReviewPoint } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { runEjesPersistTransaction } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeEjesSteps";
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
  sessionOn,
  summaryOn,
} from "./ejesLoadHarness";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;
const OLD_REF = "6001";
const timer = () => createStepTimer({ now: () => 0, total: 20 });

/** The review points the analysis stores for the dry-run screen (the analysis object carries them; the job result strips them). */
const reviewPointsOf = (analysis: EjesAnalysis): EjesStoredReviewPoint[] =>
  (analysis as EjesAnalysis & { reviewPoints: EjesStoredReviewPoint[] }).reviewPoints;

describe("split review points of the analysis on PGlite (EJS-6, EJS-7, EJS-8, EJS-16)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    vi.stubEnv("EJES_CALLES_REAL_RUN_ENABLED", "true");
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-review-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  /** Old section 6001 (0:100) and two overlapping pieces: 6002 (0:52) and 6003 (48:100). */
  const seedSplit = async (): Promise<void> => {
    await insertWay(database, 30, "CALLE TREINTA");
    await database.query("INSERT INTO carto.addresses_master (addresses_master_id, urn, latitud, longitud) VALUES (6001, 'seed', 0, 0)");
    await insertSection(database, { ref: 6001, calle: 30, geom: "0:100", distance: "100.00", master: 6001 });
    await insertStaging(database, [
      { ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: "0:52" },
      { ref: "6003", calle: "30", nombre: "CALLE TREINTA", geom: "48:100" },
    ]);
  };

  const pointAt = async (ref: string | null, geometry: string | null | undefined): Promise<number> => {
    const [id] = await insertPoints(database, ref, 1);
    if (geometry !== undefined) await insertAddress(database, id, geometry);
    return id;
  };

  const analysis = async (): Promise<EjesAnalysis> => readAnalysis(sessionOn(database), ejesLayouts());

  const persist = async (accepted: EjesAccepted) => {
    const summary = await summaryOn(database);
    const context = await loadContextOn(database);
    return runEjesPersistTransaction(sessionOn(database), { ...paramsWith(summary), accepted }, context, timer());
  };

  it("should store each review point with its candidates ordered nearest first, one candidate per piece", async () => {
    await seedSplit();
    await pointAt(OLD_REF, "10:10");
    const ambiguous = await pointAt(OLD_REF, "43.001:43.001");
    const noGeometry = await pointAt(OLD_REF, null);

    const reviews = reviewPointsOf(await analysis());

    const byId = new Map(reviews.map((point) => [point.pointId, point]));
    const ambiguousPoint = byId.get(String(ambiguous));
    expect(ambiguousPoint?.reason).toBe("ambiguous");
    expect(ambiguousPoint?.candidates.map((candidate) => candidate.newRef)).toEqual(["6002", "6003"]);
    expect(ambiguousPoint?.candidates.map((candidate) => candidate.distance)).toEqual([0, 5]);
    expect(ambiguousPoint?.suggestedRef).toBe("6002");
    expect(byId.get(String(noGeometry))?.reason).toBe("no_geometry");
    expect(reviews.every((point) => new Set(point.candidates.map((candidate) => candidate.newRef)).size === point.candidates.length)).toBe(true);
  });

  it("should give a no_geometry review point no distance and no suggestion (EJS-7)", async () => {
    await seedSplit();
    await pointAt(OLD_REF, "10:10");
    const noGeometry = await pointAt(OLD_REF, null);

    const point = reviewPointsOf(await analysis()).find((candidate) => candidate.pointId === String(noGeometry));

    expect(point?.suggestedRef).toBeNull();
    expect(point?.candidates.every((candidate) => candidate.distance === null)).toBe(true);
  });

  it("should not store a review point of an automatic point (EJS-5)", async () => {
    await seedSplit();
    const automatic = await pointAt(OLD_REF, "10:10");

    expect(reviewPointsOf(await analysis()).map((point) => point.pointId)).not.toContain(String(automatic));
  });

  it("should flag a clean split as having a held reason of null and a complete review (EJS-6)", async () => {
    await seedSplit();
    await pointAt(OLD_REF, "10:10");

    const row = (await analysis()).splits[0];

    expect(row.heldReason).toBeNull();
    expect(row.incompleteReview).toBe(false);
  });

  it("should give the analysis the same hold reason the load skips the split with (points_by_id)", async () => {
    await seedSplit();
    const sectionId = Number((await database.query<{ id: number }>("SELECT id FROM carto.road_section WHERE reftramo_ideuy = 6001")).rows[0].id);
    await pointAt(String(sectionId), "10:10");

    const row = (await analysis()).splits[0];
    const outcome = await persist({ splits: [{ oldRef: OLD_REF, choices: [] }], plainRemovals: [], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false });

    expect(row.heldReason).toBe(EJES_SKIP_REASON.ID_LINKED_POINTS);
    expect(outcome.load.skipped).toEqual([
      expect.objectContaining({ kind: EJES_SKIP_KIND.SPLIT, reason: row.heldReason }),
    ]);
  });

  it("should give the analysis no hold reason for a split the user has not accepted yet, which the load skips as not_accepted", async () => {
    await seedSplit();
    await pointAt(OLD_REF, "10:10");

    const row = (await analysis()).splits[0];
    const outcome = await persist({ splits: [], plainRemovals: [], merges: [], twinRemovals: [], twinPicks: [], manualSplits: [], autoPlainRemovals: false });

    expect(row.heldReason).toBeNull();
    expect(outcome.load.skipped).toEqual([expect.objectContaining({ kind: EJES_SKIP_KIND.SPLIT, reason: EJES_SKIP_REASON.NOT_ACCEPTED })]);
  });

  it("should give the split a null hold reason for a split with an ambiguous point that is only a review, not a hold (EJS-5)", async () => {
    await seedSplit();
    await pointAt(OLD_REF, "43.001:43.001");

    const row = (await analysis()).splits[0];

    expect(row.reviewPoints).toBe(1);
    expect(row.heldReason).toBeNull();
    expect(row.incompleteReview).toBe(false);
  });
});
