import { FileWindow } from "./fileIo.ts";
import type { SliceBuffer } from "./fileIo.ts";
import { PROBE_STRIDE, isHoleRing, isShellRing } from "./ringMetadata.ts";
import type { RingMetadata } from "./ringMetadata.ts";
import type { ShpRecordHeader } from "./types.ts";

export interface HoleAssignmentContext {
  fileWindow: FileWindow;
  slice: SliceBuffer;
  signal?: AbortSignal;
}

export interface HoleAssignmentResult {
  holeCount: number;
  /** Holes whose every probe touched a shell boundary (best container kept in meta.holeShell). */
  ambiguousCount: number;
  /** Holes strictly inside no shell after all retries (meta.holeShell stays -1). */
  unassignedCount: number;
}

/** Probe = midpoint of ring edge 0, then 1, then 2 on successive rounds. */
const MAX_ROUNDS = 3;

function listHoles(meta: RingMetadata, parts: Int32Array): number[] {
  const holes: number[] = [];
  for (let i = 0; i < meta.n; i++) if (isHoleRing(meta, parts, i)) holes.push(i);
  return holes;
}

function commitAndCollectRetries(meta: RingMetadata, pending: Int32Array): Int32Array<ArrayBufferLike> {
  const next: number[] = [];
  for (const h of pending) {
    const best = meta.best[h] as number;
    if (best >= 0) meta.holeShell[h] = best;
    if (best < 0 || meta.boundary[h] !== 0) next.push(h);
  }
  return Int32Array.from(next);
}

function countUnresolved(meta: RingMetadata, pending: Int32Array): { ambiguousCount: number; unassignedCount: number } {
  let ambiguousCount = 0;
  let unassignedCount = 0;
  for (const h of pending) {
    if ((meta.holeShell[h] as number) >= 0) ambiguousCount++;
    else unassignedCount++;
  }
  return { ambiguousCount, unassignedCount };
}

/**
 * Assigns each hole ring (counter-clockwise) to the smallest shell (clockwise) strictly containing a
 * probe point. Winding-number sweep: each shell is streamed once per round and all probes inside
 * its bbox are tested together (O(V log P)). Writes meta.holeShell.
 */
export async function assignHoles(
  ctx: HoleAssignmentContext,
  rec: ShpRecordHeader,
  meta: RingMetadata,
): Promise<HoleAssignmentResult> {
  const holes = listHoles(meta, rec.parts);
  let pending: Int32Array<ArrayBufferLike> = Int32Array.from(holes);
  for (let round = 0; round < MAX_ROUNDS && pending.length > 0; round++) {
    await sweepRound(ctx, rec, meta, pending, round);
    pending = commitAndCollectRetries(meta, pending);
  }
  return { holeCount: holes.length, ...countUnresolved(meta, pending) };
}

interface ProbeGrid {
  npend: number;
  px: Float64Array;
  py: Float64Array;
  gminx: number;
  gminy: number;
  gmaxx: number;
  gmaxy: number;
  cs: number;
  gx: number;
  gy: number;
  cellStart: Int32Array;
  items: Int32Array;
}

interface ShellCandidates {
  nc: number;
  cand: Int32Array<ArrayBufferLike>;
  sx: Float64Array;
  sy: Float64Array;
  wn: Int32Array;
  bf: Uint8Array;
}

function loadProbes(meta: RingMetadata, pend: Int32Array, edge: number) {
  const npend = pend.length;
  const { probes, best, boundary } = meta;
  const px = new Float64Array(npend);
  const py = new Float64Array(npend);
  let gminx = Infinity;
  let gminy = Infinity;
  let gmaxx = -Infinity;
  let gmaxy = -Infinity;
  for (let j = 0; j < npend; j++) {
    const h = pend[j] as number;
    const b = PROBE_STRIDE * h + 2 * edge;
    const x = 0.5 * ((probes[b] as number) + (probes[b + 2] as number));
    const y = 0.5 * ((probes[b + 1] as number) + (probes[b + 3] as number));
    px[j] = x;
    py[j] = y;
    if (x < gminx) gminx = x;
    if (x > gmaxx) gmaxx = x;
    if (y < gminy) gminy = y;
    if (y > gmaxy) gmaxy = y;
    best[h] = -1;
    boundary[h] = 0;
  }
  return { px, py, gminx, gminy, gmaxx, gmaxy };
}

function buildProbeGrid(meta: RingMetadata, pend: Int32Array, edge: number): ProbeGrid {
  const npend = pend.length;
  const { px, py, gminx, gminy, gmaxx, gmaxy } = loadProbes(meta, pend, edge);
  const w = gmaxx - gminx;
  const hgt = gmaxy - gminy;
  let cs = Math.sqrt(Math.max(w * hgt, 1e-9) / Math.max(1, npend >> 1));
  cs = Math.max(cs, w / 1024, hgt / 1024, 1e-6);
  const gx = Math.floor(w / cs) + 1;
  const gy = Math.floor(hgt / cs) + 1;
  const cellStart = new Int32Array(gx * gy + 1);
  const cellOf = new Int32Array(npend);
  for (let j = 0; j < npend; j++) {
    const cell = Math.floor(((py[j] as number) - gminy) / cs) * gx + Math.floor(((px[j] as number) - gminx) / cs);
    cellOf[j] = cell;
    cellStart[cell + 1]!++;
  }
  for (let q = 0; q < gx * gy; q++) cellStart[q + 1]! += cellStart[q] as number;
  const fillPos = cellStart.slice(0, gx * gy);
  const items = new Int32Array(npend);
  for (let j = 0; j < npend; j++) {
    const cell = cellOf[j] as number;
    items[fillPos[cell] as number] = j;
    fillPos[cell]!++;
  }
  return { npend, px, py, gminx, gminy, gmaxx, gmaxy, cs, gx, gy, cellStart, items };
}

function gridOverlapsBbox(grid: ProbeGrid, sMinX: number, sMaxX: number, sMinY: number, sMaxY: number): boolean {
  return !(sMinX > grid.gmaxx || sMaxX < grid.gminx || sMinY > grid.gmaxy || sMaxY < grid.gminy);
}

function collectBboxProbes(
  grid: ProbeGrid,
  candIdx: Int32Array,
  sMinX: number,
  sMaxX: number,
  sMinY: number,
  sMaxY: number,
): number {
  const { px, py, gminx, gminy, cs, gx, gy, cellStart, items } = grid;
  const cx0 = Math.max(0, Math.floor((sMinX - gminx) / cs));
  const cx1 = Math.min(gx - 1, Math.floor((sMaxX - gminx) / cs));
  const cy0 = Math.max(0, Math.floor((sMinY - gminy) / cs));
  const cy1 = Math.min(gy - 1, Math.floor((sMaxY - gminy) / cs));
  let nc = 0;
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) {
      const cell = cy * gx + cx;
      for (let q = cellStart[cell] as number; q < (cellStart[cell + 1] as number); q++) {
        const j = items[q] as number;
        const x = px[j] as number;
        const y = py[j] as number;
        if (x >= sMinX && x <= sMaxX && y >= sMinY && y <= sMaxY) candIdx[nc++] = j;
      }
    }
  }
  return nc;
}

function prepareCandidates(grid: ProbeGrid, st: ShellCandidates, nc: number): void {
  const { px, py } = grid;
  const cand = st.cand.subarray(0, nc);
  cand.sort((a, b) => (py[a] as number) - (py[b] as number));
  for (let q = 0; q < nc; q++) {
    const j = cand[q] as number;
    st.sx[q] = px[j] as number;
    st.sy[q] = py[j] as number;
    st.wn[q] = 0;
    st.bf[q] = 0;
  }
  st.nc = nc;
  st.cand = cand;
}

function lowerBound(sy: Float64Array, nc: number, value: number): number {
  let lo = 0;
  let hi = nc;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if ((sy[m] as number) < value) lo = m + 1;
    else hi = m;
  }
  return lo;
}

function isOnSegment(x: number, cross: number, x1: number, x2: number): boolean {
  return cross === 0 && x >= (x1 < x2 ? x1 : x2) && x <= (x1 < x2 ? x2 : x1);
}

function windProbe(st: ShellCandidates, j: number, x1: number, y1: number, x2: number, y2: number): void {
  const x = st.sx[j] as number;
  const y = st.sy[j] as number;
  const cross = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
  if (isOnSegment(x, cross, x1, x2)) {
    st.bf[j] = 1;
    return;
  }
  if (y1 <= y) {
    if (y2 > y && cross > 0) st.wn[j]!++;
  } else if (y2 <= y && cross < 0) st.wn[j]!--;
}

function applyEdge(st: ShellCandidates, x1: number, y1: number, x2: number, y2: number): void {
  const { nc, sy } = st;
  const ylo = y1 < y2 ? y1 : y2;
  const yhi = y1 < y2 ? y2 : y1;
  if (!(yhi >= (sy[0] as number) && ylo <= (sy[nc - 1] as number))) return;
  for (let j = lowerBound(sy, nc, ylo); j < nc && (sy[j] as number) <= yhi; j++) windProbe(st, j, x1, y1, x2, y2);
}

async function streamShellEdges(
  ctx: HoleAssignmentContext,
  rec: ShpRecordHeader,
  st: ShellCandidates,
  rs: number,
  re: number,
): Promise<void> {
  const f = ctx.slice.f64;
  const slicePoints = ctx.slice.pointCapacity;
  let x1 = 0;
  let y1 = 0;
  for (let g = rs; g < re; g += slicePoints) {
    ctx.signal?.throwIfAborted();
    const cnt = Math.min(slicePoints, re - g);
    // Sequential on purpose: every slice reuses the same buffer and the winding state carries over.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await ctx.fileWindow.copy(ctx.slice.bytes, 0, rec.pointsOffset + 16 * g, cnt * 16);
    let k = 0;
    if (g === rs) {
      x1 = f[0] as number;
      y1 = f[1] as number;
      k = 1;
    }
    for (; k < cnt; k++) {
      const x2 = f[2 * k] as number;
      const y2 = f[2 * k + 1] as number;
      applyEdge(st, x1, y1, x2, y2);
      x1 = x2;
      y1 = y2;
    }
  }
}

function recordShellResult(meta: RingMetadata, pend: Int32Array, bestArea: Float64Array, st: ShellCandidates, s: number): void {
  const shellArea = -(meta.area[s] as number);
  for (let q = 0; q < st.nc; q++) {
    const j = st.cand[q] as number;
    const h = pend[j] as number;
    if (st.bf[q] !== 0) meta.boundary[h] = 1;
    else if ((st.wn[q] as number) !== 0 && shellArea < (bestArea[j] as number)) {
      bestArea[j] = shellArea;
      meta.best[h] = s;
    }
  }
}

async function sweepRound(
  ctx: HoleAssignmentContext,
  rec: ShpRecordHeader,
  meta: RingMetadata,
  pend: Int32Array,
  edge: number,
): Promise<void> {
  const npend = pend.length;
  const grid = buildProbeGrid(meta, pend, edge);
  const st: ShellCandidates = {
    nc: 0,
    cand: new Int32Array(npend),
    sx: new Float64Array(npend),
    sy: new Float64Array(npend),
    wn: new Int32Array(npend),
    bf: new Uint8Array(npend),
  };
  const bestArea = new Float64Array(npend).fill(Infinity);
  const parts = rec.parts;
  const candIdx = st.cand;

  for (let s = 0; s < meta.n; s++) {
    if (!isShellRing(meta, parts, s)) continue;
    const sMinX = meta.minX[s] as number;
    const sMaxX = meta.maxX[s] as number;
    const sMinY = meta.minY[s] as number;
    const sMaxY = meta.maxY[s] as number;
    if (!gridOverlapsBbox(grid, sMinX, sMaxX, sMinY, sMaxY)) continue;
    const nc = collectBboxProbes(grid, candIdx, sMinX, sMaxX, sMinY, sMaxY);
    if (nc === 0) continue;
    st.cand = candIdx;
    prepareCandidates(grid, st, nc);
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    await streamShellEdges(ctx, rec, st, parts[s] as number, parts[s + 1] as number);
    recordShellResult(meta, pend, bestArea, st, s);
  }
}
