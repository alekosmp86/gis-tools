// SPIKE S2 (CGEO-2200): shared helpers. TEMP-table-only experiments. Throwaway.
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { processFile } from '../shp-lib.mjs';

export const APP_NAME = 'cgeo2200-spike';
export const READ_ALLOWLIST = ['cobertura5g', 'nbiot'];
export const MiB = 1 << 20;
let preflightLogged = false;

// ---------- logging / small utils ----------
export function ts() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
export const log = (m) => console.log(`[${ts()}] ${m}`);
export const sec = (ms) => (ms / 1000).toFixed(2);
export const mib = (b) => (b / MiB).toFixed(1) + ' MiB';
export const num = (v) => (v === null || v === undefined ? NaN : Number(v));
export const one = (r) => (r && r.rows && r.rows[0]) || {};
export const f2 = (v) => (Number.isFinite(v) ? v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : String(v));

export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const k = a.slice(2);
    const nx = argv[i + 1];
    if (nx === undefined || nx.startsWith('--')) flags[k] = true;
    else { flags[k] = nx; i++; }
  }
  return flags;
}

export function table(title, rows) {
  const w = Math.max(...rows.map((r) => String(r[0]).length), 5);
  console.log(`\n== ${title}`);
  for (const [k, v] of rows) console.log(`  ${String(k).padEnd(w)}  ${v}`);
}

export function stats(arr) {
  if (!arr.length) return { min: NaN, median: NaN, p95: NaN, max: NaN };
  const a = [...arr].sort((x, y) => x - y);
  const at = (q) => a[Math.min(a.length - 1, Math.floor(q * a.length))];
  return { min: a[0], median: at(0.5), p95: at(0.95), max: a[a.length - 1] };
}

export function startRssMeter(ms = 100) {
  let peak = process.memoryUsage().rss;
  const before = peak;
  const t = setInterval(() => { const r = process.memoryUsage().rss; if (r > peak) peak = r; }, ms);
  t.unref();
  return {
    stop() {
      clearInterval(t);
      const r = process.memoryUsage().rss;
      if (r > peak) peak = r;
      return { rssBefore: before, rssPeak: peak, rssDelta: peak - before, maxRSS: process.resourceUsage().maxRSS * 1024 };
    },
  };
}

export function writeResult(name, obj) {
  const f = path.join(os.tmpdir(), `cgeo2200-s2-${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2));
  log(`result JSON: ${f}`);
  return f;
}

// ---------- error redaction ----------
export function redact(msg, env = process.env) {
  let s = String(msg);
  for (const k of ['PGPASSWORD', 'PGUSER', 'PGDATABASE', 'PGHOST']) {
    const v = env[k];
    if (v && v.length >= 2) s = s.replace(new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), `<${k}>`);
  }
  s = s.replace(/\b(user|role|database|host)\s+"[^"]*"/gi, '$1 "<redacted>"');
  s = s.replace(/\b(ECONN\w+|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN)\s+\S+/g, '$1 <addr>');
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>');
  return s;
}
export const errMsg = (e, n = 300) => redact(String((e && e.message) || e)).slice(0, n);

// ---------- static SQL guard: EXACT allow-list of the statements the scripts send ----------
export class GuardError extends Error {}
export class PreflightError extends Error {}

const NAME = '[a-z_][a-z0-9_]*';
const WRITE_VERBS = /\b(insert|update|delete|truncate|drop|alter|create|grant|revoke|copy|vacuum|reindex|cluster|lock|merge|comment|refresh|reassign|import|call|execute|prepare)\b/i;
const DENY_FUNCS = /\b(pg_terminate_backend|pg_cancel_backend|pg_reload_conf|set_config|dblink\w*|lo_\w+|lowrite|loread|pg_notify|updategeometrysrid|dropgeometry\w*|addgeometrycolumn|pg_read_\w+|pg_ls_dir|pg_file_\w+|pg_advisory\w*|nextval|setval|pg_stat_reset\w*|pg_switch\w+|pg_promote|pg_rotate_logfile)\b/i;
export const CANCEL_SQL = 'SELECT pg_cancel_backend($1)';

const SET_RE = new RegExp(`^set (session )?(statement_timeout|lock_timeout|tcp_keepalives_idle|tcp_keepalives_interval|tcp_keepalives_count)\\s*(=|to)\\s*[0-9]+$`, 'i');

const WRITE_HEADS = [
  new RegExp(`^create (temp|temporary) table (if not exists )?pg_temp\\.${NAME}\\b`, 'i'),
  new RegExp(`^create index (if not exists )?${NAME} on pg_temp\\.${NAME}\\b`, 'i'),
  new RegExp(`^insert into pg_temp\\.${NAME}\\b`, 'i'),
  new RegExp(`^update pg_temp\\.${NAME}\\b`, 'i'),
  new RegExp(`^drop table (if exists )?pg_temp\\.${NAME}$`, 'i'),
  new RegExp(`^truncate (table )?pg_temp\\.${NAME}$`, 'i'),
  new RegExp(`^analyze pg_temp\\.${NAME}$`, 'i'),
];

// statement builders shared by the steps and the allow-list (single source of text)
export const gateSql = (t) => `SELECT count(*)::int AS n, count(*) FILTER (WHERE fixed IS NOT NULL AND NOT ST_IsEmpty(fixed))::int AS usable, count(*) FILTER (WHERE fixed IS NULL OR ST_IsEmpty(fixed))::int AS nullempty, max(ST_NPoints(fixed))::int AS maxv, count(*) FILTER (WHERE fixed IS NOT NULL AND NOT ST_IsValid(fixed))::int AS invalid, sum(ST_Area(fixed))::float8 AS area FROM ${t}`;
export const statsSql = (t) => `SELECT count(*)::int AS n, sum(ST_NPoints(geom))::float8 AS verts, max(ST_NPoints(geom))::int AS maxv, sum(ST_Area(geom))::float8 AS area, count(*) FILTER (WHERE NOT ST_IsValid(geom))::int AS invalid, ST_Extent(geom)::text AS extent FROM ${t}`;
export const SNAPSHOT_SQL = "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg\\_%' ESCAPE '\\' AND n.nspname <> 'information_schema'";
export const TUP_SQL = "SELECT relname, n_tup_ins::float8 AS ins, n_tup_upd::float8 AS upd, n_tup_del::float8 AS del FROM pg_stat_user_tables WHERE schemaname = 'public' AND relname IN ('cobertura5g','nbiot') ORDER BY relname";
export const SIZE_SQL = "SELECT pg_relation_size('pg_temp.spike_work')::float8 AS tbl, pg_relation_size('pg_temp.spike_work_id')::float8 AS idx";
export const MAKE_FIXED = "ST_Multi(ST_CollectionExtract(ST_MakeValid(%P%,'method=structure'),3))";
export const TARGET_COLS = '(gid serial PRIMARY KEY, geom geometry(Geometry,32721), fechaact text, fuente text, fechacarga text)';
export const SWAP_INSERT = (t, src) => `INSERT INTO ${t}(geom, fechaact, fuente, fechacarga) SELECT fixed, '2026-09-01', 'EXTERNO/F.Maresca', to_char(now(),'YYYY-MM-DD') FROM ${src} WHERE fixed IS NOT NULL AND NOT ST_IsEmpty(fixed) ORDER BY id`;
export const E5_CTAS = (src) => `CREATE TEMP TABLE pg_temp.spike_pieces2 AS SELECT row_number() OVER () AS id, ${MAKE_FIXED.replace('%P%', 'd.geom')} AS fixed FROM (SELECT ST_Subdivide(geom,256) AS geom FROM ${src}) d`;
export const readTestSql = (target) => {
  if (!READ_ALLOWLIST.includes(target)) throw new Error(`target must be one of ${READ_ALLOWLIST.join('|')}`);
  return `SELECT (SELECT count(*) FROM public.${target})::int AS target_rows, (SELECT max(fechacarga)::text FROM public.${target}) AS max_fechacarga`;
};

// placeholders: <t> pg_temp.spike_*   <p> cobertura5g|nbiot   <v> param|chunks   <n> digits
const TEMPLATE_SRC = [
  'SET statement_timeout = 0', 'SET lock_timeout = 0',
  'SET tcp_keepalives_idle = <n>', 'SET tcp_keepalives_interval = <n>', 'SET tcp_keepalives_count = <n>',
  'BEGIN', 'COMMIT', 'ROLLBACK',
  'SHOW server_version', 'SHOW tcp_keepalives_idle', 'SHOW tcp_keepalives_interval', 'SHOW tcp_keepalives_count', 'SHOW statement_timeout',
  'SHOW log_statement', 'SHOW log_min_duration_statement', 'SHOW log_parameter_max_length',
  'SELECT postgis_full_version() AS v', CANCEL_SQL, 'SELECT pg_sleep($1::float8)', 'SELECT 1 AS ok', 'SELECT 1 AS still_usable',
  SNAPSHOT_SQL, TUP_SQL, SIZE_SQL,
  'SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = pg_my_temp_schema()',
  "SELECT relname FROM pg_class WHERE relnamespace = pg_my_temp_schema() AND relkind = 'r'",
  'DROP TABLE IF EXISTS <t>',
  'CREATE TEMP TABLE pg_temp.spike_raw (rid int, geom geometry(Geometry,32721))',
  'CREATE TEMP TABLE pg_temp.spike_chunks (seq int, data bytea)',
  'TRUNCATE pg_temp.spike_chunks',
  'INSERT INTO pg_temp.spike_chunks(seq, data) VALUES ($1::int, $2::bytea)',
  'INSERT INTO pg_temp.spike_raw(rid, geom) VALUES ($1::int, ST_SetSRID(ST_GeomFromEWKB($2::bytea),32721))',
  "INSERT INTO pg_temp.spike_raw(rid, geom) SELECT $1::int, ST_SetSRID(ST_GeomFromEWKB(string_agg(data, ''::bytea ORDER BY seq)),32721) FROM pg_temp.spike_chunks",
  'SELECT count(*)::int AS n, sum(ST_NPoints(geom))::float8 AS pts, sum(ST_Area(geom))::float8 AS area FROM pg_temp.spike_raw',
  'CREATE TEMP TABLE pg_temp.spike_e1 (variant text, ewkb bytea, geom geometry)',
  "INSERT INTO pg_temp.spike_e1(variant, ewkb) VALUES ('param', $1::bytea)",
  "INSERT INTO pg_temp.spike_e1(variant, ewkb) SELECT 'chunks', string_agg(data, ''::bytea ORDER BY seq) FROM pg_temp.spike_chunks",
  "UPDATE pg_temp.spike_e1 SET geom = ST_SetSRID(ST_GeomFromEWKB(ewkb),32721) WHERE variant = '<v>'",
  'SELECT variant, octet_length(ewkb)::float8 AS bytes, ST_NPoints(geom) AS npts, ST_NumGeometries(geom) AS ngeom, ST_Area(geom)::float8 AS area, ST_SRID(geom) AS srid FROM pg_temp.spike_e1 ORDER BY variant',
  'SELECT variant, ST_NRings(geom) AS nrings FROM pg_temp.spike_e1 ORDER BY variant',
  "SELECT (SELECT ewkb FROM pg_temp.spike_e1 WHERE variant='param') = (SELECT ewkb FROM pg_temp.spike_e1 WHERE variant='chunks') AS eq",
  'CREATE TEMP TABLE pg_temp.spike_work AS SELECT row_number() OVER () AS id, d.geom AS piece, NULL::geometry AS fixed FROM (SELECT ST_Subdivide(geom,256) AS geom FROM pg_temp.spike_raw) d',
  'CREATE INDEX spike_work_id ON pg_temp.spike_work (id)',
  'ANALYZE pg_temp.spike_work',
  'SELECT count(*)::int AS n, max(ST_NPoints(piece))::int AS maxv, sum(ST_NPoints(piece))::float8 AS sumv FROM pg_temp.spike_work',
  `UPDATE pg_temp.spike_work SET fixed = ${MAKE_FIXED.replace('%P%', 'piece')} WHERE id > $1 AND id <= $2`,
  'SELECT count(*) FILTER (WHERE fixed IS NULL)::int AS nulls, count(*) FILTER (WHERE fixed IS NOT NULL AND ST_IsEmpty(fixed))::int AS empties FROM pg_temp.spike_work',
  gateSql('pg_temp.spike_work'), gateSql('pg_temp.spike_pieces2'),
  `CREATE TEMP TABLE pg_temp.spike_target ${TARGET_COLS}`, `CREATE TEMP TABLE pg_temp.spike_target2 ${TARGET_COLS}`,
  'CREATE INDEX spike_target_geom ON pg_temp.spike_target USING gist (geom)',
  'CREATE INDEX spike_target2_geom ON pg_temp.spike_target2 USING gist (geom)',
  'TRUNCATE pg_temp.spike_target', 'TRUNCATE pg_temp.spike_target2',
  SWAP_INSERT('pg_temp.spike_target', 'pg_temp.spike_work'), SWAP_INSERT('pg_temp.spike_target2', 'pg_temp.spike_pieces2'),
  'ANALYZE pg_temp.spike_target',
  E5_CTAS('pg_temp.spike_raw'),
  'SELECT (SELECT count(*) FROM pg_temp.spike_target2)::int AS n2, (SELECT count(*) FROM pg_temp.spike_target)::int AS n1',
  statsSql('pg_temp.spike_target'), statsSql('public.<p>'),
  'SELECT (SELECT count(*) FROM public.<p>)::int AS target_rows, (SELECT max(fechacarga)::text FROM public.<p>) AS max_fechacarga',
];

const canon = (s) => String(s).replace(/\s+/g, ' ').trim().toLowerCase();
const TOKENS = { '<t>': 'pg_temp\\.spike_[a-z0-9_]+', '<p>': '(?:cobertura5g|nbiot)', '<v>': '(?:param|chunks)', '<n>': '[0-9]+' };
const TEMPLATES = TEMPLATE_SRC.map((t) => {
  let r = canon(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [k, v] of Object.entries(TOKENS)) r = r.split(k).join(v);
  return new RegExp(`^${r}$`);
});
export const TEMPLATE_COUNT = TEMPLATES.length;

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim();
}

// returns {kind, text}; throws GuardError on refusal. The exact allow-list is the gate; the heuristics below are defence in depth only.
export function checkSql(sql) {
  const text = normalize(sql);
  const refuse = (why) => { throw new GuardError(`REFUSED (${why}): ${text.slice(0, 160)}`); };
  if (!text) refuse('empty statement');
  const low = text.toLowerCase();
  if (!TEMPLATES.some((re) => re.test(low))) refuse('not an exact allow-listed statement');
  if (low === canon(CANCEL_SQL)) return { kind: 'cancel', text };
  if (/^do\b/.test(low)) refuse('DO blocks are never sent');
  if (/\bu&/.test(low)) refuse('unicode-escape identifiers');
  if (text.replace(/'[^']*'/g, "''").includes(';')) refuse('multiple statements');
  const pubRefs = [...text.matchAll(/(?:\bpublic|"public")\s*\.\s*"?([a-z0-9_]+)/gi)].map((m) => m[1].toLowerCase());
  if (/^(select|with)\b/.test(low)) {
    if (WRITE_VERBS.test(text)) refuse('write verb inside read statement');
    if (/\binto\b/.test(low)) refuse('SELECT INTO');
    if (/\bfor\s+(update|share|no key update|key share)\b/.test(low)) refuse('row-locking read');
    if (DENY_FUNCS.test(text)) refuse('denied function');
    for (const n of pubRefs) if (!READ_ALLOWLIST.includes(n)) refuse(`read of public.${n} not in allow-list`);
    return { kind: 'read', text };
  }
  if (/^(begin|commit|rollback)( transaction| work)?$/.test(low)) return { kind: 'txn', text };
  if (/^show [a-z_]+$/.test(low)) return { kind: 'show', text };
  if (SET_RE.test(text)) return { kind: 'set', text };
  if (WRITE_HEADS.some((re) => re.test(text))) {
    if (pubRefs.length || /"public"/i.test(text)) refuse('write statement references public.');
    if (DENY_FUNCS.test(text)) refuse('denied function');
    return { kind: 'write-temp', text };
  }
  return refuse('no heuristic head matched');
}

// ---------- session ----------
export function hostKind(env = process.env) {
  const h = (env.PGHOST || '').toLowerCase();
  if (!h) return 'unset';
  return h === 'localhost' || h.startsWith('127.') || h === '::1' || h === '[::1]' || h.startsWith('/') ? 'localhost' : 'remote';
}

export function requireEnv() {
  const missing = ['PGHOST', 'PGDATABASE', 'PGUSER', 'PGPASSWORD'].filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`missing environment variables: ${missing.join(', ')} (names only; see S2_README.md)`);
}

export class Session {
  constructor(o = {}) {
    this.dry = !!o.dry;
    this.o = o;
    this.client = null;
    this.pid = null;
    this.printed = new Set();
    this.stmts = 0;
    this.refusals = [];
    this.sigintHandler = null;
  }

  // PREFLIGHT: refuse before any data is sent if the server would write bind parameters (bytea as hex) to its log.
  async preflight() {
    const show = async (k) => String(one(await this.q(`SHOW ${k}`, [], { heartbeat: false }))[k] ?? '?');
    const ls = await show('log_statement');
    const dur = await show('log_min_duration_statement');
    const pml = await show('log_parameter_max_length');
    const accept = !!this.o.acceptParamLogging;
    if (this.dry) {
      log(`[dry-run] preflight would SHOW log_statement / log_min_duration_statement / log_parameter_max_length and REFUSE (exit 3) if log_statement is mod|all or log_min_duration_statement >= 0; --accept-param-logging=${accept ? 'yes (would proceed after a warning)' : 'no'}`);
      return;
    }
    const problems = [];
    if (ls === 'mod' || ls === 'all') problems.push(`log_statement=${ls}: every INSERT/UPDATE is logged WITH its bind parameters`);
    const durOff = /^-\d/.test(dur.trim());
    if (!durOff) problems.push(`log_min_duration_statement=${dur} (>= 0 or unparseable): slow/all statements are logged WITH their bind parameters`);
    if (!preflightLogged) log(`preflight: log_statement=${ls} log_min_duration_statement=${dur} log_parameter_max_length=${pml}`);
    preflightLogged = true;
    if (!problems.length) return;
    const why = `${problems.join('; ')}. This spike sends bytea parameters of up to ~118 MB (NBIoT giant; LTE up to ~279 MB), which the server renders as hex (2 chars per byte): hundreds of MB of hex per record would be written to the SHARED server log (log_parameter_max_length=${pml}; -1 = unlimited), filling its disk and copying the data into log files.`;
    if (!accept) throw new PreflightError(`${why} Refusing to send any data. Ask the DBA to run with log_statement=none/ddl and log_min_duration_statement=-1 for this role, or re-run with --accept-param-logging if the DBA accepted that.`);
    log(`PREFLIGHT WARNING (--accept-param-logging given, proceeding): ${why}`);
  }

  async connect() {
    const o = this.o;
    const keepAlive = o.keepAlive !== false;
    if (this.dry) {
      log(`[dry-run] would connect using PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD env vars, application_name=${APP_NAME}, keepAlive=${keepAlive}, keepAliveInitialDelayMillis=${o.keepAliveMs ?? 30000}`);
    } else {
      requireEnv();
      const { default: pg } = await import('pg');
      this.client = new pg.Client({ keepAlive, keepAliveInitialDelayMillis: o.keepAliveMs ?? 30000, application_name: APP_NAME, connectionTimeoutMillis: 30000 });
      this.client.on('error', (e) => log(`CLIENT ERROR [${e.code || e.name}] ${errMsg(e, 200)}`));
      await this.client.connect();
      this.pid = this.client.processID;
      log(`connected (backend pid ${this.pid}, host kind: ${hostKind()}, application_name=${APP_NAME})`);
    }
    await this.preflight();
    await this.q('SET statement_timeout = 0');
    await this.q('SET lock_timeout = 0');
    if (o.tcp) {
      for (const [k, v] of [['tcp_keepalives_idle', o.tcp.idle], ['tcp_keepalives_interval', o.tcp.interval], ['tcp_keepalives_count', o.tcp.count]]) {
        if (v === undefined || v === null) continue;
        if (!Number.isInteger(v) || v < 0) throw new Error(`bad ${k}`);
        try { await this.q(`SET ${k} = ${v}`); } catch (e) { log(`  (session SET ${k} not accepted: ${errMsg(e, 120)}; continuing)`); }
      }
    }
  }

  guard(sql) {
    try { return checkSql(sql); } catch (e) {
      if (e instanceof GuardError) { this.refusals.push(e.message); log(`GUARD ${e.message}`); }
      throw e;
    }
  }

  async q(sql, params = [], opt = {}) {
    const g = this.guard(sql);
    const label = opt.label || g.text.slice(0, 70);
    if (this.dry) {
      if (!this.printed.has(g.text)) {
        this.printed.add(g.text);
        console.log(`[dry-run] ${g.text}${params.length ? `    -- ${params.length} param(s) elided` : ''}`);
      }
      return { rows: [], rowCount: 0, secs: 0, dry: true };
    }
    const t0 = performance.now();
    const hb = opt.heartbeat === false ? null : setInterval(() => log(`  ... still running: ${label} (${sec(performance.now() - t0)} s)`), 30000);
    try {
      const r = await this.client.query(sql, params);
      r.secs = (performance.now() - t0) / 1000;
      return r;
    } catch (e) {
      log(`ERROR in "${label}" after ${sec(performance.now() - t0)} s: [${e.code || e.name}] ${errMsg(e, 300)}`);
      throw e;
    } finally {
      if (hb) clearInterval(hb);
      this.stmts++;
    }
  }

  async snapshot() {
    const r = await this.q(
      SNAPSHOT_SQL, [], { heartbeat: false },
    );
    return r.rows.map((x) => `${x.nspname}.${x.relname}`).sort();
  }

  async tupStats() {
    const r = await this.q(TUP_SQL, [], { heartbeat: false });
    return Object.fromEntries(r.rows.map((x) => [x.relname, { ins: num(x.ins), upd: num(x.upd), del: num(x.del) }]));
  }

  async workSizes() {
    const r = one(await this.q(SIZE_SQL, [], { heartbeat: false }));
    return { tbl: num(r.tbl), idx: num(r.idx) };
  }

  static diffSnapshots(before, after) {
    const b = new Set(before), a = new Set(after);
    return { added: after.filter((x) => !b.has(x)), removed: before.filter((x) => !a.has(x)) };
  }

  async tempCount() {
    const r = await this.q('SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = pg_my_temp_schema()', [], { heartbeat: false });
    return this.dry ? 0 : r.rows[0].n;
  }

  async dropTemps() {
    if (this.dry) { await this.q('DROP TABLE IF EXISTS pg_temp.spike_x'); return; }
    const r = await this.q("SELECT relname FROM pg_class WHERE relnamespace = pg_my_temp_schema() AND relkind = 'r'", [], { heartbeat: false });
    for (const { relname } of r.rows) {
      if (!/^spike_[a-z0-9_]+$/.test(relname)) { log(`  (leaving unexpected temp relation ${relname}; it vanishes on disconnect)`); continue; }
      await this.q(`DROP TABLE IF EXISTS pg_temp.${relname}`, [], { heartbeat: false });
    }
  }

  installSigint() {
    if (this.sigintHandler) return;
    this.sigintHandler = async () => {
      const pid = this.pid;
      log('SIGINT: asking the server to cancel this session query, then exiting (temp tables vanish on disconnect)');
      try {
        if (Number.isInteger(pid) && !this.dry) {
          checkSql(CANCEL_SQL);
          const { default: pg } = await import('pg');
          const c = new pg.Client({ application_name: APP_NAME, connectionTimeoutMillis: 10000 });
          await c.connect();
          await c.query(CANCEL_SQL, [pid]);
          await c.end();
        }
      } catch (e) { log(`cancel failed: ${errMsg(e, 120)}`); }
      process.exit(130);
    };
    process.on('SIGINT', this.sigintHandler);
  }

  async close() {
    if (this.sigintHandler) { process.removeListener('SIGINT', this.sigintHandler); this.sigintHandler = null; }
    this.pid = null;
    if (this.client) { try { await this.client.end(); } catch { /* ignore */ } this.client = null; }
  }

  async serverInfo() {
    if (this.dry) { await this.q('SHOW server_version'); await this.q('SELECT postgis_full_version() AS v'); return { dry: true }; }
    const v = (await this.q('SHOW server_version')).rows[0].server_version;
    let pgis = null;
    try { pgis = String((await this.q('SELECT postgis_full_version() AS v')).rows[0].v).slice(0, 160); } catch { pgis = 'unavailable'; }
    return { server_version: v, postgis: pgis, hostKind: hostKind() };
  }
}

// ---------- SHP -> EWKB (strategy a) using S1 shp-lib ----------
export async function buildIndex(file) {
  const recs = [];
  let prev = 0;
  const sink = { async write() {} };
  const r = await processFile(file, {
    strategy: 'a',
    sink,
    onRecordEnd: (recno, total, wrote) => { if (wrote) recs.push({ recno, size: total - prev, start: prev }); prev = total; },
  });
  let giant = recs[0];
  for (const x of recs) if (x.size > giant.size) giant = x;
  return { recs, giant, totalBytes: prev, tot: r.tot, T: r.T, fileSize: r.fileSize };
}

// calls onRecord(rec, Buffer) sequentially (awaited) for records where want(rec) is true; buffers are exact-size, one at a time
export async function streamRecords(file, index, onRecord, want = () => true) {
  let i = 0, cur = null, filled = 0;
  const sink = {
    async write(x) {
      let off = 0;
      while (off < x.length) {
        if (!cur) {
          const rec = index.recs[i];
          if (!rec) throw new Error('stream produced more bytes than the index');
          cur = { rec, buf: want(rec) ? Buffer.allocUnsafe(rec.size) : null };
          filled = 0;
        }
        const n = Math.min(x.length - off, cur.rec.size - filled);
        if (cur.buf) x.copy(cur.buf, filled, off, off + n);
        filled += n; off += n;
        if (filled === cur.rec.size) {
          const c = cur; cur = null; i++;
          if (c.buf) await onRecord(c.rec, c.buf);
        }
      }
    },
  };
  await processFile(file, { strategy: 'a', sink });
  if (i !== index.recs.length) throw new Error(`index mismatch: ${i} records streamed, expected ${index.recs.length}`);
}

export function readLocalCsv(csvPath) {
  if (!csvPath || !fs.existsSync(csvPath)) return null;
  const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/).slice(1);
  const map = new Map();
  let area = 0, points = 0, rings = 0;
  for (const l of lines) {
    const [record, parts, pts, net, shells, holes] = l.split(',');
    const o = { record: +record, parts: +parts, points: +pts, net: +net, shells: +shells, holes: +holes };
    map.set(o.record, o); area += o.net; points += o.points; rings += o.parts;
  }
  return { map, area, points, rings, records: map.size };
}

export function defaultCsv(file) {
  const b = path.basename(file).toLowerCase();
  const pre = b.startsWith('nruruguay') ? 'NR' : b.startsWith('lteuruguay') ? 'LTE' : b.startsWith('nbioturuguay') ? 'NBIoT' : b.startsWith('wcdmauruguay') ? 'WCDMA' : null;
  return pre ? path.join(os.tmpdir(), 'shp-s1', `${pre}_records.csv`) : null;
}

// ---------- loading into pg_temp.spike_raw (E1(ii) method for big records) ----------
export const SQL = {
  createRaw: 'CREATE TEMP TABLE pg_temp.spike_raw (rid int, geom geometry(Geometry,32721))',
  createChunks: 'CREATE TEMP TABLE pg_temp.spike_chunks (seq int, data bytea)',
  truncChunks: 'TRUNCATE pg_temp.spike_chunks',
  insChunk: 'INSERT INTO pg_temp.spike_chunks(seq, data) VALUES ($1::int, $2::bytea)',
  insRawParam: 'INSERT INTO pg_temp.spike_raw(rid, geom) VALUES ($1::int, ST_SetSRID(ST_GeomFromEWKB($2::bytea),32721))',
  insRawChunks: "INSERT INTO pg_temp.spike_raw(rid, geom) SELECT $1::int, ST_SetSRID(ST_GeomFromEWKB(string_agg(data, ''::bytea ORDER BY seq)),32721) FROM pg_temp.spike_chunks",
};

export async function sendChunks(s, buf, chunkBytes) {
  await s.q(SQL.truncChunks);
  let seq = 0;
  for (let off = 0; off < buf.length; off += chunkBytes) {
    await s.q(SQL.insChunk, [seq++, buf.subarray(off, Math.min(buf.length, off + chunkBytes))], { label: `chunk ${seq}` });
  }
  return seq;
}

export async function loadRecord(s, recno, buf, chunkBytes, forceChunks = false) {
  if (!forceChunks && buf.length <= chunkBytes) {
    await s.q(SQL.insRawParam, [recno, buf], { label: `record ${recno} (param)` });
    return 'param';
  }
  await sendChunks(s, buf, chunkBytes);
  await s.q(SQL.insRawChunks, [recno], { label: `record ${recno} (chunks)` });
  await s.q(SQL.truncChunks);
  return 'chunks';
}

// ---------- second-connection read test ----------
// Proves only that a second session can read the target's count / max(fechacarga). It does NOT validate any lost-reply recovery logic.
export async function secondConnectionReadTest(target, opts = {}) {
  const fresh = new Session({ dry: opts.dry, keepAliveMs: opts.keepAliveMs, acceptParamLogging: opts.acceptParamLogging });
  await fresh.connect();
  try {
    const r = await fresh.q(readTestSql(target), [], { label: 'second-connection read test' });
    return { ...one(r), readOk: !fresh.dry };
  } finally { await fresh.close(); }
}
