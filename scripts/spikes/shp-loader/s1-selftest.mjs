// SPIKE S1 self-test: tiny synthetic shapefile -> strategies a/b/c -> independent hand decoder.
// node s1-selftest.mjs
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { processFile } from './shp-lib.mjs';

const ring = (pts) => pts;
const rec1 = [
  ring([[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]]), // shell A (CW)
  ring([[2, 2], [4, 2], [4, 4], [2, 4], [2, 2]]), // hole (CCW)
  ring([[20, 20], [20, 30], [30, 30], [30, 20], [20, 20]]), // shell C (CW)
  ring([[10, 6], [10, 8], [8, 8], [8, 6], [10, 6]]), // hole whose first-edge midpoint lies ON shell A boundary (CCW)
  ring([[5, 5], [5, 6], [6, 6], [6, 5], [5, 5]]), // CW shell island inside A (area 1) -> own polygon
];
const rec3 = [ring([[0, 0], [0, 5], [5, 5], [5, 0], [0, 0]])];

function buildShp(recs) {
  const bodies = recs.map((rings, i) => {
    if (!rings) { const b = Buffer.alloc(8 + 4); b.writeInt32BE(i + 1, 0); b.writeInt32BE(2, 4); return b; }
    const np = rings.reduce((s, r) => s + r.length, 0);
    const clen = 44 + 4 * rings.length + 16 * np;
    const b = Buffer.alloc(8 + clen);
    b.writeInt32BE(i + 1, 0); b.writeInt32BE(clen / 2, 4);
    b.writeInt32LE(5, 8);
    b.writeInt32LE(rings.length, 8 + 36); b.writeInt32LE(np, 8 + 40);
    let o = 8 + 44, p = 0;
    for (const r of rings) { b.writeInt32LE(p, o); o += 4; p += r.length; }
    for (const r of rings) for (const [x, y] of r) { b.writeDoubleLE(x, o); b.writeDoubleLE(y, o + 8); o += 16; }
    return b;
  });
  const h = Buffer.alloc(100);
  h.writeInt32BE(9994, 0);
  h.writeInt32BE((100 + bodies.reduce((s, b) => s + b.length, 0)) / 2, 24);
  h.writeInt32LE(1000, 28); h.writeInt32LE(5, 32);
  return Buffer.concat([h, ...bodies]);
}

// Independent decoder (does not share code with the writer).
function decode(buf, off = 0) {
  if (buf[off] !== 1) throw new Error('not little endian');
  const t = buf.readUInt32LE(off + 1);
  off += 5;
  let srid = null;
  if (t & 0x20000000) { srid = buf.readUInt32LE(off); off += 4; }
  const type = t & 0x1fffffff;
  if (type === 3) {
    const nr = buf.readUInt32LE(off); off += 4;
    const rings = [];
    for (let r = 0; r < nr; r++) {
      const n = buf.readUInt32LE(off); off += 4;
      const pts = [];
      for (let k = 0; k < n; k++) { pts.push([buf.readDoubleLE(off), buf.readDoubleLE(off + 8)]); off += 16; }
      rings.push(pts);
    }
    return { geom: { type, srid, rings }, off };
  }
  if (type === 6) {
    const n = buf.readUInt32LE(off); off += 4;
    const polys = [];
    for (let i = 0; i < n; i++) { const d = decode(buf, off); if (d.geom.srid !== null) throw new Error('sub-geometry has SRID'); polys.push(d.geom); off = d.off; }
    return { geom: { type, srid, polys }, off };
  }
  throw new Error('type ' + type);
}
const rarea = (pts) => { let s = 0; for (let i = 0; i + 1 < pts.length; i++) s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]; return Math.abs(s / 2); };
const polyArea = (p) => rarea(p.rings[0]) - p.rings.slice(1).reduce((s, r) => s + rarea(r), 0);

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${extra}`); if (!ok) fails++; };

const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shp-selftest-'));
const file = path.join(dir, 't.shp');
await fs.writeFile(file, buildShp([rec1, null, rec3]));

for (const strategy of ['a', 'b', 'c']) {
  const chunks = [];
  const marks = [];
  const sink = { async write(x) { chunks.push(Buffer.from(typeof x === 'string' ? Buffer.from(x) : x)); } };
  const r = await processFile(file, { strategy, sink, verify: strategy === 'a', onRecordEnd: (n, tot, w) => marks.push([n, tot, w]) });
  const all = Buffer.concat(chunks);
  check(`${strategy}: records=3 nulls=1`, r.tot.records === 3 && r.tot.nulls === 1);
  check(`${strategy}: local net area 193+25 (b skips scan)`, strategy === 'b' || Math.abs(r.tot.netArea - 218) < 1e-9, `net=${r.tot.netArea}`);
  if (strategy === 'a') {
    // hole1 in A, hole2 (boundary probe) in A, island (CW) is its own shell, 3 shells
    const g = decode(all.subarray(0, marks[0][1])).geom;
    check('a: rec1 is MultiPolygon SRID 32721', g.type === 6 && g.srid === 32721);
    check('a: 3 polygons', g.polys.length === 3, `got ${g.polys.length}`);
    const rc = g.polys.map((p) => p.rings.length).join(',');
    check('a: ring counts 3,1,1 (A has 2 holes incl. boundary-probe hole)', rc === '3,1,1', rc);
    const area = g.polys.reduce((s, p) => s + polyArea(p), 0);
    check('a: decoded area = 100-4-4+100+1', Math.abs(area - 193) < 1e-9, `area=${area}`);
    check('a: assignment stats', r.assign.unassigned === 0 && r.assign.disagree === 0, JSON.stringify(r.assign));
    check('a: null record emits nothing', marks[1][2] === false && marks[1][1] === marks[0][1]);
    const g3 = decode(all.subarray(marks[1][1], marks[2][1])).geom;
    check('a: rec3 area 25', Math.abs(g3.polys.reduce((s, p) => s + polyArea(p), 0) - 25) < 1e-9);
  } else if (strategy === 'b') {
    const g = decode(all.subarray(0, marks[0][1])).geom;
    check('b: single Polygon SRID 32721 with all 5 rings in file order', g.type === 3 && g.srid === 32721 && g.rings.length === 5 && g.rings[1][0][0] === 2);
  } else {
    const lines = all.toString('utf8').split('\n').filter(Boolean);
    check('c: 5+1 rows', lines.length === 6, `${lines.length}`);
  }
}
// probe point decode by hand for strategy c row 3 (hole2): expected midpoint (10,7)
{
  const chunks = [];
  await processFile(file, { strategy: 'c', sink: { async write(x) { chunks.push(Buffer.from(x)); } } });
  const lines = Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean);
  const cols = lines[3].split('\t');
  const p = Buffer.from(cols[9], 'hex');
  check('c: probe is EWKB Point SRID 32721 at (10,7)', p.length === 25 && p[0] === 1 && p.readUInt32LE(1) === 0x20000001 && p.readUInt32LE(5) === 32721 && p.readDoubleLE(9) === 10 && p.readDoubleLE(17) === 7);
  const g = decode(Buffer.from(cols[10], 'hex')).geom;
  check('c: ring polygon geom decodes, 5 pts, is_hole=t', g.type === 3 && g.srid === 32721 && g.rings.length === 1 && g.rings[0].length === 5 && cols[2] === 't', `is_hole=${cols[2]} area=${cols[4]}`);
}
await fs.rm(dir, { recursive: true, force: true });
console.log(fails === 0 ? 'ALL PASS' : `${fails} FAILED`);
process.exit(fails ? 1 : 0);
