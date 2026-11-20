import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COVERAGE_RATIO, PIECE_OWN_FRACTION, SPLIT_PIECE_MIN_COVER_M } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { isPieceSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/pieceSql";

const HOOK_TIMEOUT_MS = 60_000;

describe("isPieceSql boundaries (EJ-10, SPLIT_PIECE_MIN_COVER_M, PIECE_OWN_FRACTION, COVERAGE_RATIO)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  /** Evaluates the predicate in PostgreSQL on exact numerics: all three arguments are SQL numeric literals, in metres. */
  const isPiece = async (covered: string, oldLength: string, newLength: string): Promise<boolean> => {
    const result = await database.query<{ piece: boolean }>(`SELECT ${isPieceSql(covered, oldLength, newLength)} AS piece`);
    return result.rows[0].piece;
  };

  it("should use a 10 m minimum cover, a 35% own-length share and a 95% ratio", () => {
    expect(SPLIT_PIECE_MIN_COVER_M).toBe(10);
    expect(PIECE_OWN_FRACTION).toBe(0.35);
    expect(COVERAGE_RATIO).toBe(0.95);
  });

  describe("rule A: absorbs COVERAGE_RATIO of the old section (stubs included)", () => {
    it("should count 95% of a 2 m stub as a piece, at the ratio boundary", async () => {
      expect(await isPiece("1.9", "2", "50")).toBe(true);
    }, HOOK_TIMEOUT_MS);

    it("should not count 94% of a 2 m stub as a piece, just below the ratio", async () => {
      expect(await isPiece("1.88", "2", "50")).toBe(false);
    });

    it("should count a 1.5 m stub covered in full as a piece, through the ratio", async () => {
      expect(await isPiece("1.5", "1.5", "50")).toBe(true);
    });

    it("should count a 1 m stub covered in full as a piece", async () => {
      expect(await isPiece("1", "1", "50")).toBe(true);
    });

    it("should count 2.5 m of cover as a piece on a 2.6 m section, through the 95% ratio", async () => {
      expect(await isPiece("2.5", "2.6", "50")).toBe(true);
    });

    it("should count 95% of a 10 m section as a piece, at the ratio boundary", async () => {
      expect(await isPiece("9.5", "10", "10")).toBe(true);
    });

    it("should not count 9.4 m of a 10 m section as a piece, below both the 95% ratio and the 10 m minimum", async () => {
      expect(await isPiece("9.4", "10", "10")).toBe(false);
    });

    it("should count 95% of a 1000 m section as a piece, through the ratio alone", async () => {
      expect(await isPiece("950", "1000", "2000")).toBe(true);
    });

    it("should not count 94% of a 1000 m section as a piece, just below the ratio", async () => {
      expect(await isPiece("940", "1000", "10000")).toBe(false);
    });
  });

  describe("touching neighbours and short overlaps", () => {
    it("should not count a 1.9 m overlap of a 10 m section as a piece", async () => {
      expect(await isPiece("1.9", "10", "10")).toBe(false);
    });

    it("should not count a 1.05 m touching neighbour on a 10 m section as a piece", async () => {
      expect(await isPiece("1.05", "10", "10")).toBe(false);
    });

    it("should not count a 1 m touching neighbour on a 10 m section as a piece", async () => {
      expect(await isPiece("1", "10", "10")).toBe(false);
    });

    it("should count nothing for a zero cover", async () => {
      expect(await isPiece("0", "10", "10")).toBe(false);
    });
  });

  describe("rule B: covers more than SPLIT_PIECE_MIN_COVER_M and at least PIECE_OWN_FRACTION of its own length", () => {
    it("should not count a neighbour that covers exactly 10 m of a long section as a piece, the minimum is strict", async () => {
      expect(await isPiece("10", "1000", "15")).toBe(false);
    });

    it("should count a neighbour that covers just over 10 m with at least 50% of its own length as a piece", async () => {
      expect(await isPiece("10.01", "1000", "20")).toBe(true);
    });

    it("should not count a neighbour that covers just over 10 m but under 35% of its own length as a piece", async () => {
      expect(await isPiece("10.01", "1000", "30")).toBe(false);
    });

    it("should not count a neighbour covering 34% of its own length as a piece, just below the 35% share", async () => {
      expect(await isPiece("34", "1000", "100")).toBe(false);
    });

    it("should count a neighbour covering 36% of its own length as a piece, just above the 35% share", async () => {
      expect(await isPiece("36", "1000", "100")).toBe(true);
    });

    it("should count a 38% overlap of a 100 m new section as a piece, the 38% share clears the 35% limit", async () => {
      expect(await isPiece("38", "100", "100")).toBe(true);
    });

    it("should not count a neighbour with 4.0 m of overlap on a long old section as a piece (dev, new 707 m over old 7648 m)", async () => {
      expect(await isPiece("4.0", "7648", "707")).toBe(false);
    });

    it("should not count a neighbour with 5.0 m of overlap on a long old section as a piece (dev, new 71 m over old 3594 m)", async () => {
      expect(await isPiece("5.0", "3594", "71")).toBe(false);
    });

    it("should count a real piece with 72 m of overlap on a 71 m new section as a piece", async () => {
      expect(await isPiece("72", "3594", "71")).toBe(true);
    });

    it("should not count a long new section covering 60 m of a 100 m old section as a piece (60% of old, 6% of its own length)", async () => {
      expect(await isPiece("60", "100", "1000")).toBe(false);
    });
  });
});
