# Coverage Loads — Module ("Cargas de Coberturas")

Loads the monthly `IndicadoresLTE_aaaammdd.csv` LTE coverage cuts into
`historico.h_cobertura_lte_localidad` (replace-the-cut, atomic) and produces the three report CSVs as
browser downloads. It replaces the monthly `.bat` + GeoKettle job of CGEO-2200.

Workflow: connect to PostgreSQL (HGDesa or PROD) -> drop one or more CSVs -> review the plan (cuts,
rows, existing rows that will be replaced, rejected rows) -> confirm -> download the reports.

**Native TypeScript + `pg`.** There is no GeoKettle wrapper. The GeoKettle job stays as the reference
oracle; its output is the golden fixture the tests compare against.

**Plan and reports never write** (`BEGIN READ ONLY`). The one write path is `load`, behind a reviewed
plan and an explicit `confirm`.

It is a **module**: `src/modules/coverage-loads/`. Its deletion set is that folder, its line in
`src/app/modules.registry.ts`, `tests/unit/modules/coverage-loads/`, and the generated
`src/app/api/m/coverage-loads/**` and `src/app/tools/m/coverage-loads/` (regenerated, never edited).
Deletion proof: done on a scratch copy on 2026-10-09. Removed `src/modules/coverage-loads/`,
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
                 the Spanish connection form (reusable by part 1)
  indicators/    PART 2 (this document)
    constants.ts, types.ts
    domain/      pure: fileName, csvIndicators, plan, reportCsv, rejectedCsv, loadFlow (reducer), ...
    services/    IndicatorsRepository + PgIndicatorsRepository, queries/*.ts (SQL constants)
    api/         handlers.ts (thin), uploadReaders.ts
    ui/          IndicatorsPanel + atomic components + CSS modules
  api/, ui/      handler assembly and the dashboard shell (section tabs; only "Indicadores LTE" today)
```

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
- 413 (`{ success: false, error }`, `plan` and `load` only): `Content-Length` greater than `MAX_BODY_BYTES`,
  answered before the form is read. `MAX_BODY_BYTES` = 24 files x 10 MiB + 1 MiB multipart overhead =
  252,706,816 bytes (`indicators/constants.ts`). Only a numeric `Content-Length` is checked: a chunked or
  absent header is **not** capped (documented limit, internal tool). `reports` has no cap.
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
4. Writes, once for the whole run: `TRUNCATE public.indicadores_lte` once, then insert the valid rows of
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
   The order is: `TRUNCATE` staging, `INSERT` staging (all cuts), replace statement, then the stored-rows
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

`public.indicadores_lte` is truncated once and filled with the rows of all cuts of the run inside the same
transaction, for parity with the legacy GeoKettle job (other consumers are unknown). `TRUNCATE` takes an
exclusive lock, held until commit (seconds). After a run staging holds the rows of all cuts (for example 5
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
| `public.indicadores_lte` | `SELECT`, `TRUNCATE`, `INSERT` |

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

## 10. Not done

- **Part 1, the SHP loaders** (`NRUruguay`/`WCDMAUruguay`/`NBIoTUruguay`/`LTEUruguay_aaaammdd.shp` ->
  `cobertura5g`/`wcdma`/`nbiot`/`lte`) is **not implemented**. No SHP code, route, tab or placeholder
  exists. `shared/` and the section tabs are the only preparation.
- An `indicators/rejected` endpoint (the rejected-rows CSV is client-side).
- Spoon/GeoKettle integration, a unique index on the history, saving credentials, scheduling, reading the
  legacy `recibir/recibidos` folders, mail notifications.
- UI to change `FUENTE` or switch the staging refresh off.
