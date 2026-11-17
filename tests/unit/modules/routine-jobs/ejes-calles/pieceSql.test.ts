import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COVERAGE_RATIO, SPLIT_PIECE_MIN_COVER_M } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { isPieceSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/pieceSql";

const HOOK_TIMEOUT_MS = 60_000;

describe("isPieceSql boundaries (EJ-10, SPLIT_PIECE_MIN_COVER_M, COVERAGE_RATIO)", () => {
  let database: PGlite;

  beforeAll(async () => {
    database = new PGlite();
  }, HOOK_TIMEOUT_MS);

  afterAll(async () => {
    await database.close();
  }, HOOK_TIMEOUT_MS);

  /** Evaluates the predicate in PostgreSQL on exact numerics: `covered` and `length` are SQL numeric literals, in metres. */
  const isPiece = async (covered: string, length: string): Promise<boolean> => {
    const result = await database.query<{ piece: boolean }>(`SELECT ${isPieceSql(covered, length)} AS piece`);
    return result.rows[0].piece;
  };

  it("should use a 2 m minimum cover and a 95% ratio for short sections", () => {
    expect(SPLIT_PIECE_MIN_COVER_M).toBe(2);
    expect(COVERAGE_RATIO).toBe(0.95);
  });

  it("should not count a neighbour that covers exactly 2 m of a long section as a piece", async () => {
    expect(await isPiece("2", "50")).toBe(false);
  }, HOOK_TIMEOUT_MS);

  it("should count a neighbour that covers just over 2 m of a long section as a piece", async () => {
    expect(await isPiece("2.01", "50")).toBe(true);
  });

  it("should count a 1.5 m stub covered in full (1.5 m of 1.5 m) as a piece, through the ratio", async () => {
    expect(await isPiece("1.5", "1.5")).toBe(true);
  });

  it("should count a 1 m stub covered in full as a piece", async () => {
    expect(await isPiece("1", "1")).toBe(true);
  });

  it("should not count a 1.05 m touching neighbour on a 10 m section as a piece", async () => {
    expect(await isPiece("1.05", "10")).toBe(false);
  });

  it("should not count a 1 m touching neighbour on a 10 m section as a piece", async () => {
    expect(await isPiece("1", "10")).toBe(false);
  });

  it("should count 95% of a 2 m stub as a piece, at the ratio boundary", async () => {
    expect(await isPiece("1.9", "2")).toBe(true);
  });

  it("should not count 94% of a 2 m stub as a piece, just below the ratio", async () => {
    expect(await isPiece("1.88", "2")).toBe(false);
  });

  it("should count 95% of a 10 m section as a piece, at the ratio boundary", async () => {
    expect(await isPiece("9.5", "10")).toBe(true);
  });

  it("should count 9.4 m of a 10 m section as a piece, since above 2 m the ratio is not needed", async () => {
    expect(await isPiece("9.4", "10")).toBe(true);
  });

  it("should not count 9.4 m of a 10 m section as a piece through the ratio alone, the ratio rule is for short sections", async () => {
    expect(await isPiece("1.9", "10")).toBe(false);
  });

  it("should count nothing for a zero cover", async () => {
    expect(await isPiece("0", "10")).toBe(false);
  });

  it("should count 2.5 m of cover as a piece on a 2.6 m section, above the 2 m minimum", async () => {
    expect(await isPiece("2.5", "2.6")).toBe(true);
  });
});
