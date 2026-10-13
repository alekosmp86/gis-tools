// SPIKE S2 (CGEO-2200): experiments E1..E5, E7 + CLI runner. TEMP tables only. Throwaway.
// NOTE: none of this SQL has been executed against PostGIS by the author (no DB available).
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  Session, log, sec, mib, num, one, f2, table, stats, parseArgs, startRssMeter, writeResult, READ_ALLOWLIST, MiB,
  buildIndex, streamRecords, readLocalCsv, defaultCsv, SQL, sendChunks, loadRecord, secondConnectionReadTest, hostKind,
  errMsg, gateSql, statsSql, MAKE_FIXED, TARGET_COLS, SWAP_INSERT, E5_CTAS, PreflightError,
} from './s2-lib.mjs';

const now = () => performance.now();

const TRACKER = {
  cobertura5g: { rows: 107224, area: 20860298118.46 },
  nbiot: { rows: 92256, vertices: 9446620, area: 138110828107.77 },
};

export const GATE_SQL = { work: gateSql('pg_temp.spike_work'), pieces2: gateSql('pg_temp.spike_pieces2') };
const RAW_AREA_SQL = 'SELECT count(*)::int AS n, sum(ST_NPoints(geom))::float8 AS pts, sum(ST_Area(geom))::float8 AS area FROM pg_temp.spike_raw';

export function evalGates(g, rawArea, tol) {
  const absDiff = Math.abs(g.area - rawArea);
  const rel = rawArea ? absDiff / Math.abs(rawArea) : NaN;
  const gates = [
    ['pieces exist (usable > 0)', g.usable > 0],
    ['max vertices per piece <= 1024', g.maxv <= 1024],
    ['invalid pieces = 0', g.invalid === 0],
    [`area rel. diff <= ${tol}`, rel <= tol],
  ];
  return { gates, rel, absDiff, pass: gates.every((x) => x[1]) };
}

function prefixTarget(file) {
  const b = path.basename(file || '').toLowerCase();
  return b.startsWith('nruruguay') ? 'cobertura5g' : b.startsWith('nbioturuguay') ? 'nbiot' : null;
}

// ---------- shared context / lazy raw load ----------
async function ensureIndex(ctx) {
  if (ctx.state.index) return ctx.state.index;
  if (ctx.dry) return (ctx.state.index = { dry: true, recs: [{ recno: 1, size: 1 }], giant: { recno: 1, size: 1 }, tot: {}, totalBytes: 0 });
  log(`pass 0: scanning ${ctx.file} (strategy a, size index only)`);
  const t0 = now();
  const idx = await buildIndex(ctx.file);
  log(`pass 0 done in ${sec(now() - t0)} s: ${idx.recs.length} records, EWKB ${mib(idx.totalBytes)}, giant rec ${idx.giant.recno} = ${mib(idx.giant.size)}`);
  ctx.state.index = idx;
  ctx.csv = readLocalCsv(ctx.csvPath);
  if (!ctx.csv) log(`(local S1 CSV not found at ${ctx.csvPath}; comparisons with local values skipped)`);
  return idx;
}

async function ensureLoaded(ctx) {
  if (ctx.state.loaded) return ctx.state.loaded;
  const s = ctx.s;
  const idx = await ensureIndex(ctx);
  const res = { name: 'load' };
  await s.q(SQL.createRaw);
  await s.q(SQL.createChunks);
  const t0 = now();
  if (ctx.dry) {
    await loadRecord(s, 1, Buffer.alloc(1), ctx.chunkBytes);
    await loadRecord(s, 1, Buffer.alloc(1), ctx.chunkBytes, true);
  } else {
    let n = 0, nextLog = now() + 5000, bigN = 0;
    const meter = startRssMeter();
    await streamRecords(ctx.file, idx, async (rec, buf) => {
      const how = await loadRecord(s, rec.recno, buf, ctx.chunkBytes);
      n++;
      if (how === 'chunks') { bigN++; log(`  record ${rec.recno} (${mib(buf.length)}) loaded via chunks`); }
      if (now() > nextLog) { log(`  loaded ${n}/${idx.recs.length} records`); nextLog = now() + 5000; }
    });
    res.rss = meter.stop();
    res.bigRecords = bigN;
  }
  res.secs = (now() - t0) / 1000;
  const r = one(await s.q(RAW_AREA_SQL));
  res.rows = num(r.n); res.points = num(r.pts); res.area = num(r.area);
  if (ctx.csv) {
    res.localArea = ctx.csv.area; res.localPoints = ctx.csv.points; res.localRecords = ctx.csv.records;
    res.areaDiffVsLocal = res.area - ctx.csv.area;
    res.loadOk = res.rows === ctx.csv.records && res.points === ctx.csv.points && Math.abs(res.areaDiffVsLocal) < ctx.areaTol;
  } else res.loadOk = Number.isFinite(res.rows) && res.rows === idx.recs.length;
  table('LOAD of all records into pg_temp.spike_raw (E1(ii) method for records > chunk size)', [
    ['seconds', f2(res.secs)], ['rows in spike_raw', res.rows], ['sum ST_NPoints', res.points], ['sum ST_Area', f2(res.area)],
    ...(ctx.csv ? [['local rows/points/area (S1 CSV)', `${ctx.csv.records} / ${ctx.csv.points} / ${f2(ctx.csv.area)}`], ['area diff vs local', f2(res.areaDiffVsLocal)]] : []),
    ['load check', res.loadOk ? 'OK' : 'MISMATCH'],
  ]);
  ctx.state.loaded = res;
  ctx.results.load = res;
  return res;
}

// ---------- E1 ----------
export async function e1(ctx) {
  const s = ctx.s;
  const r = { name: 'E1', verdict: 'PASS', variants: {} };
  const idx = await ensureIndex(ctx);
  const g = idx.giant;
  log(`E1: giant record = #${g.recno}, EWKB ${mib(g.size)}`);
  await s.q('CREATE TEMP TABLE pg_temp.spike_e1 (variant text, ewkb bytea, geom geometry)');
  await s.q(SQL.createChunks);
  let buf = null;
  if (!ctx.dry) {
    buf = Buffer.allocUnsafe(g.size);
    await streamRecords(ctx.file, idx, async (rec, b) => { b.copy(buf); }, (rec) => rec.recno === g.recno);
    log(`  giant EWKB built in Node (${mib(buf.length)})`);
  } else buf = Buffer.alloc(1);

  const convert = (v) => `UPDATE pg_temp.spike_e1 SET geom = ST_SetSRID(ST_GeomFromEWKB(ewkb),32721) WHERE variant = '${v}'`;
  // (i) one bytea parameter
  const vi = (r.variants.param = { sendSecs: null, convertSecs: null, error: null });
  try {
    const m = startRssMeter();
    log('  (i) sending ONE bytea parameter ...');
    const a = await s.q("INSERT INTO pg_temp.spike_e1(variant, ewkb) VALUES ('param', $1::bytea)", [buf], { label: 'E1(i) send' });
    vi.sendSecs = a.secs; vi.rss = m.stop();
    log(`  (i) sent in ${sec(a.secs * 1000)} s; Node peak RSS ${mib(vi.rss.rssPeak)} (delta ${mib(vi.rss.rssDelta)})`);
    const b = await s.q(convert('param'), [], { label: 'E1(i) convert' });
    vi.convertSecs = b.secs;
  } catch (e) { vi.error = `[${e.code || e.name}] ${errMsg(e, 300)}`; r.verdict = 'FAIL'; }
  // (ii) chunks
  const vc = (r.variants.chunks = { sendSecs: null, assembleSecs: null, convertSecs: null, chunks: null, error: null });
  try {
    const m = startRssMeter();
    log(`  (ii) sending ${Math.ceil(buf.length / ctx.chunkBytes)} chunk(s) of ${mib(ctx.chunkBytes)} ...`);
    const t0 = now();
    vc.chunks = await sendChunks(s, buf, ctx.chunkBytes);
    vc.sendSecs = (now() - t0) / 1000; vc.rss = m.stop();
    log(`  (ii) sent in ${sec(now() - t0)} s; Node peak RSS ${mib(vc.rss.rssPeak)} (delta ${mib(vc.rss.rssDelta)})`);
    const a = await s.q("INSERT INTO pg_temp.spike_e1(variant, ewkb) SELECT 'chunks', string_agg(data, ''::bytea ORDER BY seq) FROM pg_temp.spike_chunks", [], { label: 'E1(ii) reassemble' });
    vc.assembleSecs = a.secs;
    const b = await s.q(convert('chunks'), [], { label: 'E1(ii) convert' });
    vc.convertSecs = b.secs;
  } catch (e) { vc.error = `[${e.code || e.name}] ${errMsg(e, 300)}`; r.verdict = 'FAIL'; }

  // compare
  const cmp = await s.q('SELECT variant, octet_length(ewkb)::float8 AS bytes, ST_NPoints(geom) AS npts, ST_NumGeometries(geom) AS ngeom, ST_Area(geom)::float8 AS area, ST_SRID(geom) AS srid FROM pg_temp.spike_e1 ORDER BY variant');
  r.geoms = {};
  for (const x of cmp.rows) r.geoms[x.variant] = { bytes: num(x.bytes), npts: num(x.npts), ngeom: num(x.ngeom), area: num(x.area), srid: num(x.srid) };
  try {
    const nr = await s.q('SELECT variant, ST_NRings(geom) AS nrings FROM pg_temp.spike_e1 ORDER BY variant');
    for (const x of nr.rows) if (r.geoms[x.variant]) r.geoms[x.variant].nrings = num(x.nrings);
  } catch (e) { log(`  (ST_NRings unavailable: ${errMsg(e, 100)}; ring comparison skipped)`); }
  if (!ctx.dry) {
    try { r.bytesEqual = one(await s.q("SELECT (SELECT ewkb FROM pg_temp.spike_e1 WHERE variant='param') = (SELECT ewkb FROM pg_temp.spike_e1 WHERE variant='chunks') AS eq")).eq; } catch { r.bytesEqual = null; }
  }
  const p = r.geoms.param, c = r.geoms.chunks;
  if (p && c) {
    r.paramEqChunks = p.npts === c.npts && p.nrings === c.nrings && Math.abs(p.area - c.area) < ctx.areaTol;
    if (!r.paramEqChunks) r.verdict = 'FAIL';
  } else if (!ctx.dry) r.verdict = 'FAIL';
  const loc = ctx.csv && ctx.csv.map.get(g.recno);
  if (loc) {
    r.local = { points: loc.points, rings: loc.parts, area: loc.net };
    for (const [k, v] of Object.entries(r.geoms)) {
      v.vsLocal = { nptsOk: v.npts === loc.points, ringsOk: v.nrings === undefined ? null : v.nrings === loc.parts, areaDiff: v.area - loc.net };
      if (!v.vsLocal.nptsOk || v.vsLocal.ringsOk === false || Math.abs(v.vsLocal.areaDiff) >= ctx.areaTol) r.verdict = 'FAIL';
    }
  }
  const rows = [['EWKB size', mib(g.size)], ['chunk size', mib(ctx.chunkBytes)]];
  for (const [k, v] of Object.entries(r.variants)) {
    rows.push([`(${k}) send s`, v.sendSecs === null ? '-' : f2(v.sendSecs)]);
    if (k === 'chunks') rows.push([`(${k}) reassemble s`, v.assembleSecs === null ? '-' : f2(v.assembleSecs)]);
    rows.push([`(${k}) convert s`, v.convertSecs === null ? '-' : f2(v.convertSecs)]);
    rows.push([`(${k}) Node peak RSS`, v.rss ? `${mib(v.rss.rssPeak)} (maxRSS ${mib(v.rss.maxRSS)})` : '-']);
    rows.push([`(${k}) error`, v.error || 'none']);
  }
  for (const [k, v] of Object.entries(r.geoms)) rows.push([`${k} npts/rings/area`, `${v.npts} / ${v.nrings ?? '?'} / ${f2(v.area)}`]);
  if (loc) rows.push(['local (S1 CSV) points/rings/area', `${loc.points} / ${loc.parts} / ${f2(loc.net)}`]);
  rows.push(['param == chunks', r.paramEqChunks === undefined ? '-' : r.paramEqChunks], ['EWKB bytes equal', String(r.bytesEqual)]);
  table('E1 transport of the giant geometry', rows);
  await s.q('DROP TABLE IF EXISTS pg_temp.spike_e1');
  await s.q('DROP TABLE IF EXISTS pg_temp.spike_chunks');
  buf = null;
  ctx.results.E1 = r;
  return r;
}

// ---------- E2 ----------
export async function e2(ctx) {
  const s = ctx.s;
  const r = { name: 'E2', verdict: 'PASS' };
  const load = await ensureLoaded(ctx);
  if (!load.loadOk) r.verdict = 'FAIL';
  log('E2: ST_Subdivide(raw,256) into pg_temp.spike_work (whole file; no progress available inside this statement) ...');
  const a = await s.q('CREATE TEMP TABLE pg_temp.spike_work AS SELECT row_number() OVER () AS id, d.geom AS piece, NULL::geometry AS fixed FROM (SELECT ST_Subdivide(geom,256) AS geom FROM pg_temp.spike_raw) d', [], { label: 'E2 subdivide' });
  r.subdivideSecs = a.secs;
  // btree on id: E3 batches do WHERE id > $1 AND id <= $2; without it each batch would seq-scan every piece.
  const b = await s.q('CREATE INDEX spike_work_id ON pg_temp.spike_work (id)', [], { label: 'E2 index' });
  r.indexSecs = b.secs;
  const c = await s.q('ANALYZE pg_temp.spike_work');
  r.analyzeSecs = c.secs;
  const st = one(await s.q('SELECT count(*)::int AS n, max(ST_NPoints(piece))::int AS maxv, sum(ST_NPoints(piece))::float8 AS sumv FROM pg_temp.spike_work'));
  r.pieces = num(st.n); r.maxVertices = num(st.maxv); r.sumVertices = num(st.sumv);
  if (!ctx.dry && !(r.pieces > 0 && r.maxVertices <= 256 + 0)) { r.note = 'max piece vertices > 256 (ST_Subdivide limit) or no pieces'; }
  table('E2 phase A: subdivide', [['subdivide s', f2(r.subdivideSecs)], ['btree(id) s', f2(r.indexSecs)], ['analyze s', f2(r.analyzeSecs)], ['pieces', r.pieces], ['max vertices/piece', r.maxVertices], ['sum vertices', r.sumVertices], ['load s (reference)', f2(load.secs)]]);
  ctx.state.pieces = r.pieces;
  ctx.results.E2 = r;
  return r;
}

// ---------- E3 ----------
export async function e3(ctx) {
  const s = ctx.s;
  const r = { name: 'E3', verdict: 'PASS', batch: ctx.batch, batches: [] };
  if (ctx.dry) ctx.state.pieces = ctx.state.pieces || 10000;
  const total = ctx.state.pieces;
  if (!total) throw new Error('E3 needs E2 first');
  const N = Math.ceil(total / ctx.batch);
  log(`E3: repairing ${total} pieces in ${N} batch(es) of ${ctx.batch} (each batch = own implicit transaction)`);
  const sql = `UPDATE pg_temp.spike_work SET fixed = ${MAKE_FIXED.replace('%P%', 'piece')} WHERE id > $1 AND id <= $2`;
  const sizeBefore = await s.workSizes();
  const t0 = now();
  let done = 0;
  const to = ctx.dry ? Math.min(N, 1) : N;
  for (let n = 1; n <= to; n++) {
    const lo = (n - 1) * ctx.batch, hi = Math.min(total, n * ctx.batch);
    const x = await s.q(sql, [lo, hi], { label: `E3 batch ${n}/${N}` });
    done += hi - lo;
    r.batches.push(x.secs);
    const el = (now() - t0) / 1000, rate = done / el, eta = (total - done) / rate;
    log(`  batch ${n}/${N}: ${f2(x.secs)} s | pieces ${done}/${total} | ${rate.toFixed(0)} pieces/s | elapsed ${f2(el)} s | ETA ${f2(eta)} s`);
  }
  r.totalSecs = (now() - t0) / 1000;
  const sizeAfter = await s.workSizes();
  r.sizes = { before: sizeBefore, after: sizeAfter };
  r.dist = stats(r.batches);
  const ne = one(await s.q('SELECT count(*) FILTER (WHERE fixed IS NULL)::int AS nulls, count(*) FILTER (WHERE fixed IS NOT NULL AND ST_IsEmpty(fixed))::int AS empties FROM pg_temp.spike_work'));
  r.nulls = num(ne.nulls); r.empties = num(ne.empties);
  table('E3 phase B: repair in id batches', [
    ['batch size', ctx.batch], ['batches', N], ['total s', f2(r.totalSecs)],
    ['batch s min/median/p95/max', [r.dist.min, r.dist.median, r.dist.p95, r.dist.max].map((v) => f2(v)).join(' / ')],
    ['NULL fixed (CollectionExtract)', r.nulls], ['EMPTY fixed', r.empties],
    ['uniformity (max/median)', f2(r.dist.max / r.dist.median)],
    ['pg_relation_size spike_work before -> after', `${mib(sizeBefore.tbl)} -> ${mib(sizeAfter.tbl)}`],
    ['pg_relation_size spike_work_id before -> after', `${mib(sizeBefore.idx)} -> ${mib(sizeAfter.idx)}`],
  ]);
  console.log('  note: the UPDATEs are mostly non-HOT (fixed is a large new value) and leave dead tuples, so spike_work grows; later scans (E4 gates, swap INSERT) read the inflated table.');
  ctx.results.E3 = r;
  return r;
}

// ---------- E4 ----------
export async function e4(ctx) {
  const s = ctx.s;
  const r = { name: 'E4', verdict: 'PASS' };
  const rawArea = ctx.dry ? NaN : ctx.state.loaded.area;
  log('E4: computing gates over spike_work ...');
  const gq = await s.q(GATE_SQL.work, [], { label: 'E4 gates' });
  const g = ctx.dry ? { n: NaN, usable: NaN, nullempty: NaN, maxv: NaN, invalid: NaN, area: NaN } : Object.fromEntries(Object.entries(gq.rows[0]).map(([k, v]) => [k, num(v)]));
  const ev = evalGates(g, rawArea, ctx.tolerance);
  r.gatesSecs = gq.secs; r.gates = g; r.rawArea = rawArea; r.areaRelDiff = ev.rel; r.areaAbsDiff = ev.absDiff;
  r.gateResults = Object.fromEntries(ev.gates);
  table('E4 gates', [...ev.gates.map(([k, v]) => [k, v ? 'PASS' : 'FAIL']),
    ['pieces / usable / null-or-empty', `${g.n} / ${g.usable} / ${g.nullempty}`], ['max vertices', g.maxv], ['invalid', g.invalid],
    ['area raw', f2(rawArea)], ['area pieces', f2(g.area)], ['area abs diff (m2)', f2(ev.absDiff)], ['area rel diff', ev.rel.toExponential(3)], ['gates s', f2(r.gatesSecs)]]);
  await s.q(`CREATE TEMP TABLE pg_temp.spike_target ${TARGET_COLS}`);
  await s.q('CREATE INDEX spike_target_geom ON pg_temp.spike_target USING gist (geom)');
  if (!ctx.dry && !ev.pass) {
    r.verdict = 'FAIL'; r.swapDone = false;
    log('E4: a gate failed -> swap NOT executed (this is what the real loader would do)');
    ctx.results.E4 = r;
    return r;
  }
  log('E4: swap transaction (TRUNCATE + INSERT of staged pieces) ...');
  const t0 = now();
  await s.q('BEGIN');
  let ok = false;
  try {
    const tr = await s.q('TRUNCATE pg_temp.spike_target');
    const ins = await s.q(SWAP_INSERT('pg_temp.spike_target', 'pg_temp.spike_work'), [], { label: 'E4 swap insert' });
    r.truncateSecs = tr.secs; r.insertSecs = ins.secs; r.insertedRows = ins.rowCount;
    await s.q('COMMIT');
    ok = true;
  } finally { if (!ok) { try { await s.q('ROLLBACK'); } catch { /* ignore */ } } }
  r.swapTxnSecs = (now() - t0) / 1000;
  r.swapDone = true;
  await s.q('ANALYZE pg_temp.spike_target');
  table('E4 phase C: swap transaction (lock window of the staged design) - LOWER BOUND', [
    ['BEGIN..COMMIT s (timed)', f2(r.swapTxnSecs)], ['TRUNCATE s', f2(r.truncateSecs)], ['INSERT s (incl. PK + GiST maintenance)', f2(r.insertSecs)], ['rows inserted', r.insertedRows],
    ['included', 'PK (gid serial) and GiST(geom) index maintenance, like the real tables'],
    ['EXCLUDED', 'WAL logging (TEMP tables are not WAL-logged) and concurrent readers / lock waits => still a lower bound']]);
  ctx.state.swapped = true;
  if (ctx.compare && !ctx.dry) {
    try {
      r.secondConnectionReadTest = await secondConnectionReadTest(ctx.compare, { keepAliveMs: ctx.keepAliveMs, acceptParamLogging: ctx.acceptParamLogging });
      table('E4 second-connection read test (only proves a second session can read the target count/max fechacarga; NOT a lost-reply recovery test)', Object.entries(r.secondConnectionReadTest).map(([k, v]) => [k, String(v)]));
    } catch (e) { log(`second-connection read test failed: ${errMsg(e, 200)}`); r.secondConnectionReadTest = { error: errMsg(e, 200) }; }
  } else if (ctx.dry) {
    await secondConnectionReadTest(ctx.compare || 'cobertura5g', { dry: true, acceptParamLogging: ctx.acceptParamLogging });
  }
  ctx.results.E4 = r;
  return r;
}

// ---------- E5 ----------
export async function e5(ctx) {
  const s = ctx.s;
  const r = { name: 'E5', verdict: 'PASS' };
  const load = await ensureLoaded(ctx);
  const rawArea = ctx.dry ? NaN : load.area;
  await s.q(`CREATE TEMP TABLE pg_temp.spike_target2 ${TARGET_COLS}`);
  await s.q('CREATE INDEX spike_target2_geom ON pg_temp.spike_target2 USING gist (geom)');
  log('E5: single-transaction baseline (subdivide + repair + gates + insert) ...');
  const t0 = now();
  await s.q('BEGIN');
  let ok = false;
  try {
    const a = await s.q(E5_CTAS('pg_temp.spike_raw'), [], { label: 'E5 subdivide+repair' });
    r.piecesSecs = a.secs;
    const gq = await s.q(GATE_SQL.pieces2, [], { label: 'E5 gates' });
    r.gatesSecs = gq.secs;
    const g = ctx.dry ? { usable: NaN, maxv: NaN, invalid: NaN, area: NaN } : Object.fromEntries(Object.entries(gq.rows[0]).map(([k, v]) => [k, num(v)]));
    const ev = evalGates(g, rawArea, ctx.tolerance);
    r.gates = g; r.areaRelDiff = ev.rel; r.areaAbsDiff = ev.absDiff;
    if (!ctx.dry && !ev.pass) { r.verdict = 'FAIL'; log(`E5: gate failed: ${ev.gates.filter((x) => !x[1]).map((x) => x[0]).join('; ')}`); } else {
      const tr = await s.q('TRUNCATE pg_temp.spike_target2');
      const ins = await s.q(SWAP_INSERT('pg_temp.spike_target2', 'pg_temp.spike_pieces2'), [], { label: 'E5 insert' });
      r.truncateSecs = tr.secs; r.insertSecs = ins.secs; r.insertedRows = ins.rowCount;
    }
    await s.q('COMMIT');
    ok = true;
  } finally { if (!ok) { try { await s.q('ROLLBACK'); } catch { /* ignore */ } } }
  r.totalSecs = (now() - t0) / 1000;
  const e2r = ctx.results.E2, e3r = ctx.results.E3, e4r = ctx.results.E4;
  const staged = e2r && e3r && e4r ? (e2r.subdivideSecs + e2r.indexSecs + e2r.analyzeSecs + e3r.totalSecs + (e4r.gatesSecs || 0) + (e4r.swapTxnSecs || 0)) : null;
  r.stagedTotalSecs = staged;
  if (!ctx.dry) {
    const c = one(await s.q('SELECT (SELECT count(*) FROM pg_temp.spike_target2)::int AS n2, (SELECT count(*) FROM pg_temp.spike_target)::int AS n1').catch(() => ({ rows: [{}] })));
    r.rowsSingle = num(c.n2); r.rowsStaged = num(c.n1);
  }
  table('E5 single-swap baseline (one transaction, TEMP only)', [
    ['subdivide+repair CTAS s', f2(r.piecesSecs)], ['gates s', f2(r.gatesSecs)], ['TRUNCATE+INSERT s', f2((r.truncateSecs || 0) + (r.insertSecs || 0))],
    ['TOTAL single transaction s', f2(r.totalSecs)],
    ['staged A+index+B+gates+C s (E2..E4)', staged === null ? 'n/a (run run-all.mjs)' : f2(staged)],
    ['rows single vs staged', `${r.rowsSingle ?? '-'} vs ${r.rowsStaged ?? '-'}`],
    ['E4 lock window s (swap txn only)', e4r ? f2(e4r.swapTxnSecs) : 'n/a'],
  ]);
  console.log('  NOTE: E5 is NOT like-for-like with the proven DO swap (385 s NR / ~35 min NBIoT): it adds a row_number() window and an ORDER BY id sort, runs on a warm temp table with no _src copy. Compare E5 against E2+E3+E4 of THIS run, never against the tracker numbers.');
  ctx.results.E5 = r;
  return r;
}

// ---------- E7 ----------
export async function e7(ctx) {
  const s = ctx.s;
  const r = { name: 'E7', verdict: 'PASS' };
  if (!ctx.compare) throw new Error('E7 needs --compare cobertura5g|nbiot');
  if (!READ_ALLOWLIST.includes(ctx.compare)) throw new Error('--compare must be cobertura5g|nbiot');
  if (!ctx.state.swapped && !ctx.dry) { r.verdict = 'FAIL'; r.note = 'no swapped TEMP target (E4 did not run or a gate failed)'; ctx.results.E7 = r; log('E7 skipped: ' + r.note); return r; }
  log('E7: stats on pg_temp.spike_target ...');
  const a = await s.q(statsSql('pg_temp.spike_target'), [], { label: 'E7 temp target stats' });
  log(`E7: stats on public.${ctx.compare} (read-only SELECT) ...`);
  const b = await s.q(statsSql(`public.${ctx.compare}`), [], { label: `E7 public.${ctx.compare} stats` });
  const A = ctx.dry ? {} : Object.fromEntries(Object.entries(a.rows[0]).map(([k, v]) => [k, k === 'extent' ? v : num(v)]));
  const B = ctx.dry ? {} : Object.fromEntries(Object.entries(b.rows[0]).map(([k, v]) => [k, k === 'extent' ? v : num(v)]));
  r.temp = A; r.loaded = B; r.tracker = TRACKER[ctx.compare];
  const dArea = A.area - B.area;
  r.diff = { rows: A.n - B.n, verts: A.verts - B.verts, maxv: A.maxv - B.maxv, area: dArea, invalid: A.invalid - B.invalid };
  const hard = !(Math.abs(dArea) < 1) || A.invalid !== 0;
  const soft = A.n !== B.n || A.verts !== B.verts;
  r.verdict = ctx.dry ? 'PASS' : hard ? 'FAIL' : soft ? 'WARN' : 'PASS';
  table(`E7 verification: TEMP target vs public.${ctx.compare}`, [
    ['metric', 'temp | loaded | diff'],
    ['rows', `${A.n} | ${B.n} | ${r.diff.rows}`], ['sum vertices', `${A.verts} | ${B.verts} | ${r.diff.verts}`], ['max vertices', `${A.maxv} | ${B.maxv} | ${r.diff.maxv}`],
    ['area m2', `${f2(A.area)} | ${f2(B.area)} | ${f2(dArea)}`], ['invalid', `${A.invalid} | ${B.invalid} | ${r.diff.invalid}`],
    ['extent', `${A.extent}\n  ${B.extent}`],
    ['tracker values', JSON.stringify(r.tracker)],
    ['verdict', `${r.verdict}${r.verdict === 'WARN' ? ' (area OK but rows/vertices differ: expected only if ST_Subdivide input order/GEOS version differ from the original load; investigate before treating as a defect)' : ''}`],
  ]);
  ctx.results.E7 = r;
  return r;
}

export const STEPS = { e1, e2, e3, e4, e5, e7 };

// ---------- CLI runner ----------
export async function runCli(name, stepNames, argv = process.argv.slice(2)) {
  try { return await runCli0(name, stepNames, argv); } catch (e) { console.error(`ERROR: ${errMsg(e, 400)}`); process.exitCode = 2; return null; }
}

async function runCli0(name, stepNames, argv) {
  const f = parseArgs(argv);
  const dry = !!f['dry-run'];
  const file = typeof f.file === 'string' ? path.resolve(f.file) : null;
  const compare = typeof f.compare === 'string' ? f.compare : file ? prefixTarget(file) : null;
  if (!file) throw new Error('--file <path.shp> is required');
  if (compare && !READ_ALLOWLIST.includes(compare)) throw new Error(`--compare must be one of ${READ_ALLOWLIST.join('|')}`);
  if (stepNames.includes('e7') && !compare) throw new Error('--compare cobertura5g|nbiot is required for E7');
  const base = path.basename(file).toLowerCase();
  if (base.startsWith('lteuruguay') && !f['include-lte']) throw new Error('LTE file refused without --include-lte (large temp-disk and time footprint)');
  if (!dry && !fs.existsSync(file)) throw new Error(`file not found: ${file}`);
  const expect = prefixTarget(file);
  if (compare && expect && expect !== compare) log(`WARNING: file prefix suggests ${expect} but --compare is ${compare}`);
  if (!expect && compare) log('WARNING: file prefix is neither NRUruguay nor NBIoTUruguay; E7 comparison against that table is probably meaningless');
  const int = (k, d) => { const v = f[k] === undefined ? d : Number(f[k]); if (!Number.isInteger(v) || v <= 0) throw new Error(`--${k} must be a positive integer`); return v; };
  const ctx = {
    dry, file, compare, state: {}, results: {},
    batch: int('batch', 5000),
    chunkBytes: int('chunk-mb', 8) * MiB,
    tolerance: f.tolerance ? Number(f.tolerance) : 1e-6,
    areaTol: f['area-tol'] ? Number(f['area-tol']) : 1,
    csvPath: typeof f.csv === 'string' ? f.csv : defaultCsv(file),
    keepAliveMs: int('keepalive-ms', 30000),
    acceptParamLogging: !!f['accept-param-logging'],
  };
  const tcp = f['no-tcp-keepalive'] ? null : { idle: int('tcp-idle', 60), interval: int('tcp-interval', 20), count: int('tcp-count', 6) };
  const s = new Session({ dry, keepAliveMs: ctx.keepAliveMs, tcp, acceptParamLogging: ctx.acceptParamLogging });
  ctx.s = s;
  const out = { script: name, startedAt: new Date().toISOString(), node: process.version, dry, file: path.basename(file), compare, batch: ctx.batch, chunkMiB: ctx.chunkBytes / MiB, tolerance: ctx.tolerance, steps: stepNames, hostKind: hostKind(), results: ctx.results };
  let fail = false, failMsg = null, before = [], after = [];
  const tAll = now();
  log(`${name}: file=${path.basename(file)} compare=${compare} steps=${stepNames.join(',')} dry=${dry}`);
  try { await s.connect(); } catch (e) {
    await s.close();
    if (e instanceof PreflightError) { console.error(`PREFLIGHT REFUSED: ${errMsg(e, 1500)}`); process.exitCode = 3; return null; }
    throw e;
  }
  let tupBefore = {};
  try {
    s.installSigint();
    out.server = await s.serverInfo();
    before = await s.snapshot();
    log(`catalog snapshot BEFORE: ${before.length} non-temp relations`);
    tupBefore = await s.tupStats();
    log(`n_tup_ins/upd/del BEFORE (public.cobertura5g, public.nbiot): ${JSON.stringify(tupBefore)}`);
    await ensureIndex(ctx);
    for (const n of stepNames) {
      log(`---- ${n.toUpperCase()} ----`);
      const res = await STEPS[n](ctx);
      if (!dry && res && res.verdict === 'FAIL') fail = true;
    }
  } catch (e) {
    fail = true; failMsg = `[${e.code || e.name}] ${errMsg(e, 400)}`;
    log(`ABORT: ${failMsg}`);
    try { if (!dry && s.client) await s.q('ROLLBACK'); } catch { /* ignore */ }
  } finally {
    try {
      after = await s.snapshot();
      const d = Session.diffSnapshots(before, after);
      out.catalog = { before: before.length, after: after.length, added: d.added, removed: d.removed };
      if (d.added.length || d.removed.length) {
        fail = true;
        log(`CATALOG CHANGED (FAIL): added=${JSON.stringify(d.added)} removed=${JSON.stringify(d.removed)} (could also be another user's concurrent DDL; inspect)`);
      } else log(`catalog snapshot AFTER: identical (${after.length} non-temp relations)`);
      if (!dry) await new Promise((r) => setTimeout(r, 3000));
      const tupAfter = await s.tupStats();
      out.tupStats = { before: tupBefore, after: tupAfter };
      if (JSON.stringify(tupBefore) !== JSON.stringify(tupAfter)) {
        fail = true;
        log(`PUBLIC TABLE TUPLE COUNTERS CHANGED (FAIL): before=${JSON.stringify(tupBefore)} after=${JSON.stringify(tupAfter)} (this spike never writes there: more likely another user's DML on a live table; stats can also lag a few seconds; inspect)`);
      } else log('n_tup_ins/upd/del AFTER (3 s settle): identical for public.cobertura5g and public.nbiot');
      out.tempRelsBeforeDrop = await s.tempCount();
      log(`this session's temp relations before drop: ${out.tempRelsBeforeDrop}`);
      await s.dropTemps();
      out.tempRelsAfterDrop = await s.tempCount();
      log(`this session's temp relations after drop: ${out.tempRelsAfterDrop}`);
      if (out.tempRelsAfterDrop !== 0) { fail = true; log('temp relations remain (they vanish on disconnect anyway)'); }
    } catch (e) { log(`cleanup error: ${errMsg(e, 200)}`); }
    await s.close();
  }
  out.refusals = s.refusals; out.acceptParamLogging = ctx.acceptParamLogging; out.error = failMsg; out.totalSecs = (now() - tAll) / 1000;
  const verdicts = Object.values(ctx.results).filter((x) => x && x.verdict).map((x) => `${x.name}=${dry ? '(dry)' : x.verdict}`);
  out.verdict = fail ? 'FAIL' : 'PASS';
  if (dry) fail = false;
  if (!dry) writeResult(name, out);
  console.log(`\n${verdicts.join('  ')}\nTotal ${f2(out.totalSecs)} s`);
  console.log(dry ? 'DRY-RUN complete (nothing was sent to any database)' : `${name.toUpperCase()} RESULT: ${out.verdict}`);
  process.exitCode = fail ? 1 : 0;
  return out;
}
