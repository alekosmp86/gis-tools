import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanShapefile } from "@/modules/coverage-loads/shp/job/reader/index.ts";
import { buildShp, ccwSquare, cwCircle, cwSquare, makeTempDir, signedArea } from "../helpers/readerTestShp.ts";
import type { RecordSpec, TempShpDir } from "../helpers/readerTestShp.ts";

vi.setConfig({ testTimeout: 30_000 });

const rec1: RecordSpec = [
  [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]],
  [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],
  [[20, 20], [20, 30], [30, 30], [30, 20], [20, 20]],
  [[10, 6], [10, 8], [8, 8], [8, 6], [10, 6]],
  [[5, 5], [5, 6], [6, 6], [6, 5], [5, 5]],
];

const netOf = (recs: RecordSpec[]): number =>
  -recs.reduce((s, r) => s + (r ?? []).reduce((a, ring) => a + signedArea(ring), 0), 0);

let tmp: TempShpDir;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(async () => {
  await tmp.cleanup();
});

describe("scanShapefile counts", () => {
  it("should count records, nulls, points, rings, shells, holes, degenerate and unclosed rings", async () => {
    const recs: RecordSpec[] = [
      rec1,
      null,
      [cwSquare(0, 0, 5), [[0, 0], [1, 1], [0, 0]]],
      [[[0, 0], [0, 10], [10, 10], [10, 0], [5, 0]]],
    ];
    const shp = buildShp(recs);
    const file = await tmp.write("t.shp", shp);

    const scan = await scanShapefile(file);

    expect(scan.fileSize).toBe(shp.length);
    expect(scan.recordCount).toBe(4);
    expect(scan.nullRecordCount).toBe(1);
    expect(scan.pointCount).toBe(25 + 5 + 3 + 5);
    expect(scan.ringCount).toBe(5 + 2 + 1);
    expect(scan.shellCount).toBe(3 + 1 + 1);
    expect(scan.holeCount).toBe(2);
    expect(scan.degenerateRingCount).toBe(1);
    expect(scan.unclosedRingCount).toBe(1);
    expect(scan.perRecord).toBeUndefined();
  });

  it("should compute netArea as shells minus holes", async () => {
    const recs: RecordSpec[] = [rec1, null, [cwSquare(0, 0, 5)]];
    const file = await tmp.write("t.shp", buildShp([rec1, null, [cwSquare(0, 0, 5)]]));

    const scan = await scanShapefile(file);

    expect(scan.netArea).toBeCloseTo(netOf(recs), 9);
    expect(scan.netArea).toBeCloseTo(193 + 25, 9);
  });

  it("should keep netArea exact for large coordinates with a tiny hole", async () => {
    const recs: RecordSpec[] = [[cwSquare(500000, 6100000, 1000), ccwSquare(500400, 6100400, 1)]];
    const file = await tmp.write("t.shp", buildShp(recs));

    const scan = await scanShapefile(file);

    expect(scan.netArea).toBe(1_000_000 - 1);
    expect(scan.netArea).toBeCloseTo(netOf(recs), 9);
  });

  it("should return per-record typed arrays with a length", async () => {
    const file = await tmp.write("t.shp", buildShp([rec1, null, [cwSquare(0, 0, 5)]]));

    const scan = await scanShapefile(file, { perRecord: true });

    const pr = scan.perRecord!;
    expect(pr.length).toBe(3);
    expect(Array.from(pr.recordNumbers)).toEqual([1, 2, 3]);
    expect(Array.from(pr.ringCounts)).toEqual([5, 0, 1]);
    expect(Array.from(pr.pointCounts)).toEqual([25, 0, 5]);
    expect(Array.from(pr.shellCounts)).toEqual([3, 0, 1]);
    expect(Array.from(pr.holeCounts)).toEqual([2, 0, 0]);
    expect(pr.netAreas).toBeInstanceOf(Float64Array);
    expect(pr.netAreas[0]).toBeCloseTo(193, 9);
    expect(pr.netAreas[1]).toBe(0);
    expect(pr.netAreas[2]).toBeCloseTo(25, 9);
  });

  it("should grow the per-record arrays past their initial capacity", async () => {
    const recs: RecordSpec[] = Array.from({ length: 1500 }, () => [cwSquare(0, 0, 1)]);
    const file = await tmp.write("many.shp", buildShp(recs));

    const scan = await scanShapefile(file, { perRecord: true });

    expect(scan.perRecord!.length).toBe(1500);
    expect(scan.perRecord!.recordNumbers[1499]).toBe(1500);
    expect(scan.netArea).toBeCloseTo(1500, 9);
  });

  it("should scan an empty polygon file with zero records", async () => {
    const file = await tmp.write("empty.shp", buildShp([]));

    const scan = await scanShapefile(file, { perRecord: true });

    expect(scan.recordCount).toBe(0);
    expect(scan.netArea).toBe(0);
    expect(scan.perRecord!.length).toBe(0);
  });
});

describe("scanShapefile progress and abort", () => {
  it("should report monotonic progress from 0 ending at the file size", async () => {
    const shp = buildShp([rec1, null, [cwCircle(0, 0, 100, 20_000)]]);
    const file = await tmp.write("t.shp", shp);
    const calls: [number, number][] = [];

    await scanShapefile(file, { onProgress: (r, t) => calls.push([r, t]) });

    expect(calls[0]![0]).toBe(0);
    for (let i = 1; i < calls.length; i++) expect(calls[i]![0]).toBeGreaterThanOrEqual(calls[i - 1]![0]);
    expect(calls[calls.length - 1]).toEqual([shp.length, shp.length]);
    for (const [, t] of calls) expect(t).toBe(shp.length);
  });

  it("should reject when the signal is already aborted", async () => {
    const file = await tmp.write("t.shp", buildShp([rec1]));
    const controller = new AbortController();
    controller.abort();

    await expect(scanShapefile(file, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("should reject when aborted from inside onProgress mid-run", async () => {
    const recs: RecordSpec[] = Array.from({ length: 6 }, () => [cwCircle(0, 0, 100, 20_000)]);
    const file = await tmp.write("t.shp", buildShp(recs));
    const controller = new AbortController();
    let seen = 0;

    const run = scanShapefile(file, {
      signal: controller.signal,
      onProgress: (bytes) => {
        if (bytes > 0) {
          seen++;
          controller.abort();
        }
      },
    });

    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(seen).toBeLessThanOrEqual(2);
  });
});
