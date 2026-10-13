import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HoleAssignmentError, iterateRecordEwkb } from "@/modules/coverage-loads/shp/job/reader/index.ts";
import type { EwkbIterationSummary } from "@/modules/coverage-loads/shp/job/reader/index.ts";
import { decodeEwkb, drain, multiArea } from "../helpers/readerTestEwkb.ts";
import type { DecodedMulti } from "../helpers/readerTestEwkb.ts";
import { buildShp, ccwSquare, cwSquare, makeTempDir } from "../helpers/readerTestShp.ts";
import type { TempShpDir } from "../helpers/readerTestShp.ts";

let tmp: TempShpDir;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(async () => {
  await tmp.cleanup();
});

async function decodeSingle(rings: ReturnType<typeof cwSquare>[]): Promise<DecodedMulti> {
  const file = await tmp.write("t.shp", buildShp([rings]));
  const { records } = await drain(iterateRecordEwkb(file));
  return decodeEwkb(records[0]!.bytes).geom as DecodedMulti;
}

describe("hole assignment", () => {
  it("should assign holes to their own shells in a multi-shell record", async () => {
    const g = await decodeSingle([
      cwSquare(0, 0, 100),
      ccwSquare(10, 10, 10),
      cwSquare(200, 0, 100),
      ccwSquare(210, 10, 10),
      ccwSquare(250, 50, 10),
    ]);

    expect(g.polys.map((p) => p.rings.length)).toEqual([2, 3]);
    expect(g.polys[0]!.rings[1]![0]).toEqual([10, 10]);
    expect(g.polys[1]!.rings.map((r) => r[0])).toEqual([[200, 0], [210, 10], [250, 50]]);
    expect(multiArea(g)).toBeCloseTo(10000 - 100 + 10000 - 200, 9);
  });

  it("should nest an island shell inside a hole and give it its own hole", async () => {
    const g = await decodeSingle([
      cwSquare(0, 0, 100),
      ccwSquare(10, 10, 80),
      cwSquare(20, 20, 20),
      ccwSquare(25, 25, 5),
    ]);

    expect(g.polys.map((p) => p.rings.length)).toEqual([2, 2]);
    expect(g.polys[0]!.rings[1]![0]).toEqual([10, 10]);
    expect(g.polys[1]!.rings[1]![0]).toEqual([25, 25]);
    expect(multiArea(g)).toBeCloseTo(10000 - 6400 + 400 - 25, 9);
  });

  it("should give the same assignment regardless of ring order in the file", async () => {
    const g = await decodeSingle([
      ccwSquare(25, 25, 5),
      ccwSquare(10, 10, 80),
      cwSquare(20, 20, 20),
      cwSquare(0, 0, 100),
    ]);

    expect(g.polys.map((p) => p.rings.length)).toEqual([2, 2]);
    expect(g.polys[0]!.rings[0]![0]).toEqual([20, 20]);
    expect(g.polys[0]!.rings[1]![0]).toEqual([25, 25]);
    expect(g.polys[1]!.rings[1]![0]).toEqual([10, 10]);
    expect(multiArea(g)).toBeCloseTo(10000 - 6400 + 400 - 25, 9);
  });

  it("should throw HoleAssignmentError before yielding the record when a hole has no containing shell", async () => {
    const file = await tmp.write(
      "t.shp",
      buildShp([[cwSquare(0, 0, 10)], [cwSquare(0, 0, 10), ccwSquare(50, 50, 2), ccwSquare(60, 60, 2)]]),
    );
    const gen = iterateRecordEwkb(file);
    const first = await gen.next();
    expect(first.done).toBe(false);

    const error = await gen.next().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HoleAssignmentError);
    const e = error as HoleAssignmentError;
    expect(e.recordNumber).toBe(2);
    expect(e.holeCount).toBe(2);
    expect(e.unassignedCount).toBe(2);
    expect(e.ambiguousCount).toBe(0);
    expect(e.message).toContain("registro 2");
    expect(e.message).toContain("2 sin anillo exterior");
    expect(e.message).toContain("de 2 huecos");
  });

  it("should throw HoleAssignmentError when a hole stays on a shell boundary through every probe round", async () => {
    const file = await tmp.write(
      "t.shp",
      buildShp([[cwSquare(-5, -5, 30), cwSquare(0, 0, 10), ccwSquare(0, 0, 10)]]),
    );

    const error = await drain(iterateRecordEwkb(file)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HoleAssignmentError);
    const e = error as HoleAssignmentError;
    expect(e.recordNumber).toBe(1);
    expect(e.ambiguousCount).toBe(1);
    expect(e.holeCount).toBe(1);
  });

  it("should throw HoleAssignmentError for a record with holes but no shell", async () => {
    const file = await tmp.write("t.shp", buildShp([[ccwSquare(0, 0, 10)]]));

    const error = await drain(iterateRecordEwkb(file)).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HoleAssignmentError);
    expect((error as HoleAssignmentError).unassignedCount).toBe(1);
  });

  it("should skip and count a record with no valid shell and no holes as empty", async () => {
    const file = await tmp.write("t.shp", buildShp([[[[0, 0], [1, 1], [0, 0]]], [cwSquare(0, 0, 3)]]));

    const { records, summary } = await drain(iterateRecordEwkb(file));

    expect(records.map((r) => r.rec.recordNumber)).toEqual([2]);
    expect((summary as EwkbIterationSummary).emptyRecordCount).toBe(1);
    expect((summary as EwkbIterationSummary).yieldedRecordCount).toBe(1);
  });

  it("should not yield any chunk of the failing record", async () => {
    const file = await tmp.write("t.shp", buildShp([[cwSquare(0, 0, 10), ccwSquare(50, 50, 2)]]));
    const gen = iterateRecordEwkb(file);
    const seen: number[] = [];

    await expect(
      (async () => {
        for await (const r of gen) seen.push(r.recordNumber);
      })(),
    ).rejects.toBeInstanceOf(HoleAssignmentError);

    expect(seen).toEqual([]);
  });
});
