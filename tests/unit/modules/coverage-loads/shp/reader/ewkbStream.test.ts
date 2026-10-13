import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { iterateRecordEwkb } from "@/modules/coverage-loads/shp/job/reader/index.ts";
import type { EwkbIterationSummary } from "@/modules/coverage-loads/shp/job/reader/index.ts";
import { collectChunks, collectEwkb, decodeEwkb, drain, multiArea } from "../helpers/readerTestEwkb.ts";
import type { DecodedMulti } from "../helpers/readerTestEwkb.ts";
import { buildShp, ccwSquare, cwCircle, cwSquare, makeTempDir } from "../helpers/readerTestShp.ts";
import type { RecordSpec, TempShpDir } from "../helpers/readerTestShp.ts";

const MIB = 1 << 20;

const rec1: RecordSpec = [
  [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]],
  [[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]],
  [[20, 20], [20, 30], [30, 30], [30, 20], [20, 20]],
  [[10, 6], [10, 8], [8, 8], [8, 6], [10, 6]],
  [[5, 5], [5, 6], [6, 6], [6, 5], [5, 5]],
];
const rec3: RecordSpec = [[[0, 0], [0, 5], [5, 5], [5, 0], [0, 0]]];

let tmp: TempShpDir;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(async () => {
  await tmp.cleanup();
});

describe("iterateRecordEwkb spike strategy (a) port", () => {
  it("should decode 3 polygons with ring counts 3,1,1 and areas 193 and 25 when a null record sits between", async () => {
    const file = await tmp.write("t.shp", buildShp([rec1, null, rec3]));

    const { records, summary } = await drain(iterateRecordEwkb(file));

    expect(records.map((r) => r.rec.recordNumber)).toEqual([1, 3]);
    const g1 = decodeEwkb(records[0]!.bytes).geom as DecodedMulti;
    expect(g1.type).toBe(6);
    expect(g1.srid).toBe(32721);
    expect(g1.polys.map((p) => p.rings.length)).toEqual([3, 1, 1]);
    expect(multiArea(g1)).toBeCloseTo(193, 9);
    const g3 = decodeEwkb(records[1]!.bytes).geom as DecodedMulti;
    expect(multiArea(g3)).toBeCloseTo(25, 9);
    expect(summary).toEqual({
      recordCount: 3,
      nullRecordCount: 1,
      emptyRecordCount: 0,
      yieldedRecordCount: 2,
      degenerateRingCount: 0,
    });
    expect(records[0]!.rec.netArea).toBeCloseTo(193, 9);
    expect(records[0]!.rec.pointCount).toBe(25);
  });

  it("should resolve the hole whose first-edge probe lies on the shell boundary on a retry round", async () => {
    const file = await tmp.write("t.shp", buildShp([rec1]));

    const { records } = await drain(iterateRecordEwkb(file));

    const g = decodeEwkb(records[0]!.bytes).geom as DecodedMulti;
    expect(g.polys[0]!.rings[2]).toEqual([[10, 6], [10, 8], [8, 8], [8, 6], [10, 6]]);
  });
});

describe("EWKB layout", () => {
  it("should write little-endian MultiPolygon header with SRID flag and plain sub-polygons", async () => {
    const file = await tmp.write("t.shp", buildShp([rec1]));
    const { records } = await drain(iterateRecordEwkb(file));
    const b = records[0]!.bytes;

    expect(b[0]).toBe(1);
    expect(b.readUInt32LE(1)).toBe((6 | 0x20000000) >>> 0);
    expect(b.readUInt32LE(5)).toBe(32721);
    expect(b.readUInt32LE(9)).toBe(3);
    expect(b[13]).toBe(1);
    expect(b.readUInt32LE(14)).toBe(3);
    expect(b.readUInt32LE(14) & 0x20000000).toBe(0);
    expect(b.readUInt32LE(18)).toBe(3);
    expect(b.readUInt32LE(22)).toBe(5);
  });

  it("should emit closed rings with exact point counts", async () => {
    const file = await tmp.write("t.shp", buildShp([rec1]));
    const { records } = await drain(iterateRecordEwkb(file));
    const g = decodeEwkb(records[0]!.bytes).geom as DecodedMulti;

    for (const p of g.polys) {
      for (const r of p.rings) {
        expect(r.length).toBe(5);
        expect(r[0]).toEqual(r[r.length - 1]);
      }
    }
    expect(records[0]!.bytes.length).toBe(13 + 3 * 9 + 5 * 4 + 5 * 5 * 16);
  });

  it("should copy double coordinates verbatim from the file", async () => {
    const x = 0.1;
    const y = 1 / 3;
    const ring = [[x, y], [x, y + 1.7], [x + 2.3, y + 1.7], [x + 2.3, y], [x, y]] as [number, number][];
    const shp = buildShp([[ring]]);
    const file = await tmp.write("t.shp", shp);

    const { records } = await drain(iterateRecordEwkb(file));

    const pointBytes = shp.subarray(100 + 8 + 44 + 4, 100 + 8 + 44 + 4 + 80);
    expect(records[0]!.bytes.subarray(13 + 9 + 4).equals(pointBytes)).toBe(true);
    const g = decodeEwkb(records[0]!.bytes).geom as DecodedMulti;
    expect(g.polys[0]!.rings[0]).toEqual(ring);
  });

  it("should drop degenerate rings from the EWKB and count them", async () => {
    const file = await tmp.write(
      "t.shp",
      buildShp([[cwSquare(0, 0, 10), [[3, 3], [4, 4], [3, 3]], [[1, 1], [2, 2], [3, 3], [1, 1]]]]),
    );

    const { records, summary } = await drain(iterateRecordEwkb(file));

    const g = decodeEwkb(records[0]!.bytes).geom as DecodedMulti;
    expect(g.polys.length).toBe(1);
    expect(g.polys[0]!.rings.length).toBe(1);
    expect((summary as EwkbIterationSummary).degenerateRingCount).toBe(2);
  });
});

describe("streaming contract", () => {
  it("should report totalBytes equal to the summed chunk lengths for every record", async () => {
    const file = await tmp.write("t.shp", buildShp([rec1, null, rec3]));
    const gen = iterateRecordEwkb(file);

    for (;;) {
      const r = await gen.next();
      if (r.done) break;
      const known = r.value.totalBytes;
      const chunks = await collectChunks(r.value);
      expect(chunks.reduce((s, c) => s + c.length, 0)).toBe(known);
    }
  });

  it("should split a record over 1 MiB into multiple slices of at most 1 MiB that sum exactly", async () => {
    const big = cwCircle(1000, 1000, 500, 100_000);
    const file = await tmp.write("big.shp", buildShp([[big]]));
    const gen = iterateRecordEwkb(file);

    const first = await gen.next();
    if (first.done) throw new Error("expected a record");
    const total = first.value.totalBytes;
    expect(total).toBe(13 + 9 + 4 + 16 * big.length);
    const chunks = await collectChunks(first.value);

    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(MIB);
    expect(chunks.reduce((s, c) => s + c.length, 0)).toBe(total);
    const g = decodeEwkb(Buffer.concat(chunks)).geom as DecodedMulti;
    expect(g.polys[0]!.rings[0]!.length).toBe(big.length);
    expect(g.polys[0]!.rings[0]![99_999]).toEqual(big[99_999]);
    await gen.return(undefined as never);
  });

  it("should hand out independent consumer-owned buffers", async () => {
    const big = cwCircle(1000, 1000, 500, 100_000);
    const file = await tmp.write("big.shp", buildShp([[big]]));
    const gen = iterateRecordEwkb(file);
    const first = await gen.next();
    if (first.done) throw new Error("expected a record");

    const chunks = await collectChunks(first.value);

    const buffers = new Set(chunks.map((c) => c.buffer));
    expect(buffers.size).toBe(chunks.length);
    for (const c of chunks) expect(c.byteLength).toBe(c.buffer.byteLength);
    const reference = Buffer.concat(chunks);
    chunks[0]!.fill(0xff);
    expect(Buffer.concat(chunks.slice(1)).equals(reference.subarray(chunks[0]!.length))).toBe(true);
    await gen.return(undefined as never);
  });
});

describe("ordering guards", () => {
  it("should throw when chunks() is requested twice", async () => {
    const file = await tmp.write("t.shp", buildShp([rec3]));
    const gen = iterateRecordEwkb(file);
    const first = await gen.next();
    if (first.done) throw new Error("expected a record");

    first.value.chunks();

    expect(() => first.value.chunks()).toThrow(/ya fueron solicitados/);
    await gen.return(undefined as never);
  });

  it("should throw when a stale record asks for chunks after the generator advanced", async () => {
    const file = await tmp.write("t.shp", buildShp([rec3, rec3]));
    const gen = iterateRecordEwkb(file);
    const first = await gen.next();
    const second = await gen.next();
    if (first.done || second.done) throw new Error("expected records");

    expect(() => first.value.chunks()).toThrow(/ya no es el actual/);
    expect((await collectEwkb(second.value)).length).toBe(second.value.totalBytes);
    await gen.return(undefined as never);
  });

  it("should throw mid-stream when the generator advances before the stream is finished", async () => {
    const big = cwCircle(1000, 1000, 500, 100_000);
    const file = await tmp.write("big.shp", buildShp([[big], rec3]));
    const gen = iterateRecordEwkb(file);
    const first = await gen.next();
    if (first.done) throw new Error("expected a record");
    const it = first.value.chunks()[Symbol.asyncIterator]();
    await it.next();

    await gen.next();

    await expect(it.next()).rejects.toThrow(/ya no es el actual/);
    await gen.return(undefined as never);
  });

  it("should return a summary counting null, empty, yielded and degenerate records", async () => {
    const file = await tmp.write(
      "t.shp",
      buildShp([rec3, null, [[[0, 0], [1, 1], [0, 0]]], [cwSquare(0, 0, 4), [[0, 0], [1, 1], [2, 2], [0, 0]]]]),
    );

    const { records, summary } = await drain(iterateRecordEwkb(file));

    expect(records.length).toBe(2);
    expect(summary).toEqual({
      recordCount: 4,
      nullRecordCount: 1,
      emptyRecordCount: 1,
      yieldedRecordCount: 2,
      degenerateRingCount: 2,
    });
  });
});

describe("shapes", () => {
  it("should handle a ring that is a hole only through its orientation", async () => {
    const file = await tmp.write("t.shp", buildShp([[cwSquare(0, 0, 10), ccwSquare(2, 2, 2)]]));
    const { records } = await drain(iterateRecordEwkb(file));
    const g = decodeEwkb(records[0]!.bytes).geom as DecodedMulti;
    expect(multiArea(g)).toBeCloseTo(96, 9);
  });
});
