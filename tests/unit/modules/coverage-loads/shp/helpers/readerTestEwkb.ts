import type { EwkbRecord } from "@/modules/coverage-loads/shp/job/reader/index.ts";
import { ringArea } from "./readerTestShp.ts";
import type { RingPts } from "./readerTestShp.ts";

export interface DecodedPolygon {
  type: number;
  srid: number | null;
  rings: RingPts[];
}
export interface DecodedMulti {
  type: number;
  srid: number | null;
  polys: DecodedPolygon[];
}
type Decoded = DecodedPolygon | DecodedMulti;

/** Independent hand EWKB decoder (ported from the spike self-test). */
export function decodeEwkb(buf: Buffer, start = 0): { geom: Decoded; off: number } {
  let off = start;
  if (buf[off] !== 1) throw new Error("not little endian");
  const t = buf.readUInt32LE(off + 1);
  off += 5;
  let srid: number | null = null;
  if (t & 0x20000000) {
    srid = buf.readUInt32LE(off);
    off += 4;
  }
  const type = t & 0x1fffffff;
  if (type === 3) {
    const nr = buf.readUInt32LE(off);
    off += 4;
    const rings: RingPts[] = [];
    for (let r = 0; r < nr; r++) {
      const n = buf.readUInt32LE(off);
      off += 4;
      const pts: RingPts = [];
      for (let k = 0; k < n; k++) {
        pts.push([buf.readDoubleLE(off), buf.readDoubleLE(off + 8)]);
        off += 16;
      }
      rings.push(pts);
    }
    return { geom: { type, srid, rings }, off };
  }
  if (type === 6) {
    const n = buf.readUInt32LE(off);
    off += 4;
    const polys: DecodedPolygon[] = [];
    for (let i = 0; i < n; i++) {
      const d = decodeEwkb(buf, off);
      const g = d.geom as DecodedPolygon;
      if (g.srid !== null) throw new Error("sub-geometry has SRID");
      polys.push(g);
      off = d.off;
    }
    return { geom: { type, srid, polys }, off };
  }
  throw new Error(`type ${type}`);
}

export const polyArea = (p: DecodedPolygon): number =>
  ringArea(p.rings[0]!) - p.rings.slice(1).reduce((s, r) => s + ringArea(r), 0);

export const multiArea = (g: DecodedMulti): number => g.polys.reduce((s, p) => s + polyArea(p), 0);

export async function collectChunks(rec: EwkbRecord): Promise<Uint8Array[]> {
  const out: Uint8Array[] = [];
  for await (const c of rec.chunks()) out.push(c);
  return out;
}

export async function collectEwkb(rec: EwkbRecord): Promise<Buffer> {
  return Buffer.concat(await collectChunks(rec));
}

export async function drain(
  gen: AsyncGenerator<EwkbRecord, unknown, undefined>,
): Promise<{ records: { rec: EwkbRecord; bytes: Buffer }[]; summary: unknown }> {
  const records: { rec: EwkbRecord; bytes: Buffer }[] = [];
  for (;;) {
    const r = await gen.next();
    if (r.done) return { records, summary: r.value };
    records.push({ rec: r.value, bytes: await collectEwkb(r.value) });
  }
}
