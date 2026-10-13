# Coverage Loads — Indicadores LTE: acceptance criteria

Source of truth for behaviour: `C:\Alekos\Tasks\CGEO-2200\IndicadoresLTE\gis-tools-module\PLAN.md` (sections 3-7) and the golden fixtures beside it. Where the legacy `.ktr` SQL differs from PLAN.md, the `.ktr` wins and the difference is reported.

Scope: module `src/modules/coverage-loads/`, part 2 (`indicators/`). The SHP loader lives only under `shp/`; its UI exists only under `shp/ui/` (AC-30).

## Input files
- AC-1: A file name is accepted only if it matches `IndicadoresLTE_aaaammdd.csv` (case-sensitive prefix, 8 digits forming a valid calendar date -> `fechaact`). Anything else rejects the file before touching the DB, with a Spanish message naming the file.
- AC-2: Content is decoded as ISO-8859-1 (accents round-trip), `;` separated, CRLF or LF, enclosure `"`, header line skipped and never validated; columns `Departamento;Localidad;%;Cobertura`.
- AC-3: Every field is trimmed; the exact value `-` becomes NULL; no other cleaning; `Cobertura` is stored upper-cased in history.
- AC-4: A row is rejected (not blocking) and listed with file, line number, raw text and Spanish reason when: not exactly 4 columns, `%` not numeric, `Cobertura` not SI/NO (case-insensitive), `nombdepto` > 15 or `nombloc` > 40 chars, empty Departamento/Localidad, or repeated `(Departamento, Localidad)` in the file (first kept, later rejected).
- AC-5: Valid rows of a file with rejected rows are still saved.
- AC-6: File-level errors reject the whole file (nothing saved): bad name/date, unreadable file, empty file (no data rows), two files with the same date in one run.
- AC-7: A cut that lost rows is flagged incomplete in plan and result ("corte 2026-09-01 incompleto: 612 de 615 filas, 3 rechazadas").
- AC-8: Shrink guard: when rows to insert for a date < rows currently stored for that date, the plan flags it and `load` requires `acceptShrink: true`; without it `load` answers 409 and writes nothing.
- AC-9: Several files in one run are valid; each is its own cut.

## Writing the history
- AC-10: One connection, one transaction (`BEGIN`..`COMMIT`); any error -> `ROLLBACK`, previous rows stay.
- AC-11: `public.indicadores_lte` is truncated once and filled with the parsed rows of all cuts of the run (`fechaact` as `YYYY-MM-DD` text per row, `fuente`, `nombloc`, `nombdepto`, `cobertura_lte` as in file, `porcentaje` text) in the same transaction; the replace statement runs once (it replaces every date present in staging).
- AC-12: Existing history rows of every loaded `fechaact` are deleted and the new rows inserted with `ROUND(porcentaje::NUMERIC, 2)`, `UPPER(cobertura_lte)`, `fecha_historico` = current date, `usuario` = `fuente`; other dates untouched; reloading does not duplicate.
- AC-13: `fuente` is the named constant `EXTERNO/F.Maresca` in `constants.ts`, not a UI field.
- AC-14: Privileges (SELECT/INSERT/DELETE on history, TRUNCATE/INSERT on `public.indicadores_lte`) are checked up front with `has_table_privilege`; missing -> 409 with a clear message and zero writes.
- AC-15: Dates never pass through a JS `Date` (formatted in SQL or read as text).

## Reports
- AC-16: Three report queries (localidad, mayor50, novedad) run read-only after commit, with the SQL of PLAN.md §3.3 (verified against the legacy `.ktr`).
- AC-17: CSV format byte-exact vs golden: `;` separator, header row, LF, ISO-8859-1 bytes, enclosure `"` only when needed, right-trimmed values.
- AC-18: Headers: localidad `departamento;localidad;porcentajecobertura;fecha_novedad`; mayor50 and novedad `departamento;localidad;fecha_novedad`.
- AC-19: `fecha_novedad` as `dd-MM-yyyy`; `porcentajecobertura` without trailing zeros (`91.3`, `0`, `100`).
- AC-20: An empty novedad report is a 0-byte file with no header; the UI says "sin novedades".
- AC-21: Download file names `reporte_cobertura_lte_localidad__aaaammdd.csv`, `..._mayor50__...`, `..._novedad__...` with the server's local run day.

## Endpoints
- AC-22: All `POST`, `nodejs`, `force-dynamic`, under `/api/m/coverage-loads/indicators/`; credentials only in the body, never logged, password scrubbed from errors.
- AC-23: `plan` parses/validates files, counts existing rows per date in `BEGIN READ ONLY`, checks privileges, writes nothing.
- AC-24: `load` requires `confirm: "true"`, recomputes the plan, answers 409 on file-level errors / missing privilege / shrink without `acceptShrink`; otherwise writes valid rows per the history rules and returns counts and rejected rows.
- AC-25: `reports` (JSON `{connection, kind}`) is read-only, independent of `load`, returns the CSV as an attachment with the right filename.
- AC-26: `rejected` (or equivalent) lets the user download rejected rows as CSV `archivo;linea;texto;motivo` (UTF-8).

## UI and structure
- AC-27: Module page `/tools/m/coverage-loads` titled "Cargas de Coberturas", HOME_TOOL_GRID card, section switch with only "Indicadores LTE"; adding a section is a one-component change.
- AC-28: Steps Conexión -> Archivos -> Revisión -> Resultado; load only reachable from a reviewed plan (pure reducer); shrink checkbox; incomplete-cut banner; rejected-row list with download; three report downloads with sizes. UI text Spanish, Lucide icons only, no inline styles, CSS modules, atomic components.
- AC-29: DB plumbing (connection, transaction helper, privilege check, request/response helpers) lives in `shared/`; CSV-indicator code under `indicators/`; SHP code under `shp/`; no module imports another module, and `indicators/` never imports `shp/` or the reverse.
- AC-30: SHP code lives only under `shp/` (job-safe core under `shp/job/`, including the real pipeline in `shp/job/realPipeline.ts` and `shp/job/real/`, Next-side under `shp/api` and `shp/services`, pure UI logic under `shp/domain/`, the visible stage under `shp/ui/`); the only SHP touchpoint outside it is the stage entry in `workflow/ui/coverageStages.ts`. No separate SHP tab or page exists.
- AC-31: Module is deletable (folder + registry line + `tests/unit/modules/coverage-loads/`); deletion set since the SHP backend also names `tsconfig.job.json`, the `allowImportingTsExtensions` line in root `tsconfig.json` and the `/data/coverage-loads/` line in `.gitignore` (harmless without the module, but `tsc -p tsconfig.job.json` fails once the folder is gone); deletion proof was done before the SHP backend and has NOT been redone since; the `/data/coverage-loads/` runtime folder is gitignored.

## Tests and docs
- AC-32: Golden parity test: parse the real golden CSV, load into PGlite after synthetic earlier cuts, run the three reports, compare bytes with the golden report files.
- AC-33: Partial-load, shrink-guard, rollback-on-failure, no-duplicate-reload, other-dates-untouched, two-cuts-in-one-run, privilege-check, and novedad (new locality / nothing new) tests, all on PGlite; never a real database.
- AC-34: `docs/tools/COVERAGE_LOADS_MODULE.md` (behaviour, endpoints, SQL, replace-the-cut limits, privileges incl. DELETE, differences from the GeoKettle job, "unverified vs legacy" 2-decimal rendering) plus index lines in `docs/README.md`, `CLAUDE.md`, `README.md`.
- AC-35: Gauntlet green with real output: `modules:routes:check`, `lint` (0/0), `test`, `build`, `doctor`; `modules` coverage in `.claude/baseline.json` not regressed.
- AC-36: The real SHP pipeline (`COVERAGE_LOADS_SHP_PIPELINE` unset or not `fake`) stages the file through binary COPY into `shp_stage_<table>`, subdivides and repairs into `shp_work_<table>`, applies the gates (tolerance 1e-6), and in LOAD mode swaps into the target in one transaction under the advisory lock `(0x4C4F4144, tableId)`; TEST mode skips the swap and returns `testReport`; cancel, failure and success drop the work tables. Its SQL has never been executed against PostgreSQL/PostGIS (unverified, see the module doc section 10c).
