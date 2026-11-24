import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PIECE_COVER_TOLERANCE_M } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesAnalysis, EjesStoredReviewPoint } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { readAnalysis } from "@/modules/routine-jobs/jobs/ejes-calles/services/readEjesAnalysis";
import { ejesLayouts } from "./ejesFixtures";
import {
  createEjesDatabase,
  insertAddress,
  insertPoints,
  insertSection,
  insertStaging,
  insertWay,
  sessionOn,
} from "./ejesLoadHarness";

const tempRoot = vi.hoisted(() => ({ directory: "" }));

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, default: { ...actual, tmpdir: () => tempRoot.directory } };
});

const HOOK_TIMEOUT_MS = 60_000;
const STREET = 30;

/** The review points the analysis stores for the dry-run screen (the analysis object carries them; the job result strips them). */
const reviewPointsOf = (analysis: EjesAnalysis): EjesStoredReviewPoint[] =>
  (analysis as EjesAnalysis & { reviewPoints: EjesStoredReviewPoint[] }).reviewPoints;

describe("piece rules of the analysis on PGlite (EJ-10, EJS-3, EJS-17, EJS-21)", () => {
  let database: PGlite;
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "gis-ejes-pieces-"));
    tempRoot.directory = directory;
    database = await createEjesDatabase(PGlite);
  }, HOOK_TIMEOUT_MS);

  afterEach(async () => {
    vi.unstubAllEnvs();
    await database.close();
    await rm(directory, { recursive: true, force: true });
  }, HOOK_TIMEOUT_MS);

  const analysis = async (): Promise<EjesAnalysis> => readAnalysis(sessionOn(database), ejesLayouts());

  const pointAt = async (ref: string, geometry: string): Promise<number> => {
    const [id] = await insertPoints(database, ref, 1);
    await insertAddress(database, id, geometry);
    return id;
  };

  describe("a partly covered neighbour is a second piece only above 35% of its own length (EJ-10)", () => {
    it("should split an old section into two pieces, not a replacement, when the second piece covers 38% of its own length", async () => {
      await insertWay(database, STREET, "CALLE TREINTA");
      await insertSection(database, { ref: 6001, calle: STREET, geom: "0:100", distance: "100.00" });
      await insertStaging(database, [
        { ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: "0:97" },
        { ref: "6003", calle: "30", nombre: "CALLE TREINTA", geom: "82:132" },
      ]);

      const result = await analysis();

      expect(result.splits.map((row) => [row.oldRef, row.newRefs])).toEqual([["6001", ["6002", "6003"]]]);
      expect(result.merges).toEqual([]);
    });
  });

  describe("a fully replaced old section keeps its replacement when a partly covered neighbour does not claim its piece (EJ-10)", () => {
    it("should keep the old section 6001 as a one-piece replacement and list the partly covered neighbour 6004 as plain", async () => {
      await insertWay(database, STREET, "CALLE TREINTA");
      await insertSection(database, { ref: 6001, calle: STREET, geom: "0:100", distance: "100.00" });
      await insertSection(database, { ref: 6004, calle: STREET, geom: "88:188", distance: "100.00" });
      await insertStaging(database, [{ ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: "0:140" }]);

      const result = await analysis();

      expect(result.splits.map((row) => [row.oldRef, row.newRefs])).toEqual([["6001", ["6002"]]]);
      expect(result.plainRemovals.map((row) => row.ref)).toEqual(["6004"]);
      expect(result.merges).toEqual([]);
    });
  });

  describe("a merge of two halves into one new section stays a merge (EJ-10)", () => {
    it("should list 6101 and 6102 as the merge of 6103 and no split or plain removal", async () => {
      await insertWay(database, 7, "CALLE SIETE");
      await insertSection(database, { ref: 6101, calle: 7, geom: "0:50", distance: "50.00" });
      await insertSection(database, { ref: 6102, calle: 7, geom: "50:100", distance: "50.00" });
      await insertStaging(database, [{ ref: "6103", calle: "7", nombre: "CALLE SIETE", geom: "0:100" }]);

      const result = await analysis();

      expect(result.merges.map((row) => [row.newRef, row.oldRefs])).toEqual([["6103", ["6101", "6102"]]]);
      expect(result.splits).toEqual([]);
      expect(result.plainRemovals).toEqual([]);
    });
  });

  describe("automatic replacement points more than 25 m farther than their old section go to review (EJS-21)", () => {
    /** Old section 6001 (0:2000) and the one piece 6002 with the given geometry; the points are added by the caller. */
    const seedReplacement = async (pieceGeometry: string): Promise<void> => {
      await insertWay(database, STREET, "CALLE TREINTA");
      await insertSection(database, { ref: 6001, calle: STREET, geom: "0:2000", distance: "2000.00" });
      await insertStaging(database, [{ ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: pieceGeometry }]);
    };

    it("should send a point 100 m from the piece and 10 m from the old section to review as ambiguous", async () => {
      await seedReplacement("0:1910");
      const point = await pointAt("6001", "2010:2010");

      const result = await analysis();
      const row = result.splits[0];

      expect(row.oldRef).toBe("6001");
      expect(row.reviewPoints).toBe(1);
      expect(row.autoPoints).toBe(0);
      expect(reviewPointsOf(result).find((candidate) => candidate.pointId === String(point))?.reason).toBe("ambiguous");
    });

    it("should keep a point 12 m from both the piece and the old section automatic", async () => {
      await seedReplacement("1:2000");
      await pointAt("6001", "2012:2012");

      const row = (await analysis()).splits[0];

      expect(row.autoPoints).toBe(1);
      expect(row.reviewPoints).toBe(0);
    });

    it("should keep a point exactly 25 m farther from the piece than from the old section automatic", async () => {
      await seedReplacement("0:1975");
      await pointAt("6001", "2010:2010");

      const row = (await analysis()).splits[0];

      expect(row.autoPoints).toBe(1);
      expect(row.reviewPoints).toBe(0);
    });

    it("should send a point 26 m farther from the piece than from the old section to review", async () => {
      await seedReplacement("0:1974");
      await pointAt("6001", "2010:2010");

      const row = (await analysis()).splits[0];

      expect(row.reviewPoints).toBe(1);
      expect(row.autoPoints).toBe(0);
    });
  });

  describe(`a new section covering an old one within ${PIECE_COVER_TOLERANCE_M} m is a piece, not within 1 m only (PIECE_COVER_TOLERANCE_M)`, () => {
    it("should replace old 6001 with the one piece 6002 when the piece covers 90% of it at 1 m and all of it at 3 m", async () => {
      await insertWay(database, STREET, "CALLE TREINTA");
      await insertSection(database, { ref: 6001, calle: STREET, geom: "0:10", distance: "10.00" });
      await insertStaging(database, [{ ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: "2:10" }]);

      const result = await analysis();

      expect(result.splits.map((row) => [row.oldRef, row.newRefs])).toEqual([["6001", ["6002"]]]);
      expect(result.plainRemovals).toEqual([]);
      expect(result.merges).toEqual([]);
    });

    it("should split old 6001 into three pieces, each claimed at 3 m but none at 1 m, and assign its points to a piece", async () => {
      await insertWay(database, STREET, "CALLE TREINTA");
      await insertSection(database, { ref: 6001, calle: STREET, geom: "0:30", distance: "30.00" });
      await insertStaging(database, [
        { ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: "2:10" },
        { ref: "6003", calle: "30", nombre: "CALLE TREINTA", geom: "12:20" },
        { ref: "6004", calle: "30", nombre: "CALLE TREINTA", geom: "22:28" },
      ]);
      await pointAt("6001", "6:6");
      await pointAt("6001", "16:16");
      await pointAt("6001", "26:26");

      const result = await analysis();
      const row = result.splits[0];

      expect(result.splits.map((split) => [split.oldRef, split.newRefs])).toEqual([["6001", ["6002", "6003", "6004"]]]);
      expect(result.plainRemovals).toEqual([]);
      expect(result.merges).toEqual([]);
      expect(row.autoPoints).toBe(3);
      expect(row.reviewPoints).toBe(0);
    });

    it(`should cover old 6001 when the new piece starts 3 m from its start, inside the ${PIECE_COVER_TOLERANCE_M} m tolerance`, async () => {
      await insertWay(database, STREET, "CALLE TREINTA");
      await insertSection(database, { ref: 6001, calle: STREET, geom: "0:8", distance: "8.00" });
      await insertStaging(database, [{ ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: "3:8" }]);

      const result = await analysis();

      expect(result.splits.map((row) => [row.oldRef, row.newRefs])).toEqual([["6001", ["6002"]]]);
      expect(result.plainRemovals).toEqual([]);
    });

    it(`should not cover old 6001 when the new piece starts 4 m from its start, beyond ${PIECE_COVER_TOLERANCE_M} m, leaving it a plain removal`, async () => {
      await insertWay(database, STREET, "CALLE TREINTA");
      await insertSection(database, { ref: 6001, calle: STREET, geom: "0:8", distance: "8.00" });
      await insertStaging(database, [{ ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: "4:8" }]);

      const result = await analysis();

      expect(result.splits).toEqual([]);
      expect(result.plainRemovals.map((row) => row.ref)).toEqual(["6001"]);
    });

    it("should not renumber old 6001 to a new section of the same street that lies 2 m away (renumber candidate distance 1 m)", async () => {
      await insertWay(database, STREET, "CALLE TREINTA");
      await insertSection(database, { ref: 6001, calle: STREET, geom: "0:100", distance: "100.00" });
      await insertStaging(database, [{ ref: "6002", calle: "30", nombre: "CALLE TREINTA", geom: "102:202" }]);

      const result = await analysis();

      expect(result.renumbered).toEqual([]);
      expect(result.splits).toEqual([]);
      expect(result.plainRemovals.map((row) => row.ref)).toEqual(["6001"]);
    });
  });
});
