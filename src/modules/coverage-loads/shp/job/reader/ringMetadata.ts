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

interface RingScanState {
  x0: number;
  y0: number;
  prx: number;
  pry: number;
  sum: number;
  c: number;
  mnx: number;
  mny: number;
  mxx: number;
  mxy: number;
}

function startRing(st: RingScanState, meta: RingMetadata, ring: number, x0: number, y0: number): void {
  st.x0 = x0;
  st.y0 = y0;
  st.mnx = st.mxx = x0;
  st.mny = st.mxy = y0;
  st.sum = 0;
  st.c = 0;
  st.prx = 0;
  st.pry = 0;
  meta.probes[PROBE_STRIDE * ring] = x0;
  meta.probes[PROBE_STRIDE * ring + 1] = y0;
}

function addRingPoint(st: RingScanState, meta: RingMetadata, ring: number, li: number, x: number, y: number): void {
  if (x < st.mnx) st.mnx = x;
  else if (x > st.mxx) st.mxx = x;
  if (y < st.mny) st.mny = y;
  else if (y > st.mxy) st.mxy = y;
  const rx = x - st.x0;
  const ry = y - st.y0;
  const term = st.prx * ry - rx * st.pry - st.c;
  const total = st.sum + term;
  st.c = total - st.sum - term;
  st.sum = total;
  st.prx = rx;
  st.pry = ry;
  if (li < 4) {
    meta.probes[PROBE_STRIDE * ring + 2 * li] = x;
    meta.probes[PROBE_STRIDE * ring + 2 * li + 1] = y;
  }
}

function finishRing(st: RingScanState, meta: RingMetadata, ring: number, rs: number, re: number): number {
  meta.area[ring] = 0.5 * st.sum;
  meta.minX[ring] = st.mnx;
  meta.minY[ring] = st.mny;
  meta.maxX[ring] = st.mxx;
  meta.maxY[ring] = st.mxy;
  return re - rs >= 4 && (st.prx !== 0 || st.pry !== 0) ? 1 : 0;
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
  const slicePoints = slice.pointCapacity;
  const st: RingScanState = { x0: 0, y0: 0, prx: 0, pry: 0, sum: 0, c: 0, mnx: 0, mny: 0, mxx: 0, mxy: 0 };
  let unclosed = 0;
  let ring = 0;
  for (let g = 0; g < rec.numPoints; g += slicePoints) {
    signal?.throwIfAborted();
    const cnt = Math.min(slicePoints, rec.numPoints - g);
    // Sequential on purpose: every slice reuses the same buffer and the ring state carries over.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
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
        startRing(st, meta, ring, f[2 * k] as number, f[2 * k + 1] as number);
        k++;
        li = 1;
      }
      for (; k < segEnd; k++, li++) addRingPoint(st, meta, ring, li, f[2 * k] as number, f[2 * k + 1] as number);
      i = segEnd;
      if (g + segEnd === re) unclosed += finishRing(st, meta, ring, rs, re);
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
