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
  const holes: number[] = [];
  for (let i = 0; i < meta.n; i++) if (isHoleRing(meta, rec.parts, i)) holes.push(i);
  let pending = Int32Array.from(holes);
  for (let round = 0; round < MAX_ROUNDS && pending.length > 0; round++) {
    await sweepRound(ctx, rec, meta, pending, round);
    const next: number[] = [];
    for (const h of pending) {
      const best = meta.best[h] as number;
      if (best >= 0) meta.holeShell[h] = best;
      if (best < 0 || meta.boundary[h] !== 0) next.push(h);
    }
    pending = Int32Array.from(next);
  }
  let ambiguousCount = 0;
  let unassignedCount = 0;
  for (const h of pending) {
    if ((meta.holeShell[h] as number) >= 0) ambiguousCount++;
    else unassignedCount++;
  }
  return { holeCount: holes.length, ambiguousCount, unassignedCount };
}

async function sweepRound(
  ctx: HoleAssignmentContext,
  rec: ShpRecordHeader,
  meta: RingMetadata,
  pend: Int32Array,
  edge: number,
): Promise<void> {
  const npend = pend.length;
  const { probes, best, boundary, minX, minY, maxX, maxY, area } = meta;
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

  const candIdx = new Int32Array(npend);
  const sx = new Float64Array(npend);
  const sy = new Float64Array(npend);
  const wn = new Int32Array(npend);
  const bf = new Uint8Array(npend);
  const bestArea = new Float64Array(npend).fill(Infinity);
  const f = ctx.slice.f64;
  const slicePoints = ctx.slice.pointCapacity;
  const parts = rec.parts;

  for (let s = 0; s < meta.n; s++) {
    if (!isShellRing(meta, parts, s)) continue;
    const sMinX = minX[s] as number;
    const sMaxX = maxX[s] as number;
    const sMinY = minY[s] as number;
    const sMaxY = maxY[s] as number;
    if (sMinX > gmaxx || sMaxX < gminx || sMinY > gmaxy || sMaxY < gminy) continue;
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
    if (nc === 0) continue;
    const cand = candIdx.subarray(0, nc);
    cand.sort((a, b) => (py[a] as number) - (py[b] as number));
    for (let q = 0; q < nc; q++) {
      const j = cand[q] as number;
      sx[q] = px[j] as number;
      sy[q] = py[j] as number;
      wn[q] = 0;
      bf[q] = 0;
    }
    const minProbeY = sy[0] as number;
    const maxProbeY = sy[nc - 1] as number;
    const rs = parts[s] as number;
    const re = parts[s + 1] as number;
    let x1 = 0;
    let y1 = 0;
    for (let g = rs; g < re; g += slicePoints) {
      ctx.signal?.throwIfAborted();
      const cnt = Math.min(slicePoints, re - g);
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
        const ylo = y1 < y2 ? y1 : y2;
        const yhi = y1 < y2 ? y2 : y1;
        if (yhi >= minProbeY && ylo <= maxProbeY) {
          let lo = 0;
          let hi = nc;
          while (lo < hi) {
            const m = (lo + hi) >> 1;
            if ((sy[m] as number) < ylo) lo = m + 1;
            else hi = m;
          }
          for (let j = lo; j < nc && (sy[j] as number) <= yhi; j++) {
            const x = sx[j] as number;
            const y = sy[j] as number;
            const cross = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
            if (cross === 0 && x >= (x1 < x2 ? x1 : x2) && x <= (x1 < x2 ? x2 : x1)) {
              bf[j] = 1;
              continue;
            }
            if (y1 <= y) {
              if (y2 > y && cross > 0) wn[j]!++;
            } else if (y2 <= y && cross < 0) wn[j]!--;
          }
        }
        x1 = x2;
        y1 = y2;
      }
    }
    const shellArea = -(area[s] as number);
    for (let q = 0; q < nc; q++) {
      const j = cand[q] as number;
      const h = pend[j] as number;
      if (bf[q] !== 0) boundary[h] = 1;
      else if ((wn[q] as number) !== 0 && shellArea < (bestArea[j] as number)) {
        bestArea[j] = shellArea;
        best[h] = s;
      }
    }
  }
}
