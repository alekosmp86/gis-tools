import { readExact } from "./fileIo.ts";
import type { SliceBuffer } from "./fileIo.ts";
import type { ProgressCallback, RingSummary, ShpRecordHeader } from "./types.ts";
import type { ShapefileHandle } from "./shpHeader.ts";

if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
  throw new Error("Se requiere una plataforma little-endian para leer shapefiles.");
}

/** Probe slots per ring: the first 4 vertices (x, y). */
export const PROBE_STRIDE = 8;

/**
 * Per-ring metadata of ONE record, in typed arrays (no per-ring objects).
 * Reused across records; grows geometrically to the largest record.
 */
export class RingMetadata {
  n = 0;
  private capacity = 0;
  minX = new Float64Array(0);
  minY = new Float64Array(0);
  maxX = new Float64Array(0);
  maxY = new Float64Array(0);
  /** Signed shoelace area: negative = clockwise (shell), positive = counter-clockwise (hole). */
  area = new Float64Array(0);
  probes = new Float64Array(0);
  /** Shell ring index each hole was assigned to, or -1. */
  holeShell = new Int32Array(0);
  /** Scratch for the assignment sweep. */
  best = new Int32Array(0);
  boundary = new Uint8Array(0);

  reset(n: number): void {
    if (n > this.capacity) {
      const c = Math.max(n, Math.ceil(this.capacity * 1.5));
      this.capacity = c;
      this.minX = new Float64Array(c);
      this.minY = new Float64Array(c);
      this.maxX = new Float64Array(c);
      this.maxY = new Float64Array(c);
      this.area = new Float64Array(c);
      this.probes = new Float64Array(c * PROBE_STRIDE);
      this.holeShell = new Int32Array(c);
      this.best = new Int32Array(c);
      this.boundary = new Uint8Array(c);
    }
    this.n = n;
    this.minX.fill(0, 0, n);
    this.minY.fill(0, 0, n);
    this.maxX.fill(0, 0, n);
    this.maxY.fill(0, 0, n);
    this.area.fill(0, 0, n);
    this.probes.fill(0, 0, n * PROBE_STRIDE);
    this.holeShell.fill(-1, 0, n);
  }
}

export function isShellRing(meta: RingMetadata, parts: Int32Array, ring: number): boolean {
  return (meta.area[ring] as number) < 0 && (parts[ring + 1] as number) - (parts[ring] as number) >= 4;
}

export function isHoleRing(meta: RingMetadata, parts: Int32Array, ring: number): boolean {
  return (meta.area[ring] as number) > 0 && (parts[ring + 1] as number) - (parts[ring] as number) >= 4;
}

/**
 * Pass 1 over one record: streams its points in 1 MiB slices and fills bbox, signed area
 * (shoelace, first vertex subtracted, Kahan) and the first 4 vertices of each ring.
 * Returns the number of unclosed rings.
 */
export async function computeRingMetadata(
  file: ShapefileHandle,
  rec: ShpRecordHeader,
  meta: RingMetadata,
  slice: SliceBuffer,
  signal?: AbortSignal,
  onProgress?: ProgressCallback,
): Promise<number> {
  const parts = rec.parts;
  meta.reset(rec.numParts);
  const f = slice.f64;
  const { minX, minY, maxX, maxY, area, probes } = meta;
  const slicePoints = slice.pointCapacity;
  let unclosed = 0;
  let ring = 0;
  let x0 = 0;
  let y0 = 0;
  let prx = 0;
  let pry = 0;
  let sum = 0;
  let c = 0;
  let mnx = 0;
  let mny = 0;
  let mxx = 0;
  let mxy = 0;
  for (let g = 0; g < rec.numPoints; g += slicePoints) {
    signal?.throwIfAborted();
    const cnt = Math.min(slicePoints, rec.numPoints - g);
    await readExact(file.fh, slice.bytes, 0, cnt * 16, rec.pointsOffset + 16 * g);
    let i = 0;
    while (i < cnt) {
      const gi = g + i;
      while ((parts[ring + 1] as number) <= gi) ring++;
      const rs = parts[ring] as number;
      const re = parts[ring + 1] as number;
      const segEnd = Math.min(cnt, re - g);
      let k = i;
      let li = gi - rs;
      if (li === 0) {
        x0 = f[2 * k] as number;
        y0 = f[2 * k + 1] as number;
        mnx = mxx = x0;
        mny = mxy = y0;
        sum = 0;
        c = 0;
        prx = 0;
        pry = 0;
        probes[PROBE_STRIDE * ring] = x0;
        probes[PROBE_STRIDE * ring + 1] = y0;
        k++;
        li = 1;
      }
      for (; k < segEnd; k++, li++) {
        const x = f[2 * k] as number;
        const y = f[2 * k + 1] as number;
        if (x < mnx) mnx = x;
        else if (x > mxx) mxx = x;
        if (y < mny) mny = y;
        else if (y > mxy) mxy = y;
        const rx = x - x0;
        const ry = y - y0;
        const term = prx * ry - rx * pry - c;
        const total = sum + term;
        c = total - sum - term;
        sum = total;
        prx = rx;
        pry = ry;
        if (li < 4) {
          probes[PROBE_STRIDE * ring + 2 * li] = x;
          probes[PROBE_STRIDE * ring + 2 * li + 1] = y;
        }
      }
      i = segEnd;
      if (g + segEnd === re) {
        area[ring] = 0.5 * sum;
        minX[ring] = mnx;
        minY[ring] = mny;
        maxX[ring] = mxx;
        maxY[ring] = mxy;
        if (re - rs >= 4 && (prx !== 0 || pry !== 0)) unclosed++;
      }
    }
    onProgress?.(rec.pointsOffset + 16 * (g + cnt), file.size);
  }
  return unclosed;
}

/** Counts shells/holes and the Kahan-summed net area (shells - holes) of one record. */
export function summarizeRings(meta: RingMetadata, parts: Int32Array, unclosedCount: number): RingSummary {
  let shellCount = 0;
  let holeCount = 0;
  let degenerateCount = 0;
  let net = 0;
  let comp = 0;
  for (let i = 0; i < meta.n; i++) {
    const a = meta.area[i] as number;
    const len = (parts[i + 1] as number) - (parts[i] as number);
    if (len < 4 || !(a < 0 || a > 0)) degenerateCount++;
    else if (a < 0) shellCount++;
    else holeCount++;
    const y = -a - comp;
    const t = net + y;
    comp = t - net - y;
    net = t;
  }
  return { shellCount, holeCount, degenerateCount, unclosedCount, netArea: net };
}
