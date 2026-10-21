# Coverage Loads — Module ("Cargas de Coberturas")

Loads the monthly `IndicadoresLTE_aaaammdd.csv` LTE coverage cuts into
`historico.h_cobertura_lte_localidad` (replace-the-cut, atomic) and produces the three report CSVs as
browser downloads. It replaces the monthly `.bat` + GeoKettle job of CGEO-2200.

Workflow: connect to PostgreSQL (HGDesa or PROD) once -> work through independent stages (today only
"Indicadores LTE": drop one or more CSVs -> review the plan (cuts, rows, existing rows that will be
replaced, rejected rows) -> confirm) -> combined "Resultado" step with the status of every stage and the
report downloads.

**Native TypeScript + `pg`.** There is no GeoKettle wrapper. The GeoKettle job stays as the reference
oracle; its output is the golden fixture the tests compare against.

**Plan and reports never write** (`BEGIN READ ONLY`). The one write path is `load`, behind a reviewed
plan and an explicit `confirm`.

It is a **module**: `src/modules/coverage-loads/`. Its deletion set is that folder, its line in
`src/app/modules.registry.ts`, `tests/unit/modules/coverage-loads/`, and the generated
`src/app/api/m/coverage-loads/**` and `src/app/tools/m/coverage-loads/` (regenerated, never edited).
Since the SHP backend the set also names `tsconfig.job.json`, the `allowImportingTsExtensions` line in the
root `tsconfig.json` and the `/data/coverage-loads/` line in `.gitignore`. They are harmless without the
module, but `tsc -p tsconfig.job.json` fails once the folder is gone, so remove them too.
**The deletion proof below has NOT been redone since the SHP backend** (it predates it).
Deletion proof (before the SHP backend): done on a scratch copy on 2026-10-09. Removed `src/modules/coverage-loads/`,
`tests/unit/modules/coverage-loads/` and the registry import + entry; `modules:routes` removed the 3 API
routes and the page (17 -> 13 route files); routes check, lint, test (70 files / 1105 tests, exactly the
module's 17 files / 557 tests fewer), build and doctor all green. The route table differs only by the 4
coverage-loads routes (`/api/m/coverage-loads/indicators/{load,plan,reports}`, `/tools/m/coverage-loads`);
no leaks; only docs remain as differences from HEAD.

## 1. Module layout

```
src/modules/coverage-loads/
  module.routes.json, manifest.ts, constants.ts, types.ts
  shared/        pg connection + runInTransaction, privilege check, request readers, http responses,
                 uploadReaders (readForm, readFlag, checkDeclaredBodySize), domain/{compactDate,
                 contentDisposition,latin1}, the Spanish connection form. Generic constants (MAX_FILE_BYTES,
                 CSV_SEPARATOR, REJECTED_CSV_HEADER, ...) live in the module constants.ts. csvFormat/rejectedCsv
                 stay per part: indicators right-trims fields, avance-ftth does not.
  indicators/    PART 2 (this document)
    constants.ts, types.ts
    domain/      pure: fileName, csvIndicators, plan, reportCsv, rejectedCsv, loadFlow (reducer), ...
    services/    IndicatorsRepository + PgIndicatorsRepository, queries/*.ts (SQL constants)
    api/         handlers.ts (thin), uploadReaders.ts
    ui/          IndicatorsPanel (a stage) + atomic components + CSS modules
  shp/           SHP loader: backend foundation (section 10) + the visible stage under shp/ui (section 10b)
    domain/      pure: file name check, flow reducer, job view helpers, plan checklist, stage report
    ui/          ShpPanel (a stage) + hooks + atomic components + CSS modules
    job/         job-safe core run by the detached process (ESM scope, `.ts` imports)
    api/         one handler file per endpoint + handlers.ts (assembly)
    services/    plan repository, upload stream, spawn, cancel, sweep, log tail
  avance-ftth/   Avance FTTH from the two CSV planillas (section 12)
  sigra-layers/  refresh of the SIGRA WFS layers into PostGIS (section 13)
  workflow/      the multi-stage shell (UI refactor, no new endpoints)
    domain/      loadType (LoadType, stage ids per type), workflowState: pure reducer (phase
                 LOAD_TYPE|CONNECTION|STAGES|RESULT, load type, confirmed connection,
                 connection revision, active stage, per-stage status + outcome)
    ui/          coverageStages (the data-driven stage list), CoverageWorkflow, WorkflowStepper,
                 StageView, WorkflowResultStep, ...
  api/, ui/      handler assembly and the dashboard page (renders the workflow shell)
```

`shared/domain/` holds the pure connection helpers and the stage contract (`StageStatus`, `StageOutcome`,
`StagePanelProps`), so `indicators/` never imports `workflow/`.

### Workflow shell

- First step "Tipo de carga": "Cobertura (3G, LTE, 5G, NBIOT)" (stages indicators, shp) or "FTTH" (stages
  sigra-layers, then avance-ftth; Avance stays locked until Capas SIGRA is Completado, and Capas SIGRA cannot be
  omitted). Only the stages of the chosen type are mounted and shown in the result; switching type keeps the
  connection and resets the stage progress; it is refused while a stage is working. `COVERAGE_STAGES` stays flat,
  `LOAD_TYPE_STAGE_IDS` assigns each stage to one type.
- One shared connection step (password in memory only). Confirming it unlocks the stages.
- `COVERAGE_STAGES` (`workflow/ui/coverageStages.ts`) is the list of stages: `{ id, label, Icon, Panel,
  ResultExtras? }`. A panel receives `{ connection, connectionRevision, onStatusChange }`. Adding a stage
  is one entry plus its own components. The section tabs (`CoverageSectionTabs`, `coverageSections`) were
  removed; the stepper (Conexion, one step per stage, Resultado) replaces them.
- Stages are independent: any order, each can be skipped ("Omitir") and resumed ("Retomar") unless it is
  working or done. All panels stay mounted (hidden when inactive) so progress is kept.
- Status per stage: Pendiente, Omitido, En curso, Completado. A "Con error" status exists in the stage
  contract for stages whose background job can fail; the indicators stage never publishes it (its errors
  are shown inside the panel while the stage stays "Pendiente"). A stage publishes a status and a
  plain-data outcome (headline + lines).
- Re-confirming a different connection bumps `connectionRevision`; a stage discards its reviewed plans
  (a done stage keeps its result as history; the indicators stage drops a reviewed plan back to the files step).
  Editing the connection is refused while a stage is working (the "Conexion" step is not clickable then).
- "Resultado" lists every stage with its status and outcome, and renders each stage's `ResultExtras`. For
  indicators these are the three report downloads. They only need the confirmed connection (the endpoint
  is read-only and independent of any load), so they are available at any time after the connection is
  confirmed, whether the stage was loaded or skipped.

`shared/` exists only so part 1 does not have to move code later. Modules cannot import each other, so
the small helpers (`runInTransaction`, request readers, http responses, connection profiles) were
copied from address-dedup, not imported.

## 2. Endpoints

All are `POST`, `nodejs`, `force-dynamic`, declared in `module.routes.json` (generated routes under
`src/app/api/m/coverage-loads/indicators/`). Credentials travel in the body only, never in a query
string, and are never stored, logged or echoed (the password is scrubbed from error text).

| Path | Body | Does |
|---|---|---|
| `indicators/plan` | multipart: `connection` (JSON string `{ host, port, db_name, user, password }`) + `files` (repeated) | Parses and validates the files, counts existing rows per `fechaact` and checks privileges in `BEGIN READ ONLY`. Returns `{ success, plan }`. Writes nothing. |
| `indicators/load` | multipart as above + `confirm: "true"` (+ `acceptShrink: "true"` when a cut shrinks) | Rebuilds the plan and writes the valid rows in one transaction. Returns `{ success, result }`. |
| `indicators/reports` | JSON `{ connection, kind: "localidad" \| "mayor50" \| "novedad" }` | Read-only. Returns the CSV as an attachment with the right file name. Independent of `load`, so reports can be regenerated at any time. |

`plan`: per cut, `fileName`, `fechaact`, `totalRows`, `validRows`, `rejectedRows` (file, line, raw text,
reason), `existingRows`, `incomplete`, `shrinks`, the Spanish messages; plus `fileErrors`,
`privilegeShortfalls`, `canLoad`, `requiresAcceptShrink`, `hasIncompleteCut`, `blockers`.

`load` result: per cut `replacedRows`, `insertedRows`, `storedRows`, `rejectedRows`, `incomplete`;
plus `totalInserted`, `totalReplaced`, `hasIncompleteCut` and every rejected row.

Status codes:

- 400: not multipart / invalid JSON, invalid connection, no files, more than 24 files, a non-file entry in
  `files`, `confirm` missing on `load`, unknown report `kind`.
- 409 (nothing written, body carries `plan`): any file-level error, a missing privilege or table, no valid
  cut at all, or a shrinking cut without `acceptShrink`. The handler checks its own plan first; `load` then
  re-checks inside the write transaction (see section 4 for the exact order).
- 411 (`plan` and `load` only): no `Content-Length` header, answered before the form is read. 413: `Content-Length`
  greater than `MAX_BODY_BYTES`, also before the form is read. Both from `shared/uploadReaders.ts`
  `checkDeclaredBodySize`, shared with avance-ftth. A malformed header is left to the form reader. `MAX_BODY_BYTES` = 24 files x 10 MiB + 1 MiB multipart overhead =
  252,706,816 bytes (`indicators/constants.ts`). `reports` has no cap.
- 409 (also): Postgres SQLSTATE `55P03` (`lock_timeout`, after 10 s) -> `Otra carga está en curso, intente de
  nuevo en unos segundos.`
- 504: SQLSTATE `57014` (`statement_timeout`, 120 s) -> `La operación excedió el tiempo máximo.`
- 500: any other unexpected error. The body `error` is the raw `error.message` with the password scrubbed,
  so it may be English Postgres text. The generic Spanish message is only the fallback for non-`Error`
  values. (Mapping: `shared/httpResponses.ts`.)

The rejected-rows CSV (`archivo;linea;texto;motivo`, UTF-8, file `filas_rechazadas_aaaammdd.csv`) is
**built in the browser** from the plan/result; there is no `indicators/rejected` endpoint.

## 3. Input files

- Name: `IndicadoresLTE_aaaammdd.csv`. The prefix and the lowercase `.csv` are case-sensitive; the eight
  digits must be a real calendar date with year >= 1 (`0000` is invalid; pure arithmetic, no JS `Date`) and become `fechaact`. Otherwise
  the file is rejected before touching the DB.
- Content: `;` separated, **ISO-8859-1** (decoded as latin1), CRLF, LF or lone CR, enclosure `"`
  (`""` escapes a quote, line breaks allowed inside). The header line is skipped, never validated.
  Columns in order: `Departamento;Localidad;%;Cobertura`.
- Per field: trimmed on both sides; the exact value `-` becomes NULL. Blank lines are skipped.
  `Cobertura` is stored upper-cased (`SI`/`NO`).
- Limits: **24 files** per request, **10 MiB** per file (a larger file becomes a file-level error), and
  a cap on the request `Content-Length`. The 24 / 10 MiB values are `MAX_FILES_PER_RUN` and
  `MAX_FILE_BYTES` in `indicators/constants.ts`.

### Row-level vs file-level rejection

**Row-level problems do not block the load: valid rows are saved, bad rows are listed** with file, line,
raw text and a Spanish reason. A row is rejected when:

- it does not have exactly 4 columns;
- `Departamento` or `Localidad` is empty (or `-`), `Departamento` is longer than 15 or `Localidad` longer
  than 40 characters;
- `%` is not a plain non-negative number (`^\d+(\.\d+)?$`) or is greater than 100;
- `Cobertura` is not SI/NO (case-insensitive);
- any field contains a NUL character (`\u0000`): `contiene un carácter nulo (NUL).`;
- a record opens a `"` enclosure that is never closed (it swallows the rest of the file): `comilla sin cerrar.`;
- `(Departamento, Localidad)` repeats inside the file: the first occurrence is kept.

The listed raw text of a rejected row is truncated to 500 characters plus an ellipsis (`…`), so a runaway
record (e.g. an unclosed quote) cannot bloat the plan, the UI or the rejected-rows CSV. A value echoed
inside a rejection reason (`%` and `Cobertura` messages) is likewise capped at 50 characters plus `…`.

**File-level problems reject the whole file** (nothing of it is saved): bad name or date, unreadable file,
file over 10 MiB, no data rows, no valid row at all, and two files with the same date in one run (both are
rejected as ambiguous). Several files with different dates are valid; each is its own cut.

### Incomplete cuts

A cut that lost rows is marked **incomplete** in the plan, the result and the UI:
`corte 2026-09-01 incompleto: 612 de 615 filas, 3 rechazadas`. Reports of an incomplete cut are still
generated, but the UI flags them.

## 4. Writing the history

One connection, one transaction (`BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE`,
`SET LOCAL lock_timeout = '10s'`, `SET LOCAL statement_timeout = 120000`). Any error rolls everything
back and the previous rows stay.

1. Privilege and table-existence check. Any shortfall is a 409 with **no lock taken**; the existing-row
   counts are read with a plain `SELECT` only to build the refused plan, if the history is readable.
2. `LOCK TABLE public.indicadores_lte IN ACCESS EXCLUSIVE MODE`, **before reading the existing-row
   counts that decide the load**, so two simultaneous loads serialise and the second one sees the first
   one's rows when it decides replace vs shrink. With no shortfall the privilege result from step 1 is
   reused after the lock, not queried again.
3. Existing rows per date, then the shrink guard (`assertLoadable`) on the plan rebuilt with those counts.
4. Writes, once for the whole run: `DELETE FROM public.indicadores_lte` once, then insert the valid rows of
   **all cuts** (oldest date first) into staging in one `INSERT` (`fechaact` per row as `YYYY-MM-DD` text,
   `fuente`, `nombloc`, `nombdepto`, `cobertura_lte` as in the file, `porcentaje` as text), then the
   replace statement once (it replaces every date present in staging):

```sql
WITH borrado AS (
  DELETE FROM historico.h_cobertura_lte_localidad
  WHERE fechaact IN (SELECT DATE(il2.fechaact) FROM public.indicadores_lte il2)
  RETURNING 1)
INSERT INTO historico.h_cobertura_lte_localidad
  (nombdepto, nombloc, porcentajecobertura, cobertura_lte, fechaact, fecha_historico, usuario)
SELECT il.nombdepto, il.nombloc, ROUND(il.porcentaje::NUMERIC, 2), UPPER(il.cobertura_lte),
       to_date(il.fechaact, 'YYYY-mm-dd'), DATE('now'), il.fuente
FROM public.indicadores_lte il
ORDER BY il.nombdepto, il.nombloc
```

   This is the legacy statement 2, unchanged. `fuente`/`usuario` is the constant `EXTERNO/F.Maresca`
   (`FUENTE`). Inserts use `unnest` arrays, never JS `Date`.
   The order is: `DELETE` staging, `INSERT` staging (all cuts), replace statement, then the stored-rows
   count per cut (`storedRows`). Then `COMMIT`.

The legacy statement 3 (`UPDATE ... SET fechaact = latest WHERE fechaact IS NULL`) is unreachable with
strict date validation and is omitted.

### Replace-the-cut semantics and limits

The load deletes **every** history row of each `fechaact` it writes, then inserts the new ones. Re-running
a corrected file restores the full cut with no duplicates. Limits:

- The tool trusts the file: loading a wrong file for a date replaces the right data. The review step
  shows plainly how many existing rows will be replaced.
- **Shrink guard.** If the valid rows to insert for a date are fewer than the rows currently stored for
  it, the plan flags `shrinks`, shows a warning and `load` needs `acceptShrink: "true"` (a separate
  checkbox in the UI). Without it: 409, nothing written. This protects a complete cut from a partial
  file.
- The history has no unique key; replace-the-cut is the only duplicate protection, and only for the
  dates in the run. Other dates are never touched.
- Concurrent loads are serialised by the lock in step 2, not by a constraint.

### Staging table refresh

`public.indicadores_lte` is emptied once (`DELETE FROM`, the role has no `TRUNCATE` privilege) and filled with
the rows of all cuts of the run inside the same transaction, for parity with the legacy GeoKettle job (other
consumers are unknown). The lock is `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE`: loads serialise, readers
are not blocked. `DELETE` leaves dead rows until the admins' vacuum. After a run staging holds the rows of all cuts (for example 5
files -> 3075 rows).

## 5. Reports

Read-only queries on the history, run after the commit, in `BEGIN READ ONLY`. SQL is the legacy
transformation SQL; the only change is `fecha_novedad` leaving the database already formatted
(`to_char(..., 'DD-MM-YYYY')`). SQL constants: `indicators/services/queries/reportQueries.ts`.

| Report | File | Columns | Rows |
|---|---|---|---|
| `localidad` | `reporte_cobertura_lte_localidad__aaaammdd.csv` | departamento;localidad;porcentajecobertura;fecha_novedad | all rows of the latest cut, `ORDER BY nombdepto, nombloc` |
| `mayor50` | `reporte_cobertura_lte_localidad_mayor50__aaaammdd.csv` | departamento;localidad;fecha_novedad | latest cut, `porcentajecobertura > 49.99` and `cobertura_lte = 'SI'` |
| `novedad` | `reporte_cobertura_lte_localidad_novedad__aaaammdd.csv` | departamento;localidad;fecha_novedad | localities at >= 50 and `SI` within the last 3 months that were not at >= 50 before that |

`aaaammdd` is the **run day** (server local date), not the cut date; the double underscore is
intentional (legacy). The "latest cut" is `max(fechaact)` in the history, not what this run loaded.

`novedad` keeps the legacy shape: `now()` (not the cut date) bounds the 3-month window, and it uses
`DISTINCT ON (nombdepto || '|' || nombloc)` over a subquery ordered by `nombdepto, nombloc, fechaact`,
with no outer `ORDER BY`. **There is no tie-break** beyond that inner order, same as legacy.

CSV format: `;` separator, header row, **LF** line endings, **ISO-8859-1** bytes, `"` enclosure only when a
value contains `;`, `"` or a newline (never forced), values right-trimmed. `porcentajecobertura` is
rendered without trailing zeros (`91.30 -> 91.3`, `100.00 -> 100`, `0.00 -> 0`).

**A report with no rows is a 0-byte file with no header** (legacy behaviour). For `novedad` this means
"sin novedades"; the UI says so.

## 6. Privileges needed

Checked up front with `has_table_privilege`, in `plan` and again inside `load` (before the lock); a
shortfall (or a missing table) is a 409 with zero writes.

| Table | Privileges |
|---|---|
| `historico.h_cobertura_lte_localidad` | `SELECT`, `INSERT`, `DELETE` |
| `public.indicadores_lte` | `SELECT`, `INSERT`, `DELETE` |

> **DELETE on the history was never needed by the old GeoKettle job.** Its role may not hold it. A DBA may
> have to grant it, for example in PROD:
> `GRANT DELETE ON historico.h_cobertura_lte_localidad TO <role>;`
> The plan shows this hint when `DELETE` is the missing privilege. `SELECT` on staging is required too,
> because the replace statement reads it. `SELECT` on the history is needed for the existing-row count read
> and for the `WHERE` of the `DELETE`. When the history table is missing or lacks `SELECT`, the counts are
> skipped: the plan shows `existingRows` 0 plus the shortfall blocker.

## 7. Differences from the GeoKettle job

- No source/target folders and no `en_proceso`/`procesados` states: files are uploaded and reports are
  downloaded. The replace-the-cut guard makes the folder states unnecessary.
- Native TypeScript + `pg` instead of Kitchen/Java; no `kettle.properties`.
- Row-level rejection list: legacy stored bad rows with NULLs or failed in the DB; here they are
  rejected, listed and the rest saved.
- Shrink guard (`acceptShrink`), absent in the legacy job.
- Strict file name (case-sensitive prefix, real calendar date) instead of the lenient mask.
- Reports as browser downloads, not files in a folder.

Additions beyond the GeoKettle job: a file with zero valid rows is a file error; `%` greater than 100 is
rejected; blank lines are skipped; only lowercase `.csv` is accepted.

## 8. Testing

`tests/unit/modules/coverage-loads/` runs the exact SQL constants against an in-process Postgres
(`@electric-sql/pglite`, a devDependency used only by tests). PGlite only: no real database.

- Domain (file name, latin1, CSV parse and row rejection, plan, report CSV), handlers with a fake
  repository, manifest, `loadFlow` reducer, plan view, client helpers.
- Repository against PGlite: reload does not duplicate, changed values replace, rollback keeps the
  previous rows, other dates untouched, two cuts in one run, shrink guard, privilege shortfalls.
- Golden parity: `fixtures/IndicadoresLTE_20260901.csv` is loaded after synthetic earlier cuts and the
  three reports are compared with the golden report files. **The comparison uses sorted lines**: PGlite
  sorts with C collation while the golden files come from a real database collation, so row order can
  differ; the line sets must match.
- `loadOrder.test.ts`: statement order inside the write transaction, post-lock counts, privilege check
  before the lock, simulated lock failure.
- `bodySize.test.ts`: 413 on `Content-Length` over the cap, before the form is read.
- React components and hooks have **no tests**.

## 9. Unverified vs legacy

- Percentage rendering of two-decimal values (`12.35`): never occurred in the golden data.
- Real-database collation and the order of the report rows (PGlite uses C collation).
- Real two-session contention and a real `lock_timeout` (the `ACCESS EXCLUSIVE` ordering itself is asserted
  in `loadOrder.test.ts`, but PGlite is single-session and cannot contend it).
- Restricted-role privileges against a real database (PROD roles, the missing `DELETE` case).
- The UI has not been exercised in a browser.

## 10. SHP backend foundation (Phase 2)

Backend: the HTTP surface and services that drive the job-safe core in `shp/job/`. The real pipeline is described in section 10c. Targets:
`NRUruguay`->`cobertura5g`, `WCDMAUruguay`->`wcdma`, `NBIoTUruguay`->`nbiot`, `LTEUruguay`->`lte`
(file name `<Prefijo>_aaaammdd.shp`, real calendar date).

### Endpoints (`shp/...`, all `nodejs`, `force-dynamic`)

Credentials only in JSON bodies, never URLs or headers; the password is scrubbed from every error and
never logged. Errors are `{ success:false, error }` in Spanish.

| Endpoint | Request | Response / status |
|---|---|---|
| `POST shp/upload` | body = the file as a **streamed** `application/octet-stream`; headers `x-file-name` (URL-encoded), `x-file-size` (bytes) | `200 { success, jobId, target:{table,prefix,fechaact}, sizeBytes }`. `400` bad name/size/type, size mismatch or client abort (folder deleted); `413` over 4 GiB; `409` a live job already holds that table; `507` not enough disk (needs size x 1.2 + 512 MiB free). |
| `POST shp/plan` | `{ connection, jobId }` | `200 { success, plan:{ jobId, target, defaultMode, availableModes, currentRows, leftovers[], privilegeShortfalls[], blockers[], expectedMs, canStart } }`. `404` unknown job, `409` job not READY. Read-only (`BEGIN READ ONLY` + statement timeout); writes nothing. |
| `POST shp/start` | `{ connection, jobId, mode: "LOAD" or "TEST", confirm: true }` | `200 { success, jobId }` at once. `400` no confirm / bad mode, `404`, `409` job not READY, plan has blockers/shortfalls or the lock is taken (`plan` included), `500` spawn failure (job marked FAILED, lock released). Re-runs the plan checks first. |
| `GET shp/status?jobId=` | - | `200 { success, status, stale }` (`status` = status.json; `stale` = looks dead but not yet swept). `400` bad id, `404`. |
| `GET shp/jobs` | - | `200 { success, jobs:[{ jobId, target, mode, state, stage, stageFraction, overallFraction, startedAt, updatedAt, errorMessage, stale }] }`, newest first. The only endpoint the future app-wide chip polls; it also runs the cleanup sweep. |
| `POST shp/cancel` | `{ jobId }` | `200 { success, jobId, outcome: "CANCELLED" or "REQUESTED" }`: READY -> cancelled on the spot (source removed, lock released); RUNNING -> `cancel.request` written. `409` otherwise (terminal or uploading), `404`. |
| `GET shp/log?jobId=&tail=N` | - | `text/plain; charset=utf-8` attachment `cargar_<table>_<jobId8>.log`, `no-store`; last N lines (default 200, max 5000) read from the last 4 MiB only. `404`. |
| `POST shp/discard` | `{ jobId }` | `200`; `409` not terminal; `404`. |

Two-step rule: `plan` writes nothing; `start` refuses (409) unless the same checks pass again.

`plan` checks: target table exists in `public` (`to_regclass`), `DELETE` + `INSERT` + `SELECT` on it,
`CREATE` on schema `public`, PostGIS in `pg_extension`, leftover work tables (reported, never dropped),
the advisory lock key looked up in `pg_locks` WITHOUT taking it, a plain `count(*)` of the target.
`leftovers` are warnings; blockers (missing table, no PostGIS, lock held) and privilege shortfalls block.

### Job folder (`data/coverage-loads/`, gitignored)

```
data/coverage-loads/
  jobs/<uuid>/         upload.part (while uploading) -> source.shp, status.json, job.log, cancel.request, start.lock
  locks/<table>.json   { table, jobId, pid, acquiredAt }
```

`status.json` v1 (never holds host, user or password): `schemaVersion, jobId, mode, target, source
{fileName,sizeBytes,receivedBytes}, state` (`UPLOADING|READY|RUNNING|CANCELLING|SUCCEEDED|FAILED|CANCELLED`),
`stage`, `stages[]` (`COPYING_FILE, READING, STAGING, SUBDIVIDING, REPAIRING, SWAPPING, FINALIZING`, each
`PENDING|RUNNING|DONE|SKIPPED|FAILED` + times), `progress` (bytes, rows, pieces, `stageFraction`,
`overallFraction`), `expectedMs, startedAt, updatedAt, heartbeatAt, pid, nodeVersion, gates, testReport,
leftovers, cancelRequested, error {code,message,stage}`. Written atomically (`.tmp` + rename).

### Status write retries

On Windows the rename of `status.json.tmp` over `status.json` can fail (`EPERM`/`EBUSY`/`EACCES`) while a
scanner or reader holds the file; under a stress loop (readers every 3 ms) about 1% of the writes with
the short budget below ran out of retries. Two budgets (`shp/job/statusFile.ts`):

- **Short** (heartbeat, progress, stage change; written through `createStatusWriter.write(status)`):
  3 retries with 25/50/75 ms backoff, then the write is dropped (logged WARN, never thrown into the
  pipeline) because the next write supersedes it.
- **Durable** (`{ durable: true }`: the RUNNING write, the terminal write, and every parent-side
  `writeJobStatus` / sweeper / cancel write): retries the whole tmp write + rename (`EPERM`, `EBUSY`,
  `EACCES`, and `ENOENT` on the rename) for up to 10 s with capped exponential backoff (25 ms doubling
  to 500 ms, 50-100% jitter). A durable write coalesced into a pending short one upgrades it.

The runtime repeats a failed terminal write once more (2 x 10 s). If it still cannot be written, the
job logs the scrubbed reason to `job.log`, prints a fixed message on stdout and exits with code **4**;
the parent's `watchChild` then marks a still-live job FAILED (`STATUS_WRITE_FAILED`) and frees its lock
(the sweeper's dead-job rule is the fallback). `readStatus` retries 3 x 20 ms on `EPERM`/`EBUSY`/`EACCES`
before answering `null`; `ENOENT` is answered at once. Exit codes: 0 succeeded, 1 failed, 2 cancelled,
3 bad config, 4 final status not written.

### Upload and spawn

The upload streams the request body to `upload.part` with backpressure (`pipeline`) and bounded memory,
writes `receivedBytes` about once per second, then renames to `source.shp` and sets READY. It never calls
`formData()`, `arrayBuffer()` or `blob()`. `start` spawns `node --max-old-space-size=1536
--disable-warning=ExperimentalWarning shp/job/jobEntry.ts` detached (`windowsHide`, stdout and stderr to
`job.log`, cwd = the job folder, **minimal env**: PATH, SystemRoot, windir, TEMP, TMP, TMPDIR, TZ, LANG,
LC_ALL; no `PG*`) and writes ONE JSON line (the `JobSpawnConfig`, password included) to its stdin. The
credentials live only in the job's memory.

`start` is **single-shot per job**: it first creates `start.lock` in the job folder exclusively (`wx`); a
second concurrent or repeated start answers 409 ("Esta carga ya fue iniciada.") and spawns nothing. After
taking the table lock it re-reads `status.json` and refuses (409) unless the job is still READY, so a
RUNNING job is never rewritten to READY from a stale snapshot. A spawn failure marks the job FAILED and
releases the table lock and the marker. The marker lives and dies with the job folder. Repeated `cancel`
on a RUNNING job keeps the first `cancel.request` (written with `wx`), so its mtime, which the force-kill
timer uses, is not refreshed. Uploads subtract the bytes other UPLOADING jobs still have to write from the
free space before the 507 check.

### Locking

Folder lock `locks/<table>.json`, created exclusively by `start` BEFORE the spawn (owner = jobId, pid
provisional, then the child's pid); the job confirms it. A lock is stale when its job is missing, terminal
or RUNNING-dead. The planned database-side advisory lock (`pg_try_advisory_lock(0x4C4F4144, <table id>)`,
ids cobertura5g 1, wcdma 2, nbiot 3, lte 4) is taken by the real pipeline for the whole run (10c); `plan` only checks
that nobody holds it. After a steal the lock is re-read and must carry the stealer's jobId. A READY job that
owns a lock is stale once its lock pid is dead, the job has been READY for more than 2 min and no fresh
`start.lock` (younger than 1 min) exists, so the table is not blocked forever.

### Cleanup (lazy, no timers)

The sweep runs once per server process on the first `shp/*` request and again on every `GET shp/jobs`
(non-overlapping, never throws into a response): abandoned uploads (2 h without growth) are deleted; dead
RUNNING jobs are marked FAILED (`JOB_CRASHED`); terminal jobs lose `source.shp` and release their lock;
terminal jobs older than 7 days are deleted; orphan locks are removed. READY jobs untouched for 24 h
(`READY_ABANDONED_MS`) are marked CANCELLED, lose `source.shp` and release their lock (never while a fresh
`start.lock` exists). A job whose pid answers but whose heartbeat is older than 10 min is treated as dead
(pid reuse). Fallback: a job whose
`cancel.request` is older than 2x the hard-kill grace (30 s), whose pid is still alive AND whose heartbeat is
fresh (at most 60 s old; otherwise the pid may belong to an unrelated process) is killed
(`SIGKILL`) and finalised CANCELLED with error code `FORCE_KILLED`. A job that exits non-zero while still
READY (bad config, early crash) is marked FAILED and its lock released by the API process.

### Work tables

`shp_stage_<table>` and `shp_work_<table>` (for example `shp_stage_lte`), deliberately distinct from the
legacy GeoKettle `stg_<table>` so the fallback job and the new loader never collide.

### Dev/test only: `COVERAGE_LOADS_SHP_PIPELINE=fake`

Read once when the handlers are created. `fake` runs the job against the fake pipeline (fixed stage
timings, never touches a database); any other value means `real`. Do not set it in production.

### `shp/job/` ESM scope rules

The job runs under plain node type stripping, so `shp/job/**` is its own ESM scope: nested `package.json`
(`{"type":"module"}`), every import is relative and carries the `.ts` extension, it never imports outside
itself, and only erasable TypeScript syntax is used. `tsconfig.job.json` checks that scope
(`npx tsc -p tsconfig.job.json --noEmit`); the root `tsconfig.json` has `allowImportingTsExtensions` so
Next-side code can import job files (`../job/layout.ts`).

### LOCAL EXPOSURE (no auth)

`next dev` and `next start` bind `0.0.0.0:3000` by default in this repo, and the app has no
authentication. `shp/upload` (writes up to 4 GiB to disk) and `shp/start` (spawns a process) are therefore
reachable from the LAN. No auth was added; run the app on a trusted network or bind it to localhost
(`-H 127.0.0.1`) until that is decided.

## 10b. SHP UI (Phase 3A)

The stage "Cargas SHP" (`workflow/ui/coverageStages.ts`, id `shp`, panel `shp/ui/ShpPanel`) follows the
`StagePanelProps` contract. It works end to end against the backend of section 10; with
`COVERAGE_LOADS_SHP_PIPELINE=fake` it runs without a database load (the real pipeline is section 10c).
All SHP UI code lives under `shp/ui/` and `shp/domain/`; nothing else in the module knows about it except
that one registry entry.

Phases (`shp/domain/shpFlowReducer.ts`, pure, no React):

1. **Pick**: one `.shp` (picker or drop). The name is checked with the same `parseShpFileName` rules as the
   server (and size 1 byte to 4 GiB); the target table and cut date are shown. "Subir y revisar" streams the
   file as the raw body of `POST shp/upload` through `XMLHttpRequest` (fetch has no upload byte progress),
   with `x-file-name` (URL-encoded) and `x-file-size`, a progress bar and a cancel button
   (`AbortController`). The plan is requested automatically when the upload ends.
2. **Review**: `POST shp/plan` shows a checklist (blockers such as missing table, PostGIS, held advisory
   lock or a load already in progress; privilege shortfalls; leftover work tables as a warning; current
   rows; expected duration), the TEST / LOAD choice and, for LOAD only, a confirmation checkbox before
   "Iniciar carga". TEST needs no checkbox because it never writes to the target table. A plan computed
   against another connection (the shell bumped `connectionRevision`) is hidden and must be reviewed again.
   "Descartar archivo" cancels the READY job and discards its folder.
3. **Run**: `POST shp/start` (`confirm: true` is always sent, the server requires it), then `GET shp/status`
   and `GET shp/log?tail=40` every 2 s until the job is terminal. Shows the phase, an overall progress bar,
   rows copied, pieces repaired, elapsed time (from the last status write), expected duration, the stage
   list, a "stale" warning and the log tail with a link to download the last 5000 lines. "Cancelar carga"
   calls `POST shp/cancel`; the poll shows when the job really stops.
4. **Result**: success, failure (server message) or cancellation, the same stats, the TEST comparison table
   (`testReport`: current / with the file / difference for rows, vertices and area), the log tail, "Nueva
   carga" and "Descartar registro" (`POST shp/discard`, terminal jobs only).
5. **Resume**: on mount the stage lists `GET shp/jobs` and picks up the newest job that is READY (goes to
   Review with no plan, "Revisar plan" asks for it again), RUNNING or CANCELLING (goes to Run). Terminal and
   UPLOADING jobs are not resumed. With several jobs in flight only the newest is shown.

Status reported to the shell (`StageStatus`): BUSY while uploading, planning, starting or running; DONE on
SUCCEEDED (headline "Carga completada" or "Prueba completada: la tabla no fue modificada"); FAILED on
FAILED (first stage in the module that publishes it); PENDING on CANCELLED (outcome "Carga cancelada") and
while waiting. Status is published from the dispatch that causes the change, not from an effect.

Credentials: the confirmed connection arrives as a prop and is only placed in the JSON bodies of `plan` and
`start`. It is never stored in the flow state. `upload`, `status`, `jobs`, `log`, `cancel` and `discard`
carry no credentials.

Phase 4 (polish and app-wide visibility):

- **Run card**: overall bar plus "Fase actual: N%, <count>" (`phaseDetail`: bytes read in READING/STAGING,
  pieces generated in SUBDIVIDING, pieces repaired in REPAIRING), elapsed and expected time, stage list.
- **Result card**: `describeFailure(error)` maps the failure code (`DB_CONNECT_FAILED, DB_CONNECTION_LOST,
  TABLE_LOCKED, LOCK_ERROR, GATE_FAILED, PIPELINE_ERROR, SHP_*, STAGE_MISMATCH, SWAP_MISMATCH, *_TIMEOUT,
  PRIVILEGE_DENIED, SERVER_RESOURCES, JOB_CRASHED, FORCE_KILLED`) to a Spanish headline (plus the phase) and shows the
  server message under it (it carries the gate reasons for `GATE_FAILED`). The gates table (`ShpGateTable`)
  shows each check with its verdict, the TEST comparison table is unchanged, and non-empty `leftovers` raise
  a warning naming the work tables left in the database.
- **Tab title and notification**: both are driven by the chip hook (`useTrackedShpJob`), so they work on any
  page: the title gets a `(NN%) ` prefix on every poll and loses it when the job ends; one `Notification` is
  shown when the job becomes terminal (once per job id, kept in `localStorage`). Permission is requested
  only from the "Avisarme al terminar" button of the run card (`ShpNotifyButton`).
- **App-wide chip**: the module contributes `ShpStatusChip` to the core slot `UiSlot.APP_STATUS` (a fixed
  stack in the root layout, drawn only when a module contributes). The SHP stage remembers the id of its
  RUNNING job in `localStorage` (`coverage-loads.shp.activeJobId`, written and cleared by `useShpJobMemory`); the
  chip polls `GET shp/status` every 5 s only while an id is remembered, shows it while the job is
  RUNNING/CANCELLING, links to `/tools/m/coverage-loads`, and forgets the id once it has seen the end.
  `status` and `jobs` take no connection body, so the chip never needs the password. Deletion set unchanged:
  the module folder, the registry line and `tests/unit/modules/coverage-loads/` (the slot stays in core and
  renders nothing without a contribution).

Not exercised: the hooks and components have no tests, and nothing here has been run in a browser.

## 10c. SHP real pipeline (Phase 3B)

`COVERAGE_LOADS_SHP_PIPELINE` unset or any value other than `fake` runs the real pipeline (the default in
production); `fake` is dev/test only. The code is `shp/job/realPipeline.ts` (orchestrator) plus
`shp/job/real/`: `realQueries.ts` (**every SQL statement**, values always bound; the only spliced text are
table identifiers, taken from a closed whitelist built from the four `ShpTable` names), one file per
phase, `binaryCopy.ts` (COPY framing), `copyTracking.ts` (COPY stream errors and abort), `gates.ts`
(pure verdict), `batches.ts` (pure planners), `stepErrors.ts` (failure codes), `pgSession.ts` (work
connection). Job scope: only `node:*`, `pg` and `pg-copy-streams`.

Dependency: `pg-copy-streams` 7.0.0 (exact pin; MIT; last published 2025-05-27, repository
`brianc/node-pg-copy-streams`, 3 maintainers) plus the dev dependency `@types/pg-copy-streams` 1.2.5 (MIT).

Per run, on ONE work connection (keepalive on, `statement_timeout` set per phase: 2 min for metadata
statements, 4 h for COPY / subdivide / repair / swap; `lock_timeout` 30 s inside the swap):

| Stage | What happens |
|---|---|
| (start) | `pg_try_advisory_lock(0x4C4F4144, tableId)`; `TABLE_LOCKED` failure if taken. `pg_backend_pid()` is remembered: the cancel hook calls `pg_cancel_backend(pid)` from a second short connection. |
| `READING` | Pass 1 of the reader (`scanShapefile`): record, ring and vertex counts and the file's net area. No DB. |
| `STAGING` | `DROP TABLE IF EXISTS shp_stage_<t>, shp_work_<t>` (leftovers of a dead run; we hold the lock), `CREATE UNLOGGED TABLE shp_stage_<t> (rec int, npoints int, geom geometry)`, then `COPY ... (rec, npoints, geom) FROM STDIN WITH (FORMAT binary)`. One tuple per record, the geometry field being the MultiPolygon EWKB (SRID 32721) streamed from the reader in 1 MiB chunks with backpressure. Verifies `count(*)` equals the records sent. |
| `SUBDIVIDING` | `CREATE UNLOGGED TABLE shp_work_<t> (piece_id identity PK, rec, geom geometry(Geometry,32721))`; `INSERT ... ST_Subdivide(ST_SetSRID(geom,32721), 256)` in batches of at most 2 M raw vertices (a bigger record runs alone). |
| `REPAIRING` | `UPDATE ... SET geom = ST_Multi(ST_CollectionExtract(ST_MakeValid(geom,'method=structure'),3))` in batches of 2000 pieces; pieces that end up empty are deleted. Then the **gates**. |
| `SWAPPING` (LOAD only) | One transaction: `lock_timeout 30s`, `LOCK TABLE public.<t> IN SHARE ROW EXCLUSIVE MODE`, `DELETE FROM public.<t>`, `INSERT (geom, fechaact, fuente, fechacarga) SELECT ... ORDER BY piece_id` (`fechaact` = file-name date, `fuente` = `EXTERNO/F.Maresca`, `fechacarga` = server `current_date`, all text `YYYY-MM-DD`), row-count check, `COMMIT`. A failure, a cancel or a mismatch rolls back: the old data stays. Skipped in TEST. |
| `FINALIZING` | LOAD: `ANALYZE public.<t>` (a failure is only a warning). TEST: the comparison report. Both: drop the two work tables. Then `pg_advisory_unlock`. |

Gates (evaluated at the end of `REPAIRING`, before anything can be swapped; any failure ends the job as
`GATE_FAILED` with the reasons): staging rows > 0 and equal to the records read; pieces exist; max piece
vertices <= 1024 (256 target plus repair headroom); 0 invalid pieces; relative area difference between the
pieces and the raw staged geometry <= 1e-6; relative difference between the staged area and the file's own
net area <= 1e-6. `status.json` `gates` carries `stagingRows, maxVertices, invalidPieces,
areaRelativeDiff, passed`.

TEST mode runs everything up to and including the gates, never touches the target, and returns
`testReport = { current, new, diff }` of `{ rows, vertices, area }`: `current` is the target as it is
(`count(*)`, `sum(ST_NPoints)`, `sum(ST_Area)`), `new` is the repaired pieces, `diff = new - current`.

Cancel: the runtime's cancel hook sends `pg_cancel_backend` from a second connection; the pipeline also
checks the abort signal between batches and inside the swap transaction (before COMMIT). A cancelled or
failed run rolls back any open transaction and drops the work tables (retried once, because a late
cancel can hit the drop); only the holder of the advisory lock cleans. If the swap already committed,
a later error does not turn the job into a failure: it ends `SUCCEEDED` with the surviving work tables
in `leftovers`.

Failure codes: `DB_CONNECT_FAILED, DB_CONNECTION_LOST, TABLE_LOCKED, SHP_EMPTY, SHP_INVALID,
STAGE_MISMATCH, GATE_FAILED, SWAP_MISMATCH, STATEMENT_TIMEOUT, LOCK_TIMEOUT, PRIVILEGE_DENIED,
SERVER_RESOURCES, LOAD_ERROR`. Messages are scrubbed of the connection values by the runtime.

**Unverified (no database was available):** every SQL statement, the binary COPY of a geometry field
(`geometry_recv` reading EWKB; a record of about 280 MB in one COPY row against the server's 1 GB field
limit), `ST_Subdivide` / `ST_MakeValid` on the raw staged geometry (proven by the GeoKettle swap, not by
this code), `pg-copy-streams` behaviour on a server-side abort, the cancel path and the swap on
PostgreSQL 14 / PostGIS 3.6. Stage timings are the legacy estimates, not measurements.

Differences from the GeoKettle job: the gate area tolerance stays 1e-6 (the tracker proposed 1e-9, not
applied); the work tables are the new `shp_stage_`/`shp_work_` pair; the swap copies from the repaired
work table instead of repairing inside the swap statement; hole assignment is done in Node by the
reader (strategy (a) of the S1 spike), not by GeoKettle.

## 11. Not done

- **Part 1, the SHP loaders**: the backend (section 10), the stage UI (10b) and the real pipeline (10c)
  exist, but the real pipeline's SQL has **never been executed against PostgreSQL/PostGIS** (no database
  was available while it was written; it was only exercised with fake clients). The first real run should
  be a TEST load on HGDesa. The app-wide chip exists (Phase 4) but has never run in a browser. The endpoints have no authentication (see
  LOCAL EXPOSURE).
- An `indicators/rejected` endpoint (the rejected-rows CSV is client-side).
- Spoon/GeoKettle integration, a unique index on the history, saving credentials, scheduling, reading the
  legacy `recibir/recibidos` folders, mail notifications.
- UI to change `FUENTE` or switch the staging refresh off.

## 12. Avance FTTH (CSV planillas)

Migration of the GeoKettle job `Jobs_AvanceFTTH_Maestro_Desarrollo.kjb`: two uploaded CSVs replace two
staging tables, the Avance FTTH table is rebuilt from them joined to the SIGRA zones layer, the old Avance
goes to the history table, and the five validation reports are produced. Acceptance criteria:
[`docs/specifications/COVERAGE_LOADS_AVANCE_FTTH_SPEC.md`](../specifications/COVERAGE_LOADS_AVANCE_FTTH_SPEC.md).
It is a part of this module (`avance-ftth/`, sibling of `indicators/` and `shp/`; the three parts never
import each other) and the stage "Avance FTTH" of the workflow shell.

```
avance-ftth/
  constants.ts   the ONLY file that names a table (STAGING_INT, STAGING_UDPEM, AVANCE, HISTORY, ZONES,
                 CENTRAL_LIMITS), plus fuente values, limits, timeouts, decision O1 constants, report definitions
  types.ts, client.ts (client-safe surface)
  domain/        pure: file name, CSV tokenizer and parser, plan and blockers, load result and consistency check,
                 report text, stored-method zip writer (node:zlib crc32), flow reducer, stage report
  services/      AvanceFtthRepository + PgAvanceFtthRepository; queries/ = every SQL statement as a named constant
  api/           plan / load / reports handlers, upload readers
  ui/            panel, flow hook, steps, rejected rows, report downloads
```

### Endpoints

All `POST`, `nodejs`, `force-dynamic`, declared in `module.routes.json`, bound in `manifest.ts`.

| Path | Body | Does |
|---|---|---|
| `avance-ftth/plan` | multipart: `connection` + exactly two `files` | Parses both CSVs and, in `BEGIN READ ONLY`, reads the staging/Avance/history/zones state, privilege shortfalls (tables and sequence USAGE) and the district-status distribution. Writes nothing. Returns `{ success, plan }`. |
| `avance-ftth/load` | multipart as above + `confirm: "true"` (not needed with `dryRun: "true"`) | Recomputes the plan (400 without confirm, 409 with blockers and the plan), then the write path. `dryRun` runs the same path plus the reports and ends in ROLLBACK. Returns `{ success, result }`. |
| `avance-ftth/reports` | JSON `{ connection, kind? }` | Read-only. With `kind` the report `.txt`, without it `AvanceFTTH_Reportes<yyyymmdd>.zip` with all five. Independent of any load. |

Upload caps: 2 files, 10 MiB each, body capped from `Content-Length` before the form is read. Next.js route
handlers have no body limit of their own; the only built-in limit (`experimental.proxyClientMaxBodySize`,
10 MB) applies when a `proxy` is used, and this repo has none.

### Input files

`SituacionFTTH_INT_ddMMyyyy.csv` and `SituacionFTTH_UDPEM_ddMMyyyy.csv` (real calendar date), ISO-8859-1, `;`,
CRLF or LF, `"` enclosure accepted, header skipped, blank lines skipped, 10 columns (an empty 11th column from a
trailing `;` is accepted; quoted fields never span lines: a quote that does not close on its own line rejects that line (`comilla sin cerrar.`) and parsing resumes on the next)
`central;cable;zona;empresa;plano_al_com;ejecutor;director_obra;etiqueta;conca;edificio`. Every field is trimmed
(U+00A0 included); empty is NULL; in the INT file `-` is NULL too, except in `plano_al_com`. Rows over a column length are rejected and
listed (cap 200, real total shown); valid rows still load. `conca LIKE 'CZONA%'` rows are loaded and deleted by
the rebuild (counted, not rejections); empty/`#N/A` `edificio` rows load and are a warning count.
`fechaact` of every staging row is the file's 8 digits as text; `fuente` is `EXTERNO/J.Pierri`.

### SQL order (one connection, one transaction)

`BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE`, `SET LOCAL lock_timeout`, `SET LOCAL statement_timeout`; privileges
checked once, after `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE` on both staging tables and the Avance (the locks come first, before any read; the plan is verified under them); then

1. `DELETE FROM` staging INT, insert its rows in batches of 1000 (`INSERT ... SELECT FROM unnest(...)`), same for UDPEM.
2. `DELETE ... WHERE conca LIKE 'CZONA%'` on both.
3. Copy `AVANCE` into `HISTORY` (legacy statement, old `fechacarga` kept). Skipped iff the Avance has rows and
   every one has `fechacarga = current_date` (DB clock): decision O2, a same-day re-load must not archive twice.
4. `DELETE FROM AVANCE`.
5. For INT then UDPEM: the breakdown by `situacion_distrito` and the unmatched-key count (SELECTs), then the
   legacy `INSERT ... SELECT ... INNER JOIN zones ... GROUP BY ...` with `ST_Multi(geom)`.
6. `UPDATE AVANCE SET fuente = 'Externo/J.Pierri + WFS/SIGRA'`.
7. Consistency check (each staging table = loaded - junk; `AVANCE` = sum of the two INSERT counts), then COMMIT.

Counts come out of the statements themselves (`WITH ... RETURNING 1`) because `shared/` exposes no `rowCount`.
Any failure rolls back all four tables. Then the five reports run after COMMIT, each group in its own
`BEGIN READ ONLY` transaction and each report in its own SAVEPOINT; a failed report is a warning and the others
still run. In `dryRun` they run inside the write transaction (each in a SAVEPOINT) before the ROLLBACK.

### Decisions

- **O1 (parity)**: `EXCLUDED_DISTRICT_STATUSES = []`. The legacy filter `situacion_distrito <> 'Proyectado/Eliminación'`
  spelled the status with an accent HGDesa does not store, so it excluded nothing. The list is bound as a
  parameter (`<> ALL($1::text[])`) in the rebuild and in the two zone-matching reports; `['Proyectado/Eliminacion']`
  would be the "intent". `ELIMINATED_STATUS` is a separate constant used only for the review warning and the
  by-status breakdown. The `LEFT JOIN ... WHERE zu.situacion_distrito <> x` of `zonas_en_planilla_no_en_SIGRA` is
  written as the inner join it always behaved as, so an empty list keeps its meaning.
- **O2 (guard)**: see step 3. **O3**: no emails.
- Dry runs burn serial values: sequences are not rolled back, so each dry run or failed load advances the staging
  and Avance `gid` and the history `id`.

### Privileges

Staging x2: SELECT, INSERT, DELETE. `AVANCE`: SELECT, INSERT, UPDATE, DELETE. `HISTORY`: SELECT, INSERT.
`ZONES` and `CENTRAL_LIMITS`: SELECT. Plus USAGE on the sequences behind the staging `gid`, the Avance `gid` and
the history `id`, checked with `has_sequence_privilege(pg_get_serial_sequence(...), 'USAGE')` (undetermined, e.g.
no serial sequence, is not a blocker; the dry run catches it). DELETE is the one that usually needs a
DBA `GRANT` (the role has no `TRUNCATE` privilege, so every write path uses `DELETE`). The locks are SHARE ROW
EXCLUSIVE: they serialise loads but readers (QGIS) are not blocked. `DELETE` leaves dead rows until the admins'
vacuum (bloat); an occasional `REINDEX` of the SHP spatial indexes is recommended.
In a dry run each report gets `SET LOCAL statement_timeout = 60000` (`DRY_RUN_REPORT_STATEMENT_TIMEOUT_MS`) inside its
SAVEPOINT, so other loads wait at most about a minute per report; a cancelled report (SQLSTATE `57014`) is an
ordinary failed report (warning, rollback to the savepoint, the rest continue). Post-COMMIT reports keep the 15 min
`REPORT_STATEMENT_TIMEOUT_MS`.

`zonas_en_planilla_no_en_SIGRA` and `zonas_en_SIGRA_no_en_planilla` are anti-joins (`WITH matched AS (...)` plus
`NOT EXISTS`), not `key NOT IN (subquery)`: Postgres planned the `NOT IN` as a non-hashed SubPlan and took minutes on
HGDesa. The NULL semantics of `NOT IN` are kept exactly: a NULL key is returned only when the matched set is empty,
and a NULL in the matched set (unreachable with real data) returns nothing. No `MATERIALIZED` (Postgres 11 target).

### Reports

`.txt`, `;`, `"` only when needed, header always (an empty report is header-only), LF, ISO-8859-1, dates
`yyyy-MM-dd`, columns as the legacy field lists, names `<prefix><yyyymmdd>.txt` with the `configArch.ini` prefixes
(`yyyymmdd` is the server's run day), all five in `AvanceFTTH_Reportes<yyyymmdd>.zip` (stored entries, `zlib.crc32`).

### Differences from the GeoKettle job

One transaction for the whole rebuild (legacy: staging committed first); files are uploaded (no folders); no
emails; a plan and a row-level rejection list before writing; NBSP trimmed (so a `CZONA` junk row with a leading
space is now also deleted: 900 junk rows in the INT sample, 899 by the legacy untrimmed `LIKE`); privileges
checked first; the O2 guard; a request without `Content-Length` is refused (411).

### Unverified until a real run

All SQL against PostgreSQL/PostGIS (no PostGIS in the test setup): the first verification is "Probar sin guardar" on
HGDesa with the two sample CSVs. Duration of the rebuild and of `fuera_central` on HGDesa (statement timeouts
`WRITE_STATEMENT_TIMEOUT_MS` and `REPORT_STATEMENT_TIMEOUT_MS` are guesses). Whether `NULL situacion_distrito`
zones matter: the legacy `<>` excluded them, `<> ALL('{}')` includes them (HGDesa has 0 such zones today).

## 13. SIGRA layers (WFS refresh)

Migration of the Pentaho jobs in `MIGRACION_PDI_WFS` (one folder per layer): each layer is read from the SGRA
GeoServer WFS and replaces a PostGIS table. The Avance FTTH rebuild joins to `public.area_zonas_ftth_f` and the
`fuera_central` report reads `public.limite_central_ftth`, and nothing refreshed them before; the other layers feed
consumers not migrated yet (the Experto FTTH KML exports) and are loaded "just in case". Acceptance criteria:
[`docs/specifications/COVERAGE_LOADS_SIGRA_LAYERS_SPEC.md`](../specifications/COVERAGE_LOADS_SIGRA_LAYERS_SPEC.md).
It is a part of this module (`sigra-layers/`; parts never import each other) and the stage "Capas SIGRA" of the FTTH
load type, placed before "Avance FTTH".

```
sigra-layers/
  constants.ts   WFS base URL, the 0.97 validation ratio, SRID, timeouts, SigraLayerId, REQUIRED_LAYER_IDS
  types.ts
  domain/        pure: layerRegistry (the 18 layers), layerMappings (declarative column mapping), featureMapping,
                 zonasFtthDerivations, wfsUrl, validation (97% rule), plan, loadResult, sigraFlow (UI reducer)
  services/      WfsClient (retry + timeout), readLayerPages, probeLayers, SigraLayersRepository +
                 PgSigraLayersRepository, queries/ (state, staging, swap, audit), auditLog
  api/           plan / load handlers, request readers
  ui/            panel, layer table, result table, client, flow hook
```

### Endpoints

Both `POST`, `nodejs`, `force-dynamic`, JSON bodies, declared in `module.routes.json`.

| Path | Body | Does |
|---|---|---|
| `sigra-layers/plan` | `{ connection, layerIds? }` (omitted = all 18) | `BEGIN READ ONLY`: per layer table state (rows, last update, privileges, sequence USAGE), TEMP privilege, audit table availability; plus one `count=1` WFS probe per layer (`numberMatched`). Writes nothing. Returns `{ success, plan }`. |
| `sigra-layers/load` | `{ connection, layerIds, dryRun?, confirm? }` | 400 for unknown or empty ids, a non-boolean flag, or a real load without `confirm: true`; 409 with the plan when any selected layer has a blocker (nothing is loaded); otherwise loads the layers one by one, in order, and returns `{ success, dryRun, results }` (HTTP 200 even when a layer failed or was rejected). |

### Per-layer load (one transaction per layer)

1. Audit `INICIADO` row in `public.etl_auditoria` (own connection, autocommitted, skipped in a dry run or when the
   table is missing/unwritable: the load goes on with a warning).
2. `BEGIN`; a session TEMP staging table (`ON COMMIT DROP`) built from the final table's column types, without
   defaults or sequences, with a unique index on the layer's key. No persistent `incoming_sgra_*` table is used.
3. WFS pages (`sortBy` + `count` + `startIndex`; sizes 1000-5000 per layer) inserted with bind parameters
   (`ON CONFLICT (key) DO NOTHING`); geometry `ST_SetSRID(ST_GeomFromGeoJSON(..), 31981)`; `fechaact`/`fuente`/
   `area_m2`/`latitud`/`longitud` computed in SQL where the layer has them.
4. Validation: pass when the final table is empty or staged/final >= 0.97 (the legacy rule). Otherwise ROLLBACK, the
   table is untouched.
5. Swap: `LOCK TABLE .. IN SHARE ROW EXCLUSIVE MODE`, `DELETE FROM`, `INSERT .. SELECT` from staging (the role has no
   `TRUNCATE`), inserted count verified, COMMIT. A dry run stops after step 4 and rolls back (no lock, no `DELETE`,
   the `gid` sequence is not used).
6. Audit `EXITO`/`ERROR` with counts and the failing step (survives the rollback).

### Layers

Required (gate the Avance stage): `zonas-ftth` (`area_zonas_ftth_f`) and `limite-central-ftth`
(`limite_central_ftth`). Optional: area-cd-sr, area-cable-cobre, area-cable-ftth, area-cajitas-cobre, area-tfo,
limite-central-cobre, limite-economico-cobre, limite-mixto-cobre (typo `LIMTE_MIXTO` is the real WFS value),
caja-distribucion, cajitas-cobre, tfo-divisores, camaras, centrales-cobre, centrales-ftth, postes,
zonas-inseguridad. `infra-canalizada` is dropped (the legacy job never worked). Every table, typeName, CQL, page size,
sort key and column mapping lives in `domain/layerRegistry.ts` and `domain/layerMappings.ts` only.

### Differences from the Pentaho jobs

No persistent staging table and no `TRUNCATE`; a stable `sortBy` on every layer (four legacy jobs paged without
one); timeout and bounded retries on every WFS request; a plan with privilege and reachability checks before
writing; a dry run; the audit never blocks a load. The 97% rule, the SRID, the column mapping and the audit table
are the legacy ones.

### Privileges

Per final table: SELECT, INSERT, DELETE and USAGE on its serial sequence. TEMP on the database.
`public.etl_auditoria`: SELECT, INSERT, UPDATE (optional).

### Unverified until a real run

All spatial SQL (`ST_*`) runs only against PostGIS: the first verification is "Probar sin guardar" on HGDesa for the
two required layers. Reachability of `vmlx-sgrabal-prod` from the app server (verified from the developer
machine only). The load transaction stays open during the whole download: a server with
`idle_in_transaction_session_timeout` could abort a very large layer (0 on HGDesa). A WFS feature whose geometry
type differs from the target column (e.g. MultiPolygon into `POLYGON`) fails the layer, as in the legacy job.
