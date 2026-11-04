import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileWindow } from "@/modules/coverage-loads/shp/job/reader/fileIo.ts";
import type { SliceBuffer } from "@/modules/coverage-loads/shp/job/reader/fileIo.ts";
import { assignHoles } from "@/modules/coverage-loads/shp/job/reader/holeAssignment.ts";
import type { HoleAssignmentResult } from "@/modules/coverage-loads/shp/job/reader/holeAssignment.ts";
import { RingMetadata, computeRingMetadata } from "@/modules/coverage-loads/shp/job/reader/ringMetadata.ts";
import { openShapefile, walkRecords } from "@/modules/coverage-loads/shp/job/reader/shpHeader.ts";
import { buildShp, ccwSquare, cwSquare, makeTempDir } from "../helpers/readerTestShp.ts";
import type { RingPts, TempShpDir } from "../helpers/readerTestShp.ts";

vi.setConfig({ testTimeout: 60_000 });

const DEFAULT_CAP = 65536;

function sliceOf(cap: number): SliceBuffer {
  const buffer = new ArrayBuffer(cap * 16);
  return { bytes: new Uint8Array(buffer), f64: new Float64Array(buffer), pointCapacity: cap };
}

interface Analysis {
  meta: RingMetadata;
  unclosed: number;
  result: HoleAssignmentResult;
  holeShell: number[];
}

let tmp: TempShpDir;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(async () => {
  await tmp.cleanup();
});

async function analyze(rings: RingPts[], cap = DEFAULT_CAP): Promise<Analysis> {
  const path = await tmp.write("t.shp", buildShp([rings]));
  const file = await openShapefile(path);
  try {
    const rec = (await walkRecords(file).next()).value!;
    const meta = new RingMetadata();
    const slice = sliceOf(cap);
    const unclosed = await computeRingMetadata(file, rec, meta, slice);
    const result = await assignHoles({ fileWindow: new FileWindow(file.fh, file.size), slice }, rec, meta);
    return { meta, unclosed, result, holeShell: Array.from(meta.holeShell.subarray(0, meta.n)) };
  } finally {
    await file.close();
  }
}

describe("assignHoles probe rounds", () => {
  it("should resolve in round 0 when the first edge midpoint is strictly inside", async () => {
    const a = await analyze([cwSquare(0, 0, 100), ccwSquare(10, 10, 10)]);

    expect(a.holeShell).toEqual([-1, 0]);
    expect(a.result).toEqual({ holeCount: 1, ambiguousCount: 0, unassignedCount: 0 });
  });

  it("should retry with edge 1 when the edge 0 midpoint lies on the shell boundary", async () => {
    const a = await analyze([cwSquare(0, 0, 100), ccwSquare(10, 0, 10)]);

    expect(a.holeShell).toEqual([-1, 0]);
    expect(a.result).toEqual({ holeCount: 1, ambiguousCount: 0, unassignedCount: 0 });
    expect(a.meta.boundary[1]).toBe(0);
  });

  it("should retry up to edge 2 when edges 0 and 1 midpoints both lie on the shell boundary", async () => {
    const hole: RingPts = [[10, 0], [20, 0], [30, 0], [30, 10], [10, 10], [10, 0]];

    const a = await analyze([cwSquare(0, 0, 100), hole]);

    expect(a.holeShell).toEqual([-1, 0]);
    expect(a.result).toEqual({ holeCount: 1, ambiguousCount: 0, unassignedCount: 0 });
    expect(a.meta.boundary[1]).toBe(0);
  });

  it("should report ambiguous and keep the best container when every probe touches a boundary", async () => {
    const a = await analyze([cwSquare(-5, -5, 30), cwSquare(0, 0, 10), ccwSquare(0, 0, 10)]);

    expect(a.result).toEqual({ holeCount: 1, ambiguousCount: 1, unassignedCount: 0 });
    expect(a.holeShell[2]).toBe(0);
  });

  it("should retry the next edge only for the holes still pending", async () => {
    const a = await analyze([
      cwSquare(0, 0, 100),
      ccwSquare(10, 10, 10),
      ccwSquare(40, 0, 10),
      cwSquare(200, 0, 100),
      ccwSquare(210, 0, 10),
    ]);

    expect(a.holeShell).toEqual([-1, 0, 0, -1, 3]);
    expect(a.result).toEqual({ holeCount: 3, ambiguousCount: 0, unassignedCount: 0 });
  });
});

describe("assignHoles boundary arithmetic", () => {
  it("should not flag a boundary when the probe is collinear with a shell edge but outside its x range", async () => {
    const hole: RingPts = [[18, 0], [20, 0], [22, 0], [24, 0], [24, 4], [18, 4], [18, 0]];

    const a = await analyze([cwSquare(0, 0, 10), cwSquare(15, -5, 20), hole]);

    expect(a.holeShell[2]).toBe(1);
    expect(a.result).toEqual({ holeCount: 1, ambiguousCount: 0, unassignedCount: 0 });
    expect(a.meta.boundary[2]).toBe(0);
  });

  it("should treat a probe exactly on a shell vertex as boundary and retry to the smaller shell", async () => {
    const hole: RingPts = [[-5, 0], [5, 0], [5, 5], [-5, 5], [-5, 0]];

    const a = await analyze([cwSquare(-20, -20, 60), cwSquare(0, 0, 10), hole]);

    expect(a.holeShell[2]).toBe(1);
    expect(a.result.ambiguousCount).toBe(0);
    expect(a.result.unassignedCount).toBe(0);
  });

  it("should retry to the enclosing shell when the probe lies on the boundary of the smaller shell", async () => {
    const shellLeftToRight: RingPts = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
    const hole: RingPts = [[2, 10], [4, 10], [4, 12], [2, 12], [2, 10]];

    const a = await analyze([shellLeftToRight, cwSquare(-5, -5, 30), hole]);

    expect(a.holeShell[2]).toBe(1);
    expect(a.result).toEqual({ holeCount: 1, ambiguousCount: 0, unassignedCount: 0 });
  });

  it("should count winding for a shell edge crossing the probe scanline in both directions", async () => {
    const a = await analyze([cwSquare(0, 0, 100), ccwSquare(30, 30, 1), ccwSquare(70, 70, 1)]);

    expect(a.holeShell).toEqual([-1, 0, 0]);
  });

  it("should choose the smallest strictly containing shell among nested shells", async () => {
    const a = await analyze([cwSquare(0, 0, 100), cwSquare(10, 10, 50), cwSquare(20, 20, 10), ccwSquare(22, 22, 2)]);

    expect(a.holeShell[3]).toBe(2);
  });
});

describe("assignHoles unresolved holes", () => {
  it("should leave holeShell at -1 and count unassigned when the hole is outside every shell", async () => {
    const a = await analyze([cwSquare(0, 0, 10), ccwSquare(50, 50, 2)]);

    expect(a.holeShell).toEqual([-1, -1]);
    expect(a.result).toEqual({ holeCount: 1, ambiguousCount: 0, unassignedCount: 1 });
  });

  it("should count unassigned for a hole whose probe bbox overlaps a shell bbox but is outside it", async () => {
    const lShell: RingPts = [[0, 0], [0, 10], [4, 10], [4, 4], [10, 4], [10, 0], [0, 0]];

    const a = await analyze([lShell, ccwSquare(7, 7, 2)]);

    expect(a.holeShell).toEqual([-1, -1]);
    expect(a.result.unassignedCount).toBe(1);
  });

  it("should mix assigned, ambiguous and unassigned holes in a single record", async () => {
    const a = await analyze([
      cwSquare(-5, -5, 30),
      cwSquare(0, 0, 10),
      ccwSquare(0, 0, 10),
      ccwSquare(2, 2, 2),
      ccwSquare(500, 500, 2),
    ]);

    expect(a.result).toEqual({ holeCount: 3, ambiguousCount: 1, unassignedCount: 1 });
    expect(a.holeShell[2]).toBe(0);
    expect(a.holeShell[3]).toBe(1);
    expect(a.holeShell[4]).toBe(-1);
  });

  it("should return zero counts when the record has no holes", async () => {
    const a = await analyze([cwSquare(0, 0, 10)]);

    expect(a.result).toEqual({ holeCount: 0, ambiguousCount: 0, unassignedCount: 0 });
  });

  it("should ignore rings with fewer than 4 points as holes", async () => {
    const a = await analyze([cwSquare(0, 0, 10), [[2, 2], [3, 2], [2, 2]]]);

    expect(a.result.holeCount).toBe(0);
  });

  it("should abort when the signal is already aborted", async () => {
    const path = await tmp.write("t.shp", buildShp([[cwSquare(0, 0, 100), ccwSquare(10, 10, 10)]]));
    const file = await openShapefile(path);
    try {
      const rec = (await walkRecords(file).next()).value!;
      const meta = new RingMetadata();
      const slice = sliceOf(DEFAULT_CAP);
      await computeRingMetadata(file, rec, meta, slice);
      const ctrl = new AbortController();
      ctrl.abort();

      await expect(
        assignHoles({ fileWindow: new FileWindow(file.fh, file.size), slice, signal: ctrl.signal }, rec, meta),
      ).rejects.toThrow();
    } finally {
      await file.close();
    }
  });
});

describe("assignHoles multi-slice streaming", () => {
  const bigShell = (n: number): RingPts => {
    const pts: RingPts = [];
    for (let i = 0; i < n; i++) {
      const a = -(2 * Math.PI * i) / n;
      pts.push([1000 * Math.cos(a), 1000 * Math.sin(a)]);
    }
    pts.push([pts[0]![0], pts[0]![1]]);
    return pts;
  };

  it.each([1, 2, 3, 7])("should give the same result with a slice capacity of %i points", async (cap) => {
    const rings = [cwSquare(0, 0, 100), ccwSquare(10, 10, 10), ccwSquare(30, 0, 10), cwSquare(200, 0, 100), ccwSquare(210, 0, 10)];

    const small = await analyze(rings, cap);
    const big = await analyze(rings);

    expect(small.holeShell).toEqual(big.holeShell);
    expect(small.result).toEqual(big.result);
    expect(Array.from(small.meta.area.subarray(0, 5))).toEqual(Array.from(big.meta.area.subarray(0, 5)));
  });

  it("should assign a hole to a shell larger than one default slice", async () => {
    const shell = bigShell(DEFAULT_CAP * 2 + 123);

    const a = await analyze([shell, ccwSquare(-5, -5, 10)]);

    expect(a.meta.n).toBe(2);
    expect(a.holeShell).toEqual([-1, 0]);
    expect(a.result).toEqual({ holeCount: 1, ambiguousCount: 0, unassignedCount: 0 });
  });

  it("should leave a hole outside a shell larger than one default slice unassigned", async () => {
    const a = await analyze([bigShell(DEFAULT_CAP + 10), ccwSquare(5000, 5000, 10)]);

    expect(a.holeShell).toEqual([-1, -1]);
    expect(a.result.unassignedCount).toBe(1);
  });
});
