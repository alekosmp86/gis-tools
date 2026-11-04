import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SliceBuffer } from "@/modules/coverage-loads/shp/job/reader/fileIo.ts";
import { PROBE_STRIDE, RingMetadata, computeRingMetadata, summarizeRings } from "@/modules/coverage-loads/shp/job/reader/ringMetadata.ts";
import { openShapefile, walkRecords } from "@/modules/coverage-loads/shp/job/reader/shpHeader.ts";
import { buildShp, ccwSquare, cwSquare, makeTempDir, signedArea } from "../helpers/readerTestShp.ts";
import type { RingPts, TempShpDir } from "../helpers/readerTestShp.ts";

vi.setConfig({ testTimeout: 60_000 });

function sliceOf(cap: number): SliceBuffer {
  const buffer = new ArrayBuffer(cap * 16);
  return { bytes: new Uint8Array(buffer), f64: new Float64Array(buffer), pointCapacity: cap };
}

let tmp: TempShpDir;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(async () => {
  await tmp.cleanup();
});

interface Run {
  meta: RingMetadata;
  unclosed: number;
  progress: number[];
  parts: Int32Array;
}

async function run(rings: RingPts[], cap = 65536, signal?: AbortSignal): Promise<Run> {
  const file = await openShapefile(await tmp.write("t.shp", buildShp([rings])));
  try {
    const rec = (await walkRecords(file).next()).value!;
    const meta = new RingMetadata();
    const progress: number[] = [];
    const unclosed = await computeRingMetadata(file, rec, meta, sliceOf(cap), signal, (b) => progress.push(b));
    return { meta, unclosed, progress, parts: rec.parts };
  } finally {
    await file.close();
  }
}

const areaOf = (m: RingMetadata, i: number): number => m.area[i] as number;

function exactSum(values: number[]): number {
  let partials: number[] = [];
  for (let x of values) {
    const next: number[] = [];
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) next.push(lo);
      x = hi;
    }
    next.push(x);
    partials = next;
  }
  return partials.reduceRight((acc, v) => acc + v, 0);
}

describe("computeRingMetadata geometry", () => {
  it("should compute signed area, bbox and probes of a clockwise and a counter-clockwise ring", async () => {
    const r = await run([cwSquare(0, 0, 10), ccwSquare(2, 3, 4)]);

    expect(r.unclosed).toBe(0);
    expect(areaOf(r.meta, 0)).toBe(-100);
    expect(areaOf(r.meta, 1)).toBe(16);
    expect([r.meta.minX[1], r.meta.minY[1], r.meta.maxX[1], r.meta.maxY[1]]).toEqual([2, 3, 6, 7]);
    expect(Array.from(r.meta.probes.subarray(PROBE_STRIDE, 2 * PROBE_STRIDE))).toEqual([2, 3, 6, 3, 6, 7, 2, 7]);
  });

  it("should reset bbox and area state between consecutive rings", async () => {
    const r = await run([cwSquare(100, 100, 5), cwSquare(0, 0, 2)]);

    expect([r.meta.minX[1], r.meta.minY[1], r.meta.maxX[1], r.meta.maxY[1]]).toEqual([0, 0, 2, 2]);
    expect(areaOf(r.meta, 1)).toBe(-4);
  });

  it("should give exactly zero area for a collinear closed ring", async () => {
    const r = await run([[[0, 0], [1, 0], [2, 0], [0, 0]], [[0, 0], [1, 1], [2, 2], [3, 3], [0, 0]]]);

    expect(areaOf(r.meta, 0)).toBe(0);
    expect(areaOf(r.meta, 1)).toBe(0);
    expect(r.unclosed).toBe(0);
  });

  it("should leave a single-point repeated ring with zero area and closed", async () => {
    const r = await run([[[5, 5], [5, 5], [5, 5], [5, 5]]]);

    expect(areaOf(r.meta, 0)).toBe(0);
    expect(r.unclosed).toBe(0);
  });

  it("should count a ring with 4+ points whose last vertex differs only in x as unclosed", async () => {
    const r = await run([[[0, 0], [0, 1], [1, 1], [1, 0]]]);

    expect(r.unclosed).toBe(1);
  });

  it("should count a ring with 4+ points whose last vertex differs only in y as unclosed", async () => {
    const r = await run([[[0, 0], [1, 0], [1, 1], [0, 1]]]);

    expect(r.unclosed).toBe(1);
  });

  it("should not count rings shorter than 4 points as unclosed", async () => {
    const r = await run([[[0, 0], [1, 0], [1, 1]]]);

    expect(r.unclosed).toBe(0);
  });

  it("should sum unclosed rings across the record", async () => {
    const r = await run([[[0, 0], [1, 0], [1, 1], [0, 1]], cwSquare(0, 0, 3), [[5, 5], [6, 5], [6, 6], [5, 6]]]);

    expect(r.unclosed).toBe(2);
  });

  it("should fill probes with only the first 4 vertices for rings with more points", async () => {
    const r = await run([[[0, 0], [1, 0], [2, 0], [3, 0], [3, 3], [0, 3], [0, 0]]]);

    expect(Array.from(r.meta.probes.subarray(0, PROBE_STRIDE))).toEqual([0, 0, 1, 0, 2, 0, 3, 0]);
  });

  it("should reject with an abort error when the signal is aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(run([cwSquare(0, 0, 1)], 65536, ctrl.signal)).rejects.toThrow();
  });

  it("should classify rings through summarizeRings", async () => {
    const r = await run([cwSquare(0, 0, 10), ccwSquare(2, 2, 2), [[0, 0], [1, 0], [2, 0], [0, 0]]]);

    const s = summarizeRings(r.meta, r.parts, r.unclosed);

    expect(s).toMatchObject({ shellCount: 1, holeCount: 1, degenerateCount: 1, unclosedCount: 0 });
    expect(s.netArea).toBe(96);
  });
});

describe("computeRingMetadata multi-slice streaming", () => {
  const rings: RingPts[] = [
    cwSquare(0, 0, 10),
    ccwSquare(2, 2, 3),
    [[0, 0], [1, 0], [1, 1], [0, 1]],
    [[0, 0], [4, 0], [4, 4], [2, 6], [0, 4], [0, 0]],
  ];

  it.each([1, 2, 3, 4, 5, 6, 7, 11])("should match the single-slice result with a capacity of %i points", async (cap) => {
    const ref = await run(rings);

    const r = await run(rings, cap);

    expect(r.unclosed).toBe(ref.unclosed);
    for (const key of ["area", "minX", "minY", "maxX", "maxY"] as const) {
      expect(Array.from(r.meta[key].subarray(0, 4))).toEqual(Array.from(ref.meta[key].subarray(0, 4)));
    }
    expect(Array.from(r.meta.probes.subarray(0, 4 * PROBE_STRIDE))).toEqual(
      Array.from(ref.meta.probes.subarray(0, 4 * PROBE_STRIDE)),
    );
  });

  it("should report progress once per slice with the byte offset reached", async () => {
    const r = await run([cwSquare(0, 0, 10)], 2);

    expect(r.progress.length).toBe(3);
    expect(r.progress[1]! - r.progress[0]!).toBe(32);
    expect(r.progress[2]! - r.progress[1]!).toBe(16);
  });

  it("should process a ring larger than the default slice capacity", async () => {
    const n = 65536 * 2 + 77;
    const pts: RingPts = [];
    for (let i = 0; i < n; i++) {
      const a = -(2 * Math.PI * i) / n;
      pts.push([100 * Math.cos(a), 100 * Math.sin(a)]);
    }
    pts.push([pts[0]![0], pts[0]![1]]);

    const r = await run([pts, ccwSquare(0, 0, 1)]);

    expect(r.unclosed).toBe(0);
    expect(areaOf(r.meta, 0)).toBeCloseTo(-0.5 * n * 100 * 100 * Math.sin((2 * Math.PI) / n), 6);
    expect(areaOf(r.meta, 1)).toBe(1);
    expect(r.meta.maxX[0]).toBeCloseTo(100, 6);
  });
});

describe("computeRingMetadata Kahan summation", () => {
  function noisyStar(n: number): RingPts {
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const pts: RingPts = [];
    for (let i = 0; i < n; i++) {
      const a = -(2 * Math.PI * i) / n;
      const rad = 1000 * (0.5 + rnd());
      pts.push([123456.789 + rad * Math.cos(a), 654321.123 + rad * Math.sin(a)]);
    }
    pts.push([pts[0]![0], pts[0]![1]]);
    return pts;
  }

  it("should match an exactly summed shoelace within one ulp on 200k points", async () => {
    const pts = noisyStar(200_000);
    const [x0, y0] = pts[0]!;
    const terms: number[] = [];
    let prx = 0;
    let pry = 0;
    for (let i = 1; i < pts.length; i++) {
      const rx = pts[i]![0] - x0;
      const ry = pts[i]![1] - y0;
      terms.push(prx * ry - rx * pry);
      prx = rx;
      pry = ry;
    }
    const exact = 0.5 * exactSum(terms);

    const r = await run([pts]);

    expect(Math.abs(areaOf(r.meta, 0) - exact)).toBeLessThanOrEqual(Math.abs(exact) * 2.3e-16);
  });

  it("should stay close to a simple shoelace on a well-conditioned ring", async () => {
    const pts = noisyStar(5000);

    const r = await run([pts]);

    expect(areaOf(r.meta, 0)).toBeCloseTo(signedArea(pts), 3);
  });

  it("should sum many tiny terms that a naive accumulator would drop next to a huge one", async () => {
    const huge: RingPts = [[0, 0], [0, 1e8], [1e8, 1e8], [1e8, 0]];
    const pts: RingPts = [...huge];
    const steps = 20_000;
    for (let i = 1; i <= steps; i++) pts.push([1e8 - (i * 1e8) / steps, 0.0001 * (i % 3)]);
    pts.push([0, 0]);
    const [x0, y0] = pts[0]!;
    const terms: number[] = [];
    let prx = 0;
    let pry = 0;
    for (let i = 1; i < pts.length; i++) {
      const rx = pts[i]![0] - x0;
      const ry = pts[i]![1] - y0;
      terms.push(prx * ry - rx * pry);
      prx = rx;
      pry = ry;
    }
    const exact = 0.5 * exactSum(terms);

    const r = await run([pts]);

    expect(Math.abs(areaOf(r.meta, 0) - exact)).toBeLessThanOrEqual(Math.abs(exact) * 2.3e-16);
  });
});
