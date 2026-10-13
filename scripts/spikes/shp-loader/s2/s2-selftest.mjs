// SPIKE S2 self-test of the static SQL guard (exact allow-list) and the error redaction (no DB). node s2-selftest.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkSql, GuardError, CANCEL_SQL, readTestSql, redact, errMsg, gateSql, statsSql, SNAPSHOT_SQL, TUP_SQL, SIZE_SQL, SWAP_INSERT, E5_CTAS, TARGET_COLS, SQL, TEMPLATE_COUNT,
} from './s2-lib.mjs';
import { GATE_SQL } from './s2-steps.mjs';

let fail = 0, n = 0;
const rejects = [
  'TRUNCATE public.x', 'TRUNCATE public.cobertura5g', 'DROP TABLE public.x', 'DROP TABLE IF EXISTS public.nbiot', 'INSERT INTO public.x SELECT 1',
  'UPDATE public.x SET a = 1', 'DELETE FROM public.x', 'CREATE TABLE x (a int)', 'CREATE TABLE pg_temp.x (a int)', 'ALTER TABLE x ADD COLUMN a int', 'ALTER SYSTEM SET work_mem = 1',
  'ALTER ROLE u SET statement_timeout = 0', 'TRUNCATE spike_target', 'TRUNCATE TABLE spike_target', 'INSERT INTO spike_target SELECT 1', 'UPDATE spike_work SET fixed = NULL',
  'DROP TABLE spike_work', 'DROP TABLE pg_temp.a, public.b', 'SELECT * FROM public.lte', 'SELECT * FROM public.cobertura5g; DROP TABLE public.cobertura5g',
  'WITH d AS (DELETE FROM pg_temp.spike_work RETURNING 1) SELECT * FROM d', 'SELECT * INTO public.x FROM pg_temp.spike_work', 'SELECT pg_terminate_backend(1)',
  "SELECT set_config('search_path','public',false)", 'SET search_path = public', 'SET ROLE postgres', 'SET statement_timeout = 0; DROP TABLE pg_temp.a',
  'INSERT INTO pg_temp.spike_target SELECT * FROM public.cobertura5g', 'CREATE TEMP TABLE pg_temp.t AS SELECT * FROM public.cobertura5g', 'CREATE TEMP TABLE t (a int)',
  'CREATE INDEX i ON public.x (a)', 'ANALYZE public.cobertura5g', 'VACUUM pg_temp.spike_work', 'COPY pg_temp.spike_work TO STDOUT', 'GRANT ALL ON pg_temp.x TO u',
  'DO $$ BEGIN DROP TABLE public.x; END $$', '', '   ', '-- just a comment', 'EXPLAIN ANALYZE DELETE FROM pg_temp.x', 'CALL foo()',
  // reviewer attack strings
  "SELECT '/*' ; DROP TABLE cobertura5g ; SELECT '*/'",
  "UPDATE pg_temp.spike_work SET fixed = E'\\'' ; DROP TABLE cobertura5g ; SELECT 'x'",
  "DO $$ BEGIN EXECUTE 'DROP TABLE pub'||'lic.cobertura5g'; END $$",
  'DO $$ BEGIN DELETE FROM cobertura5g; END $$',
  'DO $$ x $$ ; DROP TABLE cobertura5g ; DO $$ y $$',
  'SELECT U&"pg_terminate\\005fbackend"(1234)',
  'SELECT U&"pub\\006cic".lte',
  "SELECT UpdateGeometrySRID('x','y',1)", "SELECT DropGeometryTable('x')", "SELECT pg_notify('a','b')", "SELECT lowrite(1,'x')",
  'SELECT * FROM public.cobertura5g FOR SHARE', 'SELECT pg_cancel_backend(1234)', 'SELECT pg_cancel_backend(1234);',
  // formerly accepted by the heuristic guard but not sent by any script: refused by the exact allow-list
  'SELECT 1', 'SELECT count(*) FROM public.cobertura5g', 'SELECT count(*), sum(ST_Area(geom)) FROM public.nbiot', 'WITH a AS (SELECT 1) SELECT * FROM a',
  'DO $$ BEGIN PERFORM 1; END $$', 'SELECT pg_sleep(5)', 'SELECT pg_sleep($1::float8) /* x */', 'SELECT pg_sleep($1::float8);', 'SHOW all', 'SHOW log_statement ; SHOW all',
  'CREATE TEMPORARY TABLE pg_temp.spike_x (a int)', 'DROP TABLE pg_temp.spike_raw', 'TRUNCATE pg_temp.spike_target, pg_temp.spike_work', 'TRUNCATE pg_temp.other',
  'CREATE INDEX spike_x ON pg_temp.spike_work USING gist (piece)', 'DROP TABLE IF EXISTS pg_temp.spike_work, public.nbiot', 'DROP TABLE IF EXISTS pg_temp."spike_work"',
  'SELECT (SELECT count(*) FROM public.lte)::int AS target_rows, (SELECT max(fechacarga)::text FROM public.lte) AS max_fechacarga',
  'SET statement_timeout = 5', 'SET lock_timeout = 1', 'SET tcp_keepalives_idle = 60 ; SET search_path = public',
];
const accepts = [
  'SHOW server_version', 'SHOW tcp_keepalives_idle', 'SHOW tcp_keepalives_interval', 'SHOW tcp_keepalives_count', 'SHOW statement_timeout',
  'SHOW log_statement', 'SHOW log_min_duration_statement', 'SHOW log_parameter_max_length',
  'BEGIN', 'COMMIT', 'ROLLBACK', 'SET statement_timeout = 0', 'SET lock_timeout = 0', 'SET tcp_keepalives_idle = 60', 'SET tcp_keepalives_interval = 20', 'SET tcp_keepalives_count = 6',
  'SELECT postgis_full_version() AS v', 'SELECT pg_sleep($1::float8)', 'SELECT 1 AS ok', 'SELECT 1 AS still_usable', CANCEL_SQL, '  select   pg_cancel_backend($1)\n',
  SQL.createRaw, SQL.createChunks, SQL.truncChunks, SQL.insChunk, SQL.insRawParam, SQL.insRawChunks,
  'CREATE TEMP TABLE pg_temp.spike_e1 (variant text, ewkb bytea, geom geometry)',
  "INSERT INTO pg_temp.spike_e1(variant, ewkb) VALUES ('param', $1::bytea)",
  "INSERT INTO pg_temp.spike_e1(variant, ewkb) SELECT 'chunks', string_agg(data, ''::bytea ORDER BY seq) FROM pg_temp.spike_chunks",
  "UPDATE pg_temp.spike_e1 SET geom = ST_SetSRID(ST_GeomFromEWKB(ewkb),32721) WHERE variant = 'param'",
  "UPDATE pg_temp.spike_e1 SET geom = ST_SetSRID(ST_GeomFromEWKB(ewkb),32721) WHERE variant = 'chunks'",
  'CREATE TEMP TABLE pg_temp.spike_work AS SELECT row_number() OVER () AS id, d.geom AS piece, NULL::geometry AS fixed FROM (SELECT ST_Subdivide(geom,256) AS geom FROM pg_temp.spike_raw) d',
  'CREATE INDEX spike_work_id ON pg_temp.spike_work (id)', 'ANALYZE pg_temp.spike_work', 'ANALYZE pg_temp.spike_target',
  "UPDATE pg_temp.spike_work SET fixed = ST_Multi(ST_CollectionExtract(ST_MakeValid(piece,'method=structure'),3)) WHERE id > $1 AND id <= $2",
  `CREATE TEMP TABLE pg_temp.spike_target ${TARGET_COLS}`, `CREATE TEMP TABLE pg_temp.spike_target2 ${TARGET_COLS}`,
  'CREATE INDEX spike_target_geom ON pg_temp.spike_target USING gist (geom)', 'CREATE INDEX spike_target2_geom ON pg_temp.spike_target2 USING gist (geom)',
  'TRUNCATE pg_temp.spike_target', 'TRUNCATE pg_temp.spike_target2',
  SWAP_INSERT('pg_temp.spike_target', 'pg_temp.spike_work'), SWAP_INSERT('pg_temp.spike_target2', 'pg_temp.spike_pieces2'), E5_CTAS('pg_temp.spike_raw'),
  gateSql('pg_temp.spike_work'), gateSql('pg_temp.spike_pieces2'), statsSql('pg_temp.spike_target'), statsSql('public.cobertura5g'), statsSql('public.nbiot'),
  GATE_SQL.work, GATE_SQL.pieces2,
  SNAPSHOT_SQL, TUP_SQL, SIZE_SQL,
  'SELECT count(*)::int AS n FROM pg_class WHERE relnamespace = pg_my_temp_schema()',
  "SELECT relname FROM pg_class WHERE relnamespace = pg_my_temp_schema() AND relkind = 'r'",
  'DROP TABLE IF EXISTS pg_temp.spike_work', 'DROP TABLE IF EXISTS pg_temp.spike_x',
  readTestSql('cobertura5g'), readTestSql('nbiot'),
];

const verdict = (sql) => { try { checkSql(sql); return 'accept'; } catch (e) { if (e instanceof GuardError) return 'reject'; throw e; } };
for (const sql of rejects) { n++; if (verdict(sql) !== 'reject') { fail++; console.log(`FAIL (should reject): ${sql}`); } }
for (const sql of accepts) { n++; if (verdict(sql) !== 'accept') { fail++; console.log(`FAIL (should accept): ${sql.slice(0, 120)}`); } }
try { readTestSql('lte'); n++; fail++; console.log('FAIL: readTestSql accepted lte'); } catch { n++; }

// redaction of printed/stored error messages
const env = { PGHOST: 'dbhost.corp.example', PGUSER: 'bob', PGDATABASE: 'hgdesa', PGPASSWORD: 'S3cret!pw' };
const redactCases = [
  ['connect ECONNREFUSED 10.1.2.3:5432', ['10.1.2.3']],
  ['password authentication failed for user "bob"', ['bob']],
  ['no pg_hba.conf entry for host "1.2.3.4", user "bob", database "db"', ['1.2.3.4', 'bob', '"db"']],
  ['getaddrinfo ENOTFOUND dbhost.corp.example', ['dbhost.corp.example']],
  ['database "hgdesa" does not exist; role "bob" does not exist; pw S3cret!pw', ['hgdesa', 'bob', 'S3cret!pw']],
  ['connection to server at "dbhost.corp.example" (10.9.8.7), port 5432 failed', ['dbhost.corp.example', '10.9.8.7']],
];
for (const [msg, secrets] of redactCases) {
  for (const withEnv of [true, false]) {
    n++;
    const out = redact(msg, withEnv ? env : {});
    const leaked = secrets.filter((x) => out.includes(x) && (withEnv || !/dbhost|hgdesa|S3cret/.test(x)));
    if (leaked.length) { fail++; console.log(`FAIL (redact${withEnv ? '+env' : ''}) leaked ${JSON.stringify(leaked)}: ${out}`); }
  }
}
n++;
if (errMsg(new Error('connect ECONNREFUSED 10.1.2.3:5432')).includes('10.1.2.3')) { fail++; console.log('FAIL: errMsg leaked ip'); }
console.log(`allow-list templates: ${TEMPLATE_COUNT}`);

// static scan of the s2 sources
const dir = path.dirname(fileURLToPath(import.meta.url));
for (const fn of fs.readdirSync(dir).filter((x) => x.endsWith('.mjs') && x !== 's2-selftest.mjs')) {
  const src = fs.readFileSync(path.join(dir, fn), 'utf8');
  for (const [re, what] of [[/kettle\.properties/i, 'kettle.properties'], [/postgres(ql)?:\/\//i, 'connection string'], [/PGPASSWORD\s*[:=]\s*['"`]/, 'literal password assignment'], [/password\s*[:=]\s*['"`][^'"`]+['"`]/i, 'literal password']]) {
    n++;
    if (re.test(src)) { fail++; console.log(`FAIL: ${fn} contains ${what}`); }
  }
}
console.log(`${n - fail}/${n} checks passed`);
console.log(fail ? 'S2 SELFTEST: FAIL' : 'S2 SELFTEST: PASS');
process.exitCode = fail ? 1 : 0;
