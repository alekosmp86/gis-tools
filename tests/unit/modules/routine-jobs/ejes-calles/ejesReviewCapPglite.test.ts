import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import type { EjesAnalysis, EjesStoredReviewPoint } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { ejesLayouts } from "./ejesFixtures";
import { createEjesDatabase, insertAddress, insertPoints, insertSection, insertStaging, insertWay, sessionOn } from "./ejesLoadHarness";

vi.mock("@/modules/routine-jobs/jobs/ejes-calles/constants", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/routine-jobs/jobs/ejes-calles/constants")>()),
  REVIEW_POINTS_STORE_LIMIT: 1,
}));

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;

const reviewPointsOf = (analysis: EjesAnalysis): EjesStoredReviewPoint[] =>
  (analysis as EjesAnalysis & { reviewPoints: EjesStoredReviewPoint[] }).reviewPoints;

describe("review points kept per dry run, capped at REVIEW_POINTS_STORE_LIMIT (EJS-6)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-cap-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
    await insertWay(database, 30, "CALLE TREINTA");
    await insertSection(database, { ref: 6001, calle: 30, geom: "0:100", distance: "100.00" });
    await insertStaging(database, [
      { ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: "0:52" },
      { ref: "6003", calle: "30", nombre: "CALLE TREINTA", geom: "48:100" },
    ]);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const pointAt = async (geometry: string | null | undefined): Promise<number> => {
    const [id] = await insertPoints(database, "6001", 1);
    if (geometry !== undefined) await insertAddress(database, id, geometry);
    return id;
  };

  it("should not store the review points of a split whose points pass the limit, and flag it incomplete", async () => {
    await pointAt("43.001:43.001");
    await pointAt(null);

    const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

    expect(reviewPointsOf(analysis)).toEqual([]);
    expect(analysis.splits[0].incompleteReview).toBe(true);
  });

  it("should store every review point of a split that fits the limit exactly, complete", async () => {
    await pointAt("43.001:43.001");

    const analysis = await readAnalysis(sessionOn(database), ejesLayouts());

    expect(reviewPointsOf(analysis).map((point) => point.reason)).toEqual(["ambiguous"]);
    expect(analysis.splits[0].incompleteReview).toBe(false);
  });
});
