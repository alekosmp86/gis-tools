// SPIKE S1 (CGEO-2200): bounded-memory streaming SHP polygon reader + EWKB producers. Throwaway.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';

export const MiB = 1 << 20;
export const SRID = 32721;

export const io = { reads: 0, bytes: 0, meter: null };
export const allocs = { max: 0, label: '' };
export function note(bytes, label) {
  if (bytes > allocs.max) {
    allocs.max = bytes;
    allocs.label = label;
  }
}
export function newBuf(n, label) {
  note(n, label);
  return Buffer.from(new ArrayBuffer(n));
}
export function newTA(C, n, label) {
  note(n * C.BYTES_PER_ELEMENT, label);
  return new C(n);
}

export class MemMeter {
  constructor(ms = 100) {
    this.peak = { rss: 0, heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 };
    this.samples = 0;
    this.t = setInterval(() => this.sample(), ms);
    this.t.unref();
    io.meter = this;
  }
  sample() {
    const m = process.memoryUsage();
    for (const k of Object.keys(this.peak)) if (m[k] > this.peak[k]) this.peak[k] = m[k];
    this.samples++;
  }
  stop() {
    clearInterval(this.t);
    this.sample();
    io.meter = null;
    return { ...this.peak, samples: this.samples, maxRSS_bytes: process.resourceUsage().maxRSS * 1024 };
  }
}

export async function readFull(fh, buf, bufPos, n, pos) {
  let done = 0;
  while (done < n) {
    const { bytesRead } = await fh.read(buf, bufPos + done, n - done, pos + done);
    if (bytesRead === 0) throw new Error(`unexpected EOF at ${pos + done}`);
    done += bytesRead;
  }
  io.reads++;
  io.bytes += n;
  if (io.meter && (io.reads & 31) === 0) io.meter.sample();
}

export class Win {
  constructor(fh, size, n = MiB) {
    this.fh = fh;
    this.size = size;
    this.buf = newBuf(n, 'file window');
    this.off = -1;
    this.len = 0;
  }
  async copy(dst, dpos, foff, n) {
    while (n > 0) {
      if (foff >= this.off && foff < this.off + this.len) {
        const k = Math.min(n, this.off + this.len - foff);
        this.buf.copy(dst, dpos, foff - this.off, foff - this.off + k);
        dpos += k;
        foff += k;
        n -= k;
      } else if (n >= this.buf.length) {
        await readFull(this.fh, dst, dpos, n, foff);
        return;
      } else {
        const seq = foff === this.off + this.len;
        const want = seq ? this.buf.length : Math.max(n, 64 * 1024);
        this.off = foff;
        this.len = Math.min(want, this.size - foff);
        await readFull(this.fh, this.buf, 0, this.len, foff);
      }
    }
  }
}

export async function openShp(path) {
  const fh = await fs.open(path, 'r');
  const st = await fh.stat();
  const h = Buffer.alloc(100);
  await readFull(fh, h, 0, 100, 0);
  if (h.readInt32BE(0) !== 9994) throw new Error('not a shapefile');
  return { fh, size: st.size, type: h.readInt32LE(32), declaredLen: h.readInt32BE(24) * 2 };
}

export async function* records(shp) {
  const pre = Buffer.alloc(52);
  let off = 100;
  while (off + 8 <= shp.size) {
    const n = Math.min(52, shp.size - off);
    await readFull(shp.fh, pre, 0, n, off);
    const recno = pre.readInt32BE(0);
    const clen = pre.readInt32BE(4) * 2;
    const type = pre.readInt32LE(8);
    const base = { recno, type, contentOffset: off + 8, contentLen: clen, numParts: 0, numPoints: 0, parts: null, pointsOffset: 0 };
    if (type === 5) {
      const numParts = pre.readInt32LE(8 + 36);
      const numPoints = pre.readInt32LE(8 + 40);
      if (clen !== 44 + 4 * numParts + 16 * numPoints) throw new Error(`rec ${recno}: content length mismatch`);
      const parts = newTA(Int32Array, numParts + 1, 'parts');
      if (numParts > 0) await readFull(shp.fh, Buffer.from(parts.buffer, 0, numParts * 4), 0, numParts * 4, off + 8 + 44);
      parts[numParts] = numPoints;
      base.numParts = numParts;
      base.numPoints = numPoints;
      base.parts = parts;
      base.pointsOffset = off + 8 + 44 + 4 * numParts;
    }
    yield base;
    off += 8 + clen;
  }
}

export class Meta {
  constructor() {
    this.cap = 0;
  }
  reset(n) {
    if (n > this.cap) {
      this.cap = Math.max(n, Math.ceil(this.cap * 1.5));
      const c = this.cap;
      this.minx = newTA(Float64Array, c, 'meta minx');
      this.miny = newTA(Float64Array, c, 'meta miny');
      this.maxx = newTA(Float64Array, c, 'meta maxx');
      this.maxy = newTA(Float64Array, c, 'meta maxy');
      this.area = newTA(Float64Array, c, 'meta area');
      this.probes = newTA(Float64Array, c * 8, 'meta probes');
      this.holeShell = newTA(Int32Array, c, 'meta holeShell');
      this.res = newTA(Int32Array, c, 'meta res best');
      this.bnd = newTA(Uint8Array, c, 'meta res bnd');
      this.resolved = newTA(Uint8Array, c, 'meta resolved');
      this.res2 = newTA(Int32Array, c, 'meta verify best');
      this.bnd2 = newTA(Uint8Array, c, 'meta verify bnd');
    }
    this.n = n;
    for (const k of ['minx', 'miny', 'maxx', 'maxy', 'area']) this[k].fill(0, 0, n);
    this.probes.fill(0, 0, n * 8);
    this.holeShell.fill(-1, 0, n);
    this.resolved.fill(0, 0, n);
  }
}

// Pass 1: per-ring bbox, signed area (shoelace, first vertex subtracted, Kahan), first 4 vertices.
export async function scanRecord(ctx, rec, meta) {
  const n = rec.numParts;
  const parts = rec.parts;
  meta.reset(n);
  const f = ctx.sf64;
  const sb = ctx.sbuf;
  const slicePts = sb.length / 16;
  const { minx, miny, maxx, maxy, area, probes: pr } = meta;
  const st = { short: 0, nonClosed: 0 };
  let ring = 0, x0 = 0, y0 = 0, prx = 0, pry = 0, sum = 0, c = 0, mnx = 0, mny = 0, mxx = 0, mxy = 0;
  for (let g = 0; g < rec.numPoints; g += slicePts) {
    const cnt = Math.min(slicePts, rec.numPoints - g);
    await readFull(ctx.shp.fh, sb, 0, cnt * 16, rec.pointsOffset + 16 * g);
    let i = 0;
    while (i < cnt) {
      const gi = g + i;
      while (parts[ring + 1] <= gi) ring++;
      const rs = parts[ring], re = parts[ring + 1];
      const segEnd = Math.min(cnt, re - g);
      let k = i;
      let li = gi - rs;
      if (li === 0) {
        x0 = f[2 * k]; y0 = f[2 * k + 1];
        mnx = mxx = x0; mny = mxy = y0;
        sum = 0; c = 0; prx = 0; pry = 0;
        pr[8 * ring] = x0; pr[8 * ring + 1] = y0;
        k++; li = 1;
      }
      for (; k < segEnd; k++, li++) {
        const x = f[2 * k], y = f[2 * k + 1];
        if (x < mnx) mnx = x; else if (x > mxx) mxx = x;
        if (y < mny) mny = y; else if (y > mxy) mxy = y;
        const rx = x - x0, ry = y - y0;
        const yy = prx * ry - rx * pry - c;
        const tt = sum + yy;
        c = (tt - sum) - yy;
        sum = tt;
        prx = rx; pry = ry;
        if (li < 4) { pr[8 * ring + 2 * li] = x; pr[8 * ring + 2 * li + 1] = y; }
      }
      i = segEnd;
      if (g + segEnd === re) {
        area[ring] = 0.5 * sum;
        minx[ring] = mnx; miny[ring] = mny; maxx[ring] = mxx; maxy[ring] = mxy;
        if (re - rs < 4) st.short++;
        if (prx !== 0 || pry !== 0) st.nonClosed++;
      }
    }
  }
  return st;
}

// ---------- hole -> shell assignment (strategy a) ----------
function buildStats() {
  return { pipTests: 0, shellsSwept: 0, edgesSwept: 0, cellVisits: 0, candidates: 0, pointsRead: 0, rounds: 0 };
}

async function assignRound(ctx, rec, meta, pend, npend, edge, best, bnd, S) {
  const pr = meta.probes;
  const px = newTA(Float64Array, npend, 'probe x');
  const py = newTA(Float64Array, npend, 'probe y');
  let gminx = Infinity, gminy = Infinity, gmaxx = -Infinity, gmaxy = -Infinity;
  for (let j = 0; j < npend; j++) {
    const h = pend[j];
    const x = 0.5 * (pr[8 * h + 2 * edge] + pr[8 * h + 2 * edge + 2]);
    const y = 0.5 * (pr[8 * h + 2 * edge + 1] + pr[8 * h + 2 * edge + 3]);
    px[j] = x; py[j] = y;
    if (x < gminx) gminx = x; if (x > gmaxx) gmaxx = x;
    if (y < gminy) gminy = y; if (y > gmaxy) gmaxy = y;
    best[h] = -1; bnd[h] = 0;
  }
  const w = gmaxx - gminx, hgt = gmaxy - gminy;
  let cs = Math.sqrt(Math.max(w * hgt, 1e-9) / Math.max(1, npend >> 1));
  cs = Math.max(cs, w / 1024, hgt / 1024, 1e-6);
  const gx = Math.floor(w / cs) + 1, gy = Math.floor(hgt / cs) + 1;
  const cellStart = newTA(Int32Array, gx * gy + 1, 'grid cellStart');
  const cellOf = newTA(Int32Array, npend, 'grid cellOf');
  for (let j = 0; j < npend; j++) {
    const cell = Math.floor((py[j] - gminy) / cs) * gx + Math.floor((px[j] - gminx) / cs);
    cellOf[j] = cell;
    cellStart[cell + 1]++;
  }
  for (let q = 0; q < gx * gy; q++) cellStart[q + 1] += cellStart[q];
  const fillPos = cellStart.slice(0, gx * gy);
  const items = newTA(Int32Array, npend, 'grid items');
  for (let j = 0; j < npend; j++) items[fillPos[cellOf[j]]++] = j;

  const candIdx = newTA(Int32Array, npend, 'cand idx');
  const sx = newTA(Float64Array, npend, 'cand sorted x');
  const sy = newTA(Float64Array, npend, 'cand sorted y');
  const wn = newTA(Int32Array, npend, 'cand winding');
  const bf = newTA(Uint8Array, npend, 'cand boundary');
  const f = ctx.sf64, sb = ctx.sbuf, slicePts = sb.length / 16;
  const parts = rec.parts;
  const { minx, miny, maxx, maxy, area } = meta;
  const bestA = newTA(Float64Array, npend, 'cand bestA').fill(Infinity);

  for (let s = 0; s < meta.n; s++) {
    if (!(area[s] < 0) || parts[s + 1] - parts[s] < 4) continue;
    if (minx[s] > gmaxx || maxx[s] < gminx || miny[s] > gmaxy || maxy[s] < gminy) continue;
    const cx0 = Math.max(0, Math.floor((minx[s] - gminx) / cs)), cx1 = Math.min(gx - 1, Math.floor((maxx[s] - gminx) / cs));
    const cy0 = Math.max(0, Math.floor((miny[s] - gminy) / cs)), cy1 = Math.min(gy - 1, Math.floor((maxy[s] - gminy) / cs));
    let nc = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        S.cellVisits++;
        const cell = cy * gx + cx;
        for (let q = cellStart[cell]; q < cellStart[cell + 1]; q++) {
          const j = items[q];
          if (px[j] >= minx[s] && px[j] <= maxx[s] && py[j] >= miny[s] && py[j] <= maxy[s]) candIdx[nc++] = j;
        }
      }
    }
    if (nc === 0) continue;
    S.shellsSwept++;
    S.pipTests += nc;
    const cand = candIdx.subarray(0, nc);
    cand.sort((a, b) => py[a] - py[b]);
    for (let q = 0; q < nc; q++) { sx[q] = px[cand[q]]; sy[q] = py[cand[q]]; wn[q] = 0; bf[q] = 0; }
    const minY = sy[0], maxY = sy[nc - 1];
    const rs = parts[s], re = parts[s + 1];
    let x1 = 0, y1 = 0;
    for (let g = rs; g < re; g += slicePts) {
      const cnt = Math.min(slicePts, re - g);
      await ctx.win.copy(sb, 0, rec.pointsOffset + 16 * g, cnt * 16);
      S.pointsRead += cnt;
      let k = 0;
      if (g === rs) { x1 = f[0]; y1 = f[1]; k = 1; }
      for (; k < cnt; k++) {
        const x2 = f[2 * k], y2 = f[2 * k + 1];
        S.edgesSwept++;
        const ylo = y1 < y2 ? y1 : y2, yhi = y1 < y2 ? y2 : y1;
        if (yhi >= minY && ylo <= maxY) {
          let lo = 0, hi = nc;
          while (lo < hi) { const m = (lo + hi) >> 1; if (sy[m] < ylo) lo = m + 1; else hi = m; }
          for (let j = lo; j < nc && sy[j] <= yhi; j++) {
            const x = sx[j], y = sy[j];
            const cr = (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
            if (cr === 0 && x >= (x1 < x2 ? x1 : x2) && x <= (x1 < x2 ? x2 : x1)) { bf[j] = 1; continue; }
            if (y1 <= y) { if (y2 > y && cr > 0) wn[j]++; }
            else if (y2 <= y && cr < 0) wn[j]--;
          }
        }
        x1 = x2; y1 = y2;
      }
      if (g + cnt < re) { /* carry x1,y1 */ }
    }
    const aa = -area[s];
    for (let q = 0; q < nc; q++) {
      const h = pend[cand[q]];
      if (bf[q]) bnd[h] = 1;
      else if (wn[q] !== 0 && aa < bestA[cand[q]]) { bestA[cand[q]] = aa; best[h] = s; }
    }
  }
}

export async function assignHoles(ctx, rec, meta, opts = {}) {
  const S = buildStats();
  const parts = rec.parts, n = meta.n;
  const holes = [];
  let degenerate = 0;
  for (let i = 0; i < n; i++) {
    if (meta.area[i] >= 0) {
      if (meta.area[i] > 0 && parts[i + 1] - parts[i] >= 4) holes.push(i); else degenerate++;
    }
  }
  S.holes = holes.length; S.degenerate = degenerate; S.ambiguous = 0; S.unassigned = 0; S.disagree = 0; S.verified = 0;
  let pend = Int32Array.from(holes);
  for (let round = 0; round < 3 && pend.length > 0; round++) {
    S.rounds++;
    await assignRound(ctx, rec, meta, pend, pend.length, round, meta.res, meta.bnd, S);
    const next = [];
    for (let j = 0; j < pend.length; j++) {
      const h = pend[j];
      if (meta.res[h] >= 0) meta.holeShell[h] = meta.res[h];
      if (meta.res[h] >= 0 && !meta.bnd[h]) meta.resolved[h] = 1; else next.push(h);
    }
    pend = Int32Array.from(next);
  }
  for (let j = 0; j < pend.length; j++) {
    if (meta.holeShell[pend[j]] >= 0) S.ambiguous++; else S.unassigned++;
  }
  if (opts.verify && holes.length > 0) {
    const all = Int32Array.from(holes);
    await assignRound(ctx, rec, meta, all, all.length, 1, meta.res2, meta.bnd2, S);
    for (const h of holes) {
      if (!meta.bnd2[h] && meta.res2[h] >= 0 && meta.resolved[h]) {
        S.verified++;
        if (meta.res2[h] !== meta.holeShell[h]) S.disagree++;
      }
    }
  }
  return S;
}

// ---------- sinks / output ----------
export class HashSink {
  constructor(fh = null) {
    this.h = crypto.createHash('sha1');
    this.bytes = 0;
    this.fh = fh;
  }
  async write(x) {
    this.bytes += typeof x === 'string' ? Buffer.byteLength(x) : x.length;
    this.h.update(x);
    if (this.fh) await this.fh.write(x);
  }
  digest() { return this.h.digest('hex'); }
}

export class Out {
  constructor(sink, { hex = false } = {}) {
    this.buf = newBuf(MiB, 'out buffer');
    this.pos = 0;
    this.total = 0;
    this.sink = sink;
    this.hex = hex;
  }
  u8(v) { this.buf[this.pos++] = v; }
  u32(v) { this.buf.writeUInt32LE(v, this.pos); this.pos += 4; }
  async flush() {
    if (!this.pos) return;
    let x;
    if (this.hex) { x = this.buf.toString('hex', 0, this.pos); note(x.length, 'hex string'); this.total += x.length; }
    else { x = this.buf.subarray(0, this.pos); this.total += this.pos; }
    this.pos = 0;
    await this.sink.write(x);
  }
  async room() { if (this.pos > this.buf.length - 64) await this.flush(); }
  async text(s) { await this.flush(); this.total += Buffer.byteLength(s); await this.sink.write(s); }
  async copy(win, foff, n) {
    while (n > 0) {
      if (this.pos === this.buf.length) await this.flush();
      const k = Math.min(n, this.buf.length - this.pos);
      await win.copy(this.buf, this.pos, foff, k);
      this.pos += k; foff += k; n -= k;
    }
  }
}

function header(out, type, srid, count) {
  out.u8(1);
  out.u32((type | (srid ? 0x20000000 : 0)) >>> 0);
  if (srid) out.u32(srid);
  if (count >= 0) out.u32(count);
}
async function ring(ctx, out, rec, i) {
  await out.room();
  const a = rec.parts[i], n = rec.parts[i + 1] - a;
  out.u32(n);
  await out.copy(ctx.win, rec.pointsOffset + 16 * a, 16 * n);
}

async function emitA(ctx, out, rec, meta) {
  const n = meta.n, parts = rec.parts;
  const cnt = new Int32Array(n + 1);
  for (let h = 0; h < n; h++) if (meta.holeShell[h] >= 0) cnt[meta.holeShell[h] + 1]++;
  for (let i = 0; i < n; i++) cnt[i + 1] += cnt[i];
  const fillp = cnt.slice(0, n);
  const list = new Int32Array(cnt[n]);
  for (let h = 0; h < n; h++) if (meta.holeShell[h] >= 0) list[fillp[meta.holeShell[h]]++] = h;
  let nShells = 0;
  for (let s = 0; s < n; s++) if (meta.area[s] < 0 && parts[s + 1] - parts[s] >= 4) nShells++;
  if (nShells === 0) return false;
  await out.room();
  header(out, 6, SRID, nShells);
  for (let s = 0; s < n; s++) {
    if (!(meta.area[s] < 0) || parts[s + 1] - parts[s] < 4) continue;
    await out.room();
    header(out, 3, 0, 1 + cnt[s + 1] - cnt[s]);
    await ring(ctx, out, rec, s);
    for (let q = cnt[s]; q < cnt[s + 1]; q++) await ring(ctx, out, rec, list[q]);
  }
  return true;
}

async function emitB(ctx, out, rec) {
  if (rec.numParts === 0) return false;
  await out.room();
  header(out, 3, SRID, rec.numParts);
  for (let i = 0; i < rec.numParts; i++) await ring(ctx, out, rec, i);
  return true;
}

const probeBuf = Buffer.alloc(25);
async function emitC(ctx, out, rec, meta) {
  const pr = meta.probes;
  let rows = 0;
  for (let i = 0; i < rec.numParts; i++) {
    const a = rec.parts[i], n = rec.parts[i + 1] - a;
    if (n === 0) continue;
    let probe = '\\N';
    if (n >= 2) {
      probeBuf[0] = 1; probeBuf.writeUInt32LE((1 | 0x20000000) >>> 0, 1); probeBuf.writeUInt32LE(SRID, 5);
      probeBuf.writeDoubleLE(0.5 * (pr[8 * i] + pr[8 * i + 2]), 9); probeBuf.writeDoubleLE(0.5 * (pr[8 * i + 1] + pr[8 * i + 3]), 17);
      probe = probeBuf.toString('hex');
    }
    const hole = meta.area[i] >= 0;
    await out.text(`${rec.recno}\t${i}\t${hole ? 't' : 'f'}\t${n}\t${meta.area[i]}\t${meta.minx[i]}\t${meta.miny[i]}\t${meta.maxx[i]}\t${meta.maxy[i]}\t${probe}\t`);
    await out.room();
    header(out, 3, SRID, 1);
    out.u32(n);
    await out.copy(ctx.win, rec.pointsOffset + 16 * a, 16 * n);
    await out.text('\n');
    rows++;
  }
  return rows > 0;
}

// ---------- driver ----------
export async function processFile(path, opts) {
  const { strategy = 'scan', sink = new HashSink(), verify = false, limit = Infinity, onRecordEnd = null } = opts;
  const shp = await openShp(path);
  const sbuf = newBuf(MiB, 'slice buffer');
  const ctx = { shp, win: new Win(shp.fh, shp.size), sbuf, sf64: new Float64Array(sbuf.buffer, sbuf.byteOffset, MiB / 8) };
  const out = strategy === 'a' || strategy === 'b' || strategy === 'c' ? new Out(sink, { hex: strategy === 'c' }) : null;
  const needMeta = strategy !== 'b';
  const meta = new Meta();
  const T = { scan: 0, assign: 0, emit: 0, other: 0 };
  const tot = {
    records: 0, nulls: 0, otherTypes: 0, points: 0, rings: 0, shells: 0, holes: 0, zeroAreaRings: 0, shortRings: 0, nonClosed: 0,
    emitted: 0, netArea: 0, shellArea: 0, holeArea: 0,
  };
  let kNet = 0, kShell = 0, kHole = 0, cNet = 0, cShell = 0, cHole = 0;
  const kahan = (which, v) => {
    if (which === 0) { const y = v - cNet; const t = kNet + y; cNet = (t - kNet) - y; kNet = t; }
    else if (which === 1) { const y = v - cShell; const t = kShell + y; cShell = (t - kShell) - y; kShell = t; }
    else { const y = v - cHole; const t = kHole + y; cHole = (t - kHole) - y; kHole = t; }
  };
  const rows = [];
  const assignTot = { ...buildStats(), holes: 0, degenerate: 0, ambiguous: 0, unassigned: 0, disagree: 0, verified: 0 };
  let giant = { recno: 0, points: 0, rings: 0, net: 0, shells: 0, holes: 0 };
  const t0 = performance.now();
  for await (const rec of records(shp)) {
    if (tot.records >= limit) break;
    tot.records++;
    if (rec.type === 0) { tot.nulls++; rows.push({ recno: rec.recno, parts: 0, points: 0, net: 0, shells: 0, holes: 0 }); if (onRecordEnd) onRecordEnd(rec.recno, out ? out.total : 0, false); continue; }
    if (rec.type !== 5) { tot.otherTypes++; continue; }
    tot.points += rec.numPoints; tot.rings += rec.numParts;
    let row = { recno: rec.recno, parts: rec.numParts, points: rec.numPoints, net: 0, shells: 0, holes: 0 };
    let ts = performance.now();
    if (needMeta) {
      const st = await scanRecord(ctx, rec, meta);
      tot.shortRings += st.short; tot.nonClosed += st.nonClosed;
      let rn = 0, rc = 0;
      for (let i = 0; i < rec.numParts; i++) {
        const a = meta.area[i];
        if (a < 0) { row.shells++; kahan(1, -a); } else { row.holes++; kahan(2, a); if (a === 0) tot.zeroAreaRings++; }
        const y = -a - rc; const t = rn + y; rc = (t - rn) - y; rn = t;
      }
      row.net = rn;
      kahan(0, rn);
      tot.shells += row.shells; tot.holes += row.holes;
      T.scan += performance.now() - ts;
    }
    let wrote = false;
    if (strategy === 'a') {
      ts = performance.now();
      const S = await assignHoles(ctx, rec, meta, { verify });
      for (const k of Object.keys(assignTot)) assignTot[k] += S[k] || 0;
      T.assign += performance.now() - ts;
    }
    if (out) {
      ts = performance.now();
      if (strategy === 'a') wrote = await emitA(ctx, out, rec, meta);
      else if (strategy === 'b') wrote = await emitB(ctx, out, rec);
      else wrote = await emitC(ctx, out, rec, meta);
      await out.flush();
      if (wrote) tot.emitted++;
      T.emit += performance.now() - ts;
    }
    if (onRecordEnd) onRecordEnd(rec.recno, out ? out.total : 0, wrote);
    rows.push(row);
    if (rec.numPoints > giant.points) giant = { recno: rec.recno, points: rec.numPoints, rings: rec.numParts, net: row.net, shells: row.shells, holes: row.holes };
    if (io.meter && (tot.records & 15) === 0) io.meter.sample();
  }
  tot.netArea = kNet; tot.shellArea = kShell; tot.holeArea = kHole;
  T.total = performance.now() - t0;
  await shp.fh.close();
  return { tot, rows, giant, T, assign: assignTot, outBytes: out ? out.total : 0, sink, io: { ...io, meter: undefined }, fileSize: shp.size };
}
