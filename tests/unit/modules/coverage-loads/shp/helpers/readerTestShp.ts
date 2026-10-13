import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type Pt = [number, number];
export type RingPts = Pt[];
export type RecordSpec = RingPts[] | null;

/** Synthetic shapefile writer (ported from the spike self-test). */
export function buildShp(recs: RecordSpec[]): Buffer {
  const bodies = recs.map((rings, i) => {
    if (!rings) {
      const b = Buffer.alloc(8 + 4);
      b.writeInt32BE(i + 1, 0);
      b.writeInt32BE(2, 4);
      return b;
    }
    const np = rings.reduce((s, r) => s + r.length, 0);
    const clen = 44 + 4 * rings.length + 16 * np;
    const b = Buffer.alloc(8 + clen);
    b.writeInt32BE(i + 1, 0);
    b.writeInt32BE(clen / 2, 4);
    b.writeInt32LE(5, 8);
    b.writeInt32LE(rings.length, 8 + 36);
    b.writeInt32LE(np, 8 + 40);
    let o = 8 + 44;
    let p = 0;
    for (const r of rings) {
      b.writeInt32LE(p, o);
      o += 4;
      p += r.length;
    }
    for (const r of rings) {
      for (const [x, y] of r) {
        b.writeDoubleLE(x, o);
        b.writeDoubleLE(y, o + 8);
        o += 16;
      }
    }
    return b;
  });
  const h = Buffer.alloc(100);
  h.writeInt32BE(9994, 0);
  h.writeInt32BE((100 + bodies.reduce((s, b) => s + b.length, 0)) / 2, 24);
  h.writeInt32LE(1000, 28);
  h.writeInt32LE(5, 32);
  return Buffer.concat([h, ...bodies]);
}

/** Absolute file offset of the record prefix (8-byte header) of record `index` (0-based). */
export function recordOffset(buf: Buffer, index: number): number {
  let off = 100;
  for (let i = 0; i < index; i++) off += 8 + buf.readInt32BE(off + 4) * 2;
  return off;
}

export interface TempShpDir {
  dir: string;
  write: (name: string, data: Buffer | Uint8Array) => Promise<string>;
  cleanup: () => Promise<void>;
}

export async function makeTempDir(): Promise<TempShpDir> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "reader-test-"));
  return {
    dir,
    write: async (name, data) => {
      const p = path.join(dir, name);
      await writeFile(p, data);
      return p;
    },
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Clockwise (shell) square. */
export const cwSquare = (x: number, y: number, s: number): RingPts => [
  [x, y],
  [x, y + s],
  [x + s, y + s],
  [x + s, y],
  [x, y],
];

/** Counter-clockwise (hole) square. */
export const ccwSquare = (x: number, y: number, s: number): RingPts => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];

/** Clockwise polygon with `n` distinct vertices plus the closing one. */
export function cwCircle(cx: number, cy: number, r: number, n: number): RingPts {
  const pts: RingPts = [];
  for (let i = 0; i < n; i++) {
    const a = -(2 * Math.PI * i) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  pts.push([pts[0]![0], pts[0]![1]]);
  return pts;
}

export const ringArea = (pts: RingPts): number => {
  let s = 0;
  for (let i = 0; i + 1 < pts.length; i++) s += pts[i]![0] * pts[i + 1]![1] - pts[i + 1]![0] * pts[i]![1];
  return Math.abs(s / 2);
};

/** Independent simple shoelace on first-vertex-relative coordinates (exact enough for the tests). */
export const signedArea = (pts: RingPts): number => {
  let s = 0;
  const [x0, y0] = pts[0]!;
  for (let i = 0; i + 1 < pts.length; i++) {
    const ax = pts[i]![0] - x0;
    const ay = pts[i]![1] - y0;
    const bx = pts[i + 1]![0] - x0;
    const by = pts[i + 1]![1] - y0;
    s += ax * by - bx * ay;
  }
  return s / 2;
};
