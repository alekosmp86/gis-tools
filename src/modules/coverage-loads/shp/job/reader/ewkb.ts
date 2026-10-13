import { FileWindow } from "./fileIo.ts";
import { isHoleRing, isShellRing } from "./ringMetadata.ts";
import type { RingMetadata } from "./ringMetadata.ts";
import { EWKB_SRID, MIB } from "./types.ts";
import type { ShpRecordHeader } from "./types.ts";

const WKB_POLYGON = 3;
const WKB_MULTIPOLYGON = 6;
const EWKB_SRID_FLAG = 0x20000000;
const MULTI_HEADER_BYTES = 13;
const POLYGON_HEADER_BYTES = 9;

/** Shells with their holes, in CSR form (holes of shell s: holeList[holeStart[s] .. holeStart[s + 1])). */
export interface EwkbLayout {
  shellCount: number;
  holeStart: Int32Array;
  holeList: Int32Array;
}

export function buildLayout(rec: ShpRecordHeader, meta: RingMetadata): EwkbLayout {
  const n = meta.n;
  const holeStart = new Int32Array(n + 1);
  for (let h = 0; h < n; h++) {
    const s = meta.holeShell[h] as number;
    if (s >= 0 && isHoleRing(meta, rec.parts, h)) holeStart[s + 1]!++;
  }
  for (let i = 0; i < n; i++) holeStart[i + 1]! += holeStart[i] as number;
  const fill = holeStart.slice(0, n);
  const holeList = new Int32Array(holeStart[n] as number);
  for (let h = 0; h < n; h++) {
    const s = meta.holeShell[h] as number;
    if (s >= 0 && isHoleRing(meta, rec.parts, h)) holeList[fill[s]!++] = h;
  }
  let shellCount = 0;
  for (let s = 0; s < n; s++) if (isShellRing(meta, rec.parts, s)) shellCount++;
  return { shellCount, holeStart, holeList };
}

/** Exact byte length of the record's MultiPolygon EWKB. */
export function computeEwkbSize(rec: ShpRecordHeader, meta: RingMetadata, layout: EwkbLayout): number {
  const parts = rec.parts;
  let ringCount = 0;
  let points = 0;
  for (let s = 0; s < meta.n; s++) {
    if (!isShellRing(meta, parts, s)) continue;
    ringCount++;
    points += (parts[s + 1] as number) - (parts[s] as number);
    for (let q = layout.holeStart[s] as number; q < (layout.holeStart[s + 1] as number); q++) {
      const h = layout.holeList[q] as number;
      ringCount++;
      points += (parts[h + 1] as number) - (parts[h] as number);
    }
  }
  return MULTI_HEADER_BYTES + layout.shellCount * POLYGON_HEADER_BYTES + 4 * ringCount + 16 * points;
}

type Segment = { bytes: Uint8Array } | { fileOffset: number; length: number };

function* segments(rec: ShpRecordHeader, meta: RingMetadata, layout: EwkbLayout): Generator<Segment, void, undefined> {
  const scratch = new Uint8Array(MULTI_HEADER_BYTES);
  const view = new DataView(scratch.buffer);
  const parts = rec.parts;

  const polygonHeader = (ringCount: number): Segment => {
    view.setUint8(0, 1);
    view.setUint32(1, WKB_POLYGON, true);
    view.setUint32(5, ringCount, true);
    return { bytes: scratch.subarray(0, POLYGON_HEADER_BYTES) };
  };
  const ringHeader = (points: number): Segment => {
    view.setUint32(0, points, true);
    return { bytes: scratch.subarray(0, 4) };
  };

  view.setUint8(0, 1);
  view.setUint32(1, (WKB_MULTIPOLYGON | EWKB_SRID_FLAG) >>> 0, true);
  view.setUint32(5, EWKB_SRID, true);
  view.setUint32(9, layout.shellCount, true);
  yield { bytes: scratch.subarray(0, MULTI_HEADER_BYTES) };

  const ring = function* (r: number): Generator<Segment, void, undefined> {
    const a = parts[r] as number;
    const points = (parts[r + 1] as number) - a;
    yield ringHeader(points);
    yield { fileOffset: rec.pointsOffset + 16 * a, length: 16 * points };
  };

  for (let s = 0; s < meta.n; s++) {
    if (!isShellRing(meta, parts, s)) continue;
    const from = layout.holeStart[s] as number;
    const to = layout.holeStart[s + 1] as number;
    yield polygonHeader(1 + to - from);
    yield* ring(s);
    for (let q = from; q < to; q++) yield* ring(layout.holeList[q] as number);
  }
}

/**
 * Streams the record EWKB as fresh buffers of exactly min(1 MiB, remaining) bytes, so the slice
 * lengths sum to totalBytes. Must run while `meta` still describes this record (see `guard`).
 */
export async function* streamEwkb(
  fileWindow: FileWindow,
  rec: ShpRecordHeader,
  meta: RingMetadata,
  layout: EwkbLayout,
  totalBytes: number,
  guard: () => void,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array, void, undefined> {
  let emitted = 0;
  let buf = new Uint8Array(Math.min(MIB, totalBytes));
  let pos = 0;

  const mismatch = (): Error =>
    new Error(`El tamaño EWKB generado no coincide con el calculado (${totalBytes} bytes, registro ${rec.recordNumber}).`);

  guard();
  for (const seg of segments(rec, meta, layout)) {
    let remaining = "bytes" in seg ? seg.bytes.length : seg.length;
    let sourceOffset = 0;
    let fileOffset = "fileOffset" in seg ? seg.fileOffset : 0;
    while (remaining > 0) {
      if (buf.length === pos) throw mismatch();
      const k = Math.min(remaining, buf.length - pos);
      if ("bytes" in seg) {
        buf.set(seg.bytes.subarray(sourceOffset, sourceOffset + k), pos);
        sourceOffset += k;
      } else {
        await fileWindow.copy(buf, pos, fileOffset, k);
        fileOffset += k;
      }
      pos += k;
      remaining -= k;
      if (pos === buf.length) {
        guard();
        signal?.throwIfAborted();
        emitted += buf.length;
        yield buf;
        pos = 0;
        buf = new Uint8Array(Math.min(MIB, totalBytes - emitted));
      }
    }
  }
  if (emitted !== totalBytes || pos !== 0) throw mismatch();
}
