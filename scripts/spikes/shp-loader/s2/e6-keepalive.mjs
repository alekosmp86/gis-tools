// SPIKE S2 E6: keepalive / idle behaviour. No tables are created at all (only SELECT pg_sleep / SELECT 1 / SHOW / SET session settings).
// node e6-keepalive.mjs [--seconds 600] [--idle-seconds <seconds>] [--keepalive-ms 30000]
//      [--variants a,b,c,d] [--accept-param-logging] [--tcp-idle 60 --tcp-interval 20 --tcp-count 6] [--dry-run]
//  a = client keepAlive=true + SELECT pg_sleep(seconds)
//  b = client keepAlive=true, client-side idle (no traffic) then SELECT 1
//  c = like a, plus session-level SET tcp_keepalives_idle/interval/count before the long statement (session-scoped, server-side)
//  d = client keepAlive=false baseline + SELECT pg_sleep(seconds)
import { performance } from 'node:perf_hooks';
import { Session, log, sec, parseArgs, writeResult, hostKind, one, table, errMsg, PreflightError } from './s2-lib.mjs';

const f = parseArgs(process.argv.slice(2));
const dry = !!f['dry-run'];
const acceptParamLogging = !!f['accept-param-logging'];
const int = (k, d) => { const v = f[k] === undefined ? d : Number(f[k]); if (!Number.isInteger(v) || v <= 0) throw new Error(`--${k} must be a positive integer`); return v; };
const seconds = int('seconds', 600);
const idleSeconds = int('idle-seconds', seconds);
const keepAliveMs = int('keepalive-ms', 30000);
const tcp = { idle: int('tcp-idle', 60), interval: int('tcp-interval', 20), count: int('tcp-count', 6) };
const variants = String(f.variants === undefined || f.variants === true ? 'a,b,c' : f.variants).split(',').map((x) => x.trim()).filter(Boolean);
for (const v of variants) if (!'abcd'.includes(v) || v.length !== 1) throw new Error(`unknown variant ${v}`);

const out = { script: 'e6', startedAt: new Date().toISOString(), node: process.version, dry, hostKind: hostKind(), seconds, idleSeconds, keepAliveMs, tcp, variants: [] };
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

async function showAll(s, label) {
  const row = {};
  for (const k of ['tcp_keepalives_idle', 'tcp_keepalives_interval', 'tcp_keepalives_count', 'statement_timeout']) {
    row[k] = String(one(await s.q(`SHOW ${k}`))[k] ?? '?');
  }
  log(`  [${label}] SHOW ${Object.entries(row).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  return row;
}

async function runVariant(v) {
  const rec = { variant: v, error: null, usableAfter: null };
  const s = new Session({ dry, keepAlive: v !== 'd', keepAliveMs, tcp: v === 'c' ? tcp : null, acceptParamLogging });
  const desc = { a: `client keepAlive(${keepAliveMs} ms) + pg_sleep(${seconds})`, b: `client keepAlive + ${idleSeconds}s client-side idle then SELECT 1`, c: `like a + session SET tcp_keepalives idle/interval/count=${tcp.idle}/${tcp.interval}/${tcp.count}`, d: `NO client keepAlive + pg_sleep(${seconds})` }[v];
  log(`==== variant ${v}: ${desc}`);
  rec.description = desc;
  try {
    await s.connect();
    s.installSigint();
    rec.show = await showAll(s, `variant ${v}`);
    if (v === 'a') { rec.server = await s.serverInfo(); }
    const t0 = performance.now();
    try {
      if (v === 'b') {
        log(`  idling ${idleSeconds} s with NO traffic ...`);
        if (!dry) await sleepMs(idleSeconds * 1000);
        await s.q('SELECT 1 AS ok', [], { label: 'post-idle SELECT 1' });
      } else {
        log(`  running SELECT pg_sleep(${seconds}) ...`);
        await s.q('SELECT pg_sleep($1::float8)', [seconds], { label: `pg_sleep(${seconds})` });
      }
      rec.elapsedSecs = (performance.now() - t0) / 1000;
      log(`  reply received after ${sec(performance.now() - t0)} s`);
    } catch (e) {
      rec.elapsedSecs = (performance.now() - t0) / 1000;
      rec.error = { code: e.code || e.name, message: errMsg(e, 300) };
      log(`  FAILED after ${sec(performance.now() - t0)} s: [${rec.error.code}] ${rec.error.message}`);
    }
    try { await s.q('SELECT 1 AS still_usable', [], { label: 'usable-after check' }); rec.usableAfter = !dry; log('  connection still usable after the statement: yes'); } catch (e) { rec.usableAfter = false; log(`  connection still usable after the statement: NO [${e.code || e.name}]`); }
  } catch (e) {
    if (e instanceof PreflightError) { await s.close(); throw e; }
    rec.error = rec.error || { code: e.code || e.name, message: errMsg(e, 300) };
    log(`  variant ${v} aborted: ${rec.error.message}`);
  } finally { await s.close(); }
  out.variants.push(rec);
}

log(`e6: variants=${variants.join(',')} seconds=${seconds} idleSeconds=${idleSeconds} dry=${dry} host kind=${hostKind()}`);
log('note: SET tcp_keepalives_* (variant c) is SESSION-scoped on the server side; it dies with the connection and changes no role/database/server setting.');
try { for (const v of variants) await runVariant(v); } catch (e) {
  if (!(e instanceof PreflightError)) throw e;
  console.error(`PREFLIGHT REFUSED: ${errMsg(e, 1500)}`);
  process.exit(3);
}

table('E6 summary', out.variants.map((r) => [`variant ${r.variant}`, `${r.elapsedSecs === undefined ? '-' : sec(r.elapsedSecs * 1000)} s | error: ${r.error ? `[${r.error.code}] ${r.error.message.slice(0, 80)}` : 'none'} | usable after: ${r.usableAfter}`]));
out.verdict = out.variants.every((r) => !r.error && (dry || r.usableAfter)) ? 'PASS' : 'FAIL';
if (!dry) writeResult('e6', out);
console.log(dry ? 'DRY-RUN complete (nothing was sent to any database)' : `E6 RESULT: ${out.verdict}`);
process.exitCode = out.verdict === 'FAIL' ? 1 : 0;
