# S2 spike (CGEO-2200): staged SHP load experiments against HGDesa, TEMP tables only

**Status of the SQL: NEVER executed against PostGIS by the author (no DB available; PGlite has no PostGIS).** Semantic correctness is unverified until you run it. Node-side code was exercised only with `--dry-run` and against the real NR shapefile without a DB (indexing + streaming of EWKB).

## What it does and what it leaves in HGDesa

- Everything is `CREATE TEMP TABLE pg_temp.spike_*` (session-scoped). **Afterwards HGDesa holds nothing from this**: temp tables vanish when the session ends; the script also DROPs them explicitly and prints a before/after catalog check (non-temp relations) and the count of this session's temp relations before and after the drop. If the catalog snapshot differs the run is marked FAIL (it could also mean someone else created/dropped a table meanwhile; read the printed names).
- **The SQL guard is an EXACT allow-list** (`checkSql` in `s2-lib.mjs`, ~63 normalised statement templates = precisely the statements the scripts send; whitespace/case normalised, `$n` placeholders kept; the only variable parts are validated placeholders: `pg_temp.spike_[a-z0-9_]+`, the two-item list `cobertura5g|nbiot`, `param|chunks`, and digits in the three `SET tcp_keepalives_*`). Anything else is refused, including every `DO` block, multi-statement text, comments, `U&` identifiers and a `pg_cancel_backend` with a literal pid (only `SELECT pg_cancel_backend($1)` is allowed, and the code always passes the live session's own `processID`). A few older heuristic checks (write verbs, `public.` references, denied functions) remain on top as a **typo net / defence in depth only**.
- **What the guard is NOT**: not a security boundary against someone who edits the scripts (they can edit the allow-list too). The real protection is that all SQL is static or validated: every statement is a constant or a builder from `s2-lib.mjs`; the only interpolations are `pg_temp.spike_*` names (read back from the server's own temp schema and re-validated with `^spike_[a-z0-9_]+$`), the two-item compare list (validated in `readTestSql`/CLI), integers (validated `Number.isInteger`), and the record id/bytes/batch bounds, which are always bind parameters. `s2-selftest.mjs` runs the allow-list and the redaction checks.
- Nothing is changed on server/role/database. Session-level only: `SET statement_timeout = 0`, `SET lock_timeout = 0`, and `SET tcp_keepalives_idle/interval/count` (**session-scoped**: they die with the connection; disable with `--no-tcp-keepalive`). **`SET statement_timeout = 0` overrides any role-level or database-level `statement_timeout` protection** for this session (the DBA's safety net does not apply to these long statements).
- **Closing the console window does not stop a running statement server-side**: the backend keeps running until it finishes or the server notices the dead connection (keepalive-dependent). Stop with **Ctrl+C** (the script cancels its own backend), then check with `SELECT pid, state, now()-query_start AS age, left(query,80) FROM pg_stat_activity WHERE application_name = 'cgeo2200-spike';` and have the DBA `pg_cancel_backend` any leftover.
- Credentials only from `PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD`; never printed, never logged, no connection string is built. No `kettle.properties` is read. `application_name = cgeo2200-spike`. The JSON result files contain only "localhost/remote" for the host. Error messages printed or stored (console, JSON `error` fields) pass through `redact()`: the values of `PGHOST/PGUSER/PGDATABASE/PGPASSWORD` are replaced, as are `user|role|database|host "..."` in server messages, IPv4 addresses and the address after `ECONNREFUSED`-style codes (tested in the selftest; IPv6 addresses are only caught when they equal `PGHOST`). Redaction is best effort for a driver-generated text: look at the output before pasting it anywhere.
- **PGSSLMODE**: node-pg reads `PGSSLMODE` (and `PGSSLROOTCERT` etc.). If the server does not require SSL, and you do not set `PGSSLMODE=require` (or stricter), **the password and all data travel in clear text**. Set it explicitly for remote hosts.

### PREFLIGHT: server logging of bind parameters (before any data is sent)

Every connection (E1..E7, run-all, E6, and the second connection of the E4 read test) first runs `SHOW log_statement`, `SHOW log_min_duration_statement`, `SHOW log_parameter_max_length`, prints them, and **refuses to continue (exit code 3, nothing sent)** when `log_statement` is `mod` or `all`, or `log_min_duration_statement` is `>= 0` (including `0`). Reason: with those settings the server writes `parameters: $1 = '\x...'` for every bind parameter, in full when `log_parameter_max_length = -1`. The spike sends bytea parameters up to ~118 MB (NBIoT giant) or ~279 MB (LTE); as hex that is hundreds of MB written into the SHARED server log (disk, retention, and a copy of the data in log files).
Override only after the DBA agrees: `--accept-param-logging` (all scripts; in `--dry-run` it only changes the printed plan, nothing is sent). Note: `log_parameter_max_length_on_error` is not checked (default 0).

### The only SQL that reads real tables (SELECT only)

1. E4: second-connection read test: `SELECT (SELECT count(*) FROM public.<T>)::int AS target_rows, (SELECT max(fechacarga)::text FROM public.<T>) AS max_fechacarga` on a second, fresh connection (T = cobertura5g or nbiot). It only proves that a second session can read these two values. **It is not a lost-reply recovery test.**
   Design text only (not exercised by the spike): the REAL loader would drop its staging table INSIDE the swap transaction; after a lost reply it reconnects and checks "staging gone AND target row count / max(fechacarga) are the new values" (committed) versus "staging still present" (rolled back / never ran).
2. `pg_stat_user_tables` (`n_tup_ins/upd/del` for `public.cobertura5g` and `public.nbiot`) before the run and 3 s after the cleanup: any change marks the run FAIL (another user's DML on a live table also trips it; stats may lag a few seconds, hence the settle wait).
2. E7: `SELECT count(*), sum(ST_NPoints(geom)), max(ST_NPoints(geom)), sum(ST_Area(geom)), count(*) FILTER (WHERE NOT ST_IsValid(geom)), ST_Extent(geom)::text FROM public.<T>` (T = cobertura5g or nbiot, validated against that two-item list; `ST_IsValid` over the whole table costs some CPU on nbiot).
3. Catalog reads: `pg_class`/`pg_namespace` snapshot (`nspname NOT LIKE 'pg\_%' ESCAPE '\'`, so schemas such as `pgrouting` or `pgagent` are included), `pg_my_temp_schema()`, `SHOW ...`, `postgis_full_version()`, `pg_relation_size()` of the two E3 temp relations.

Everything else touches `pg_temp.*` only.

## Disk warning

Temp tables live in the server's temp tablespace (`temp_tablespaces`, default the database's tablespace) and are not WAL-logged but do occupy disk. Rough estimate, **10 to 15 x the file's total EWKB size** at the peak of `run-all` (raw + pieces + `fixed` copies + UPDATE dead tuples + two targets):

| File | Total EWKB (S1) | Giant record | Expect (peak) |
|---|---|---|---|
| NRUruguay | ~117 MB | ~25 MB | ~1.2 to 1.8 GB |
| NBIoTUruguay | ~139 MB | ~118 MB | ~1.5 to 2.1 GB (E1 transient ~0.6 GB) |
| LTEUruguay | ~293 MB | ~262 MB | ~3 to 4.5 GB (E1 transient ~1.2 GB). **Refused unless `--include-lte`** |

**Confirm free disk on the server first** (temp tablespace and, if the log fills, the log volume; see PREFLIGHT). E1 drops its tables when it is done.

**Backend memory**: a single bytea parameter makes the backend hold several copies at once (protocol message, the datum, the converted geometry, detoast copies). For the LTE giant record (262 to 279 MB) E1(i) can cost the backend roughly **1 to 2 GB** of memory (estimate, never measured). The NBIoT giant (~118 MB, roughly 0.5 to 0.8 GB) is the default path. E1(i) (one parameter) is the memory-heavy variant, E1(ii) (8 MiB chunks) holds one chunk per statement but its `string_agg` reassembly and the conversion still build the full value inside the server, so it also needs a few times the record size at that moment.
**LTE is only run with `--include-lte` and by passing it you acknowledge** the points above: the 1 to 2 GB backend memory for the E1(i) parameter, the 3 to 4.5 GB temp-disk peak, and the PREFLIGHT (a parameter of that size in a server log is ~560 MB of hex).
**Run the SMALL file first** (NR), then NBIoT. Do not run two copies at once.

## Steps (PowerShell, one session)

Portable node if `node` is missing: `$env:Path = "C:\Alekos\Tools\node24portable;$env:Path"`.

1. Set the connection for THIS PowerShell window only (nothing goes to history or disk):
```powershell
$env:PGHOST = "<host>"; $env:PGPORT = "5432"; $env:PGDATABASE = "<database>"; $env:PGUSER = "<user>"
$sec = Read-Host "Password" -AsSecureString
$env:PGPASSWORD = [System.Net.NetworkCredential]::new("", $sec).Password
cd C:\Alekos\Projects\gis-tools\scripts\spikes\shp-loader\s2
```
2. Look at what would be sent (no connection):
```powershell
node run-all.mjs --file "C:\Alekos\Tasks\ETL_CGEO\Avance FTTL\NRUruguay_20260901.shp" --compare cobertura5g --dry-run
```
3. Small file, whole chain (E1, E2, E3, E4, E5, E7), about 15 to 20 min (swap alone ~5 min per the tracker, plus phases A+B, plus the baseline E5, which repeats the whole work once more):
```powershell
node run-all.mjs --file "C:\Alekos\Tasks\ETL_CGEO\Avance FTTL\NRUruguay_20260901.shp" --compare cobertura5g --batch 5000
```
4. Optional: batch size comparison (re-runs the chain; only E3 changes), e.g. `--batch 1000` and `--batch 20000`. To run a single experiment: `node e3-repair.mjs --file ... --batch 1000` (re-runs the earlier phases it needs, because temp tables do not survive between runs). Wrappers: `e1-transport.mjs`, `e2-subdivide.mjs`, `e3-repair.mjs`, `e4-gates-swap.mjs`, `e5-single-swap.mjs`, `e7-verify.mjs`.
5. NBIoT, about 2 to 3 hours in total (swap ~35 min; E5 repeats it; E2/E3 separate costs unknown, that is what we are measuring):
```powershell
node run-all.mjs --file "C:\Alekos\Tasks\ETL_CGEO\Avance FTTL\NBIoTUruguay_20260901.shp" --compare nbiot --batch 5000
```
6. E6 keepalive (separate script, creates no tables). Defaults 600 s, variants a,b,c. For the real question use 3600 or 4200:
```powershell
node e6-keepalive.mjs --seconds 600
node e6-keepalive.mjs --seconds 4200 --variants a,c,d     # d = no client keepalive baseline; 70 min each
```
   Variants: a = client keepAlive + `pg_sleep`; b = client-side idle (no traffic) then `SELECT 1`; c = a plus session `SET tcp_keepalives_*`; d = no keepalive baseline. `--dry-run` prints the plan.
7. Ctrl+C is safe: the script asks the server to cancel its own query (`SELECT pg_cancel_backend($1)` with the live session's own `processID`, from a second connection) and exits; the temp tables go with the connection. Closing the console window instead does NOT stop the statement on the server (see above); verify with the `pg_stat_activity` query.
8. Clear the password afterwards: `Remove-Item Env:PGPASSWORD`.

Common flags: `--chunk-mb 8`, `--tolerance 1e-6`, `--area-tol 1` (m2, local-vs-server comparisons), `--csv <S1 per-record CSV>` (default `%TEMP%\shp-s1\<NR|NBIoT|LTE|WCDMA>_records.csv`), `--keepalive-ms 30000`, `--tcp-idle 60 --tcp-interval 20 --tcp-count 6`, `--no-tcp-keepalive`, `--accept-param-logging` (see PREFLIGHT), `--include-lte`.

## What to send back

The JSON files in `%TEMP%`: `cgeo2200-s2-run-all-<timestamp>.json` (one per run), `cgeo2200-s2-e6-<timestamp>.json`, plus the console output if something failed. Each file ends with `... RESULT: PASS|FAIL`; per experiment the console shows `E1..E7=PASS|FAIL|WARN`.

## What to read in the results

- **E1** giant record: send/convert seconds, Node peak RSS, any size error for param vs chunks; geometry equality (npoints, nrings via `ST_NRings`, area) and vs the S1 CSV (1 m2).
- **E2/E3** phase A seconds; phase B batch times min/median/p95/max (uniformity) and a progress line per batch.
- **E3** also logs `pg_relation_size('pg_temp.spike_work')` and of its id index before and after: the repair UPDATEs are mostly non-HOT, leave dead tuples and inflate the table, so the later E4/E5 scans read a bigger table than a freshly built one.
- **E4** gates, measured relative and absolute area difference, and the seconds of the BEGIN..COMMIT swap reported separately for `TRUNCATE` and `INSERT`. The TEMP targets are created with `gid serial PRIMARY KEY` and a GiST index on `geom` BEFORE the timed swap, so the INSERT pays PK + GiST maintenance like the real tables. Still excluded (so still a LOWER bound): WAL logging (TEMP tables are not WAL-logged) and concurrent readers / lock waits. The second-connection read test is only a read test (see above), not a recovery validation.
- **E5** the single-transaction baseline to compare with E2+E3+E4 total of the SAME run. **E5 is NOT like-for-like with the proven DO swap** (385 s NR / ~35 min NBIoT in the tracker): it adds a `row_number()` window and an `ORDER BY id` sort, runs on a warm temp table and has no `_src` copy. Never compare E5 against the tracker numbers.
- **E7** side-by-side with `public.cobertura5g` / `public.nbiot`. A FAIL on area only means something if the public table still holds exactly this file's load (a newer or partial load there makes it differ by itself). PASS = area diff < 1 m2 and no invalid pieces and equal rows and vertices. If only rows/vertices differ the result is **WARN** (not FAIL): they depend on identical `ST_Subdivide` behaviour (same GEOS version and same input vertex order), so differences there are informative, not by themselves a defect.
