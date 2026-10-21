# Coverage Loads — Avance FTTH (CSV planillas): acceptance criteria

Migration of the GeoKettle job `Jobs_AvanceFTTH_Maestro_Desarrollo.kjb` to gis-tools. It must do everything the legacy job
does (user decision), minus the folder/mail plumbing that a local upload tool replaces (listed under "Differences").
Legacy sources (read them; they are the behavioural oracle, outside the repo):
`C:\Alekos\Tasks\ETL_CGEO\jobsDesa\AVANCE_FTTH\updateAvanceFTTH\`
- `Importacion_avance_int_csv.ktr`, `Importacion_avance_mvd_csv.ktr` (CSV -> staging)
- `Planificacion_avance_ftth_update_bd.ktr` (step "Ejecutar script SQL ...": the rebuild SQL)
- `Planificacion_AvanceFTTH_Reporte_*.ktr` x5 (report SQL in the TableInput step, output format in TextFileOutput)
- `Jobs_AvanceFTTH_Reportes.kjb`, `mod_extension_reportes.sh`, `../configArch.ini` (report file names)
Sample inputs: `C:\Alekos\Tasks\cgeo-2223\SituacionFTTH_INT_21092026.csv` (6001 rows) and `SituacionFTTH_UDPEM_21092026.csv` (3996 rows).

Scope: module `src/modules/coverage-loads/`, a NEW part `avance-ftth/` (sibling of `indicators/` and `shp/`), one more stage of the
workflow shell. It never imports `indicators/` or `shp/`, and they never import it. Target database for real runs: HGDesa
(`MalyTestDB`), chosen through the existing shared connection step; the tool is DB-agnostic.

## Tables (configuration, not literals)
One constants file `avance-ftth/constants.ts` holds every table, so a rename is a one-line change; nothing else names a table:
- `STAGING_INT` = `public.avance_planilla_int`, `STAGING_UDPEM` = `public.avance_planilla_mvd`
- `AVANCE` = `public.avance_uruguay_planilla`, `HISTORY` = `historico.h_avance_uruguay`
- `ZONES` = `public.area_zonas_ftth_f` (read only), `CENTRAL_LIMITS` = `public.limite_central_ftth` (read only)
Identifiers are quoted from these constants only; nothing from a request ever reaches an identifier. All SRIDs are 31981 and
are never touched (geometry is copied from `ZONES`).
Structures verified in HGDesa (read only): staging tables `gid` serial, `central varchar(100), cable varchar(50), zona varchar(50),
empresa varchar(50), plano_al_com varchar(50), ejecutor varchar(50), director varchar(50), etiqueta varchar(50), conca varchar(100),
edificio varchar(20), fechaact text, fuente text, fechacarga date default now()`. `AVANCE`: `gid, central, cable, zona, conca,
edificio(20), empresa, fecha varchar(50), director, ejecutor, estado varchar(50), geom MultiPolygon 31981, fuente text, fechacarga
date default now()`. `HISTORY`: `id (seq), central(100), cable, zona, conca(100), edificio(20), empresa, fecha, director, ejecutor,
estado, fechacarga date, fecha_historico date default now()`. `ZONES`: `edificio varchar(10), codigo_distrito varchar(30) like
'C009Z04', situacion_distrito, geom Polygon 31981`, 7587 rows.

## Input files
- AC-1: Exactly two files per run, one of each kind, names matching `^SituacionFTTH_INT_(\d{8})\.csv$` and
  `^SituacionFTTH_UDPEM_(\d{8})\.csv$` (prefixes are named constants, taken from `configArch.ini` `sitINT`/`sitMVD`; the digits are
  `ddMMyyyy`, a real calendar date). Either missing, duplicated or misnamed is a file-level error before touching the DB. The
  two dates may differ (warning, not error).
- AC-2: Decoding ISO-8859-1, separator `;`, CRLF or LF, enclosure `"` (UDPEM legacy used it, INT none; accept quoted fields in
  both), the header line is skipped and not validated, blank lines skipped. A data row must have exactly 10 columns in the order
  `central;cable;zona;empresa;plano_al_com;ejecutor;director_obra;etiqueta;conca;edificio`, otherwise it is rejected (not blocking).
  A trailing separator (an EMPTY 11th column) is accepted and ignored; a non-empty 11th column, or a 12th, is rejected. Quoted fields never
  span physical lines: a quote opening at a field start must close on the same line, otherwise that line alone is rejected
  ("comilla sin cerrar.", raw = that line) and parsing resumes on the next line. `""` is an escaped quote; a quote not at a field
  start is plain text. No record contains a line break; line numbers are physical.
- AC-3: Every field is trimmed (including non-breaking spaces U+00A0, which the legacy trim left in the data: `3/9/2020 `).
  Empty -> NULL. For the INT file the exact value `-` also -> NULL in every column EXCEPT `plano_al_com` (legacy `nullif -`; the
  `plano_al_com` field keeps a `-`); UDPEM has no such rule. No other cleaning;
  dates in `plano_al_com` are text and are NOT reformatted (`3/9/2020` stays).
- AC-4: A row is rejected and listed (file, line, reason in Spanish) when it exceeds a target column length (central 100, cable 50,
  zona 50, empresa 50, plano_al_com 50, ejecutor 50, director 50, etiqueta 50, conca 100, edificio 20). The legacy would have failed
  the whole load on the DB error; here valid rows still load. The list is capped at 200 rows with the real total.
- AC-5: Rows the legacy loaded and the job deleted afterwards are NOT rejections: `conca LIKE 'CZONA%'` ("basura de las planillas")
  are loaded into staging and deleted by the rebuild (AC-17), and counted (INT 900, UDPEM 498 in the samples; the INT count includes a row whose `conca` is ` CZONA  ` with spaces, which the trim now catches and the legacy untrimmed `LIKE` missed). Rows with empty
  `edificio` or `#N/A` are loaded as in the legacy and reported as a warning count.
- AC-6: `fechaact` of every staging row = the 8 digits of its file name as text (`21092026`); `fuente` = `EXTERNO/J.Pierri` (named
  constant); `fechacarga` = the column default. Both staging tables are fully replaced.

## Plan (read only)
- AC-7: `POST avance-ftth/plan` (multipart: `connection`, two files) parses and validates both files, then in `BEGIN READ ONLY`
  reads: row count and `fechaact` of each staging table, row count and `fechacarga` of `AVANCE`, row count of `HISTORY`, row count
  of `ZONES`, privilege shortfalls, and the distinct `situacion_distrito` values of `ZONES` with counts. It writes nothing.
- AC-8: The plan returns per file: name, rows read, rows valid, rows rejected (AC-4, capped), junk `CZONA` rows, rows with empty
  `edificio`/`#N/A`, distinct duplicate `(edificio, cable, zona)` keys excluding zona `DO`/`Primario`/`PRIMARIO` (legacy duplicate
  report logic); plus the current DB state, `blockers[]`, `warnings[]`, `canLoad`.
- AC-9: Blockers (409): any file-level error; zero valid rows in either file; a privilege shortfall (AC-12) including a missing
  table; `ZONES` empty.
- AC-10: Warnings (never blocking, no extra checkbox): the two file dates differ; staging `fechaact` equal to the incoming one
  (already loaded that day); fewer valid rows than the current staging table, with the numbers; rejected rows; empty/`#N/A`
  edificio rows; duplicate keys; how many of the current `AVANCE` rows join to a zone whose status equals `ELIMINATED_STATUS`
  (= `Proyectado/Eliminacion`, a separate constant used only for this warning and the AC-20 breakdown; `EXCLUDED_DISTRICT_STATUSES`
  stays empty under parity, see AC-16, decision O1).

## Load
- AC-11: `POST avance-ftth/load` (multipart: `connection`, files, `confirm`, optional `dryRun`) recomputes the plan; without
  `confirm`=`"true"` -> 400 (not needed for `dryRun`); with blockers -> 409 with the plan; otherwise it writes.
- AC-12: Privileges checked up front with `shared/tablePrivileges` and again inside the write transaction: staging x2
  (SELECT, INSERT, DELETE, TRUNCATE), `AVANCE` (SELECT, INSERT, UPDATE, TRUNCATE), `HISTORY` (SELECT, INSERT), `ZONES` and
  `CENTRAL_LIMITS` (SELECT). Missing -> refuse before any write. `shared/tablePrivileges` checks table grants only; inserting into
  the serial/identity tables also needs USAGE on their sequences (staging gid, avance gid, history id). Check it with
  `has_sequence_privilege(pg_get_serial_sequence(...), 'USAGE')` using a query inside `avance-ftth/services` (do NOT edit
  `shared/`); if that cannot be determined, document it and let the HGDesa dry run catch it.
- AC-13: The write path is ONE connection and ONE transaction (`BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE`, `SET LOCAL
  lock_timeout` from `WRITE_LOCK_TIMEOUT`, a statement timeout constant of this part). Any failure -> `ROLLBACK`, all four tables
  keep their previous content (the legacy committed the staging load before the rebuild and could leave staging replaced with the
  avance not rebuilt). Order, each step a named SQL constant:
  0. right after the `SET LOCAL`s and before ANY read: `LOCK TABLE` staging INT then UDPEM (a read first would take ACCESS SHARE and
     deadlock on the lock upgrade); then privileges and the plan are verified ONCE, under the locks (there is no pre-lock check);
  1. `TRUNCATE` staging INT then UDPEM and insert the valid rows (AC-14);
  2. delete junk: `DELETE ... WHERE conca LIKE 'CZONA%'` on both staging tables;
  3. copy the current `AVANCE` into `HISTORY` (AC-15);
  4. `TRUNCATE AVANCE`;
  5. insert INT then UDPEM joined to `ZONES` (AC-16);
  6. `UPDATE AVANCE SET fuente = 'Externo/J.Pierri + WFS/SIGRA'` (named constant);
  7. verify (AC-18), then COMMIT.
- AC-14: Staging insert in batches of 1000 rows with `INSERT ... SELECT ... FROM unnest($1::text[], ...)`, values always bound
  parameters, columns exactly `central, cable, zona, empresa, plano_al_com, ejecutor, director, etiqueta, conca, edificio, fechaact,
  fuente`.
- AC-15: History copy = the legacy statement: `INSERT INTO HISTORY (central, cable, zona, conca, edificio, empresa, fecha, director,
  ejecutor, estado, fechacarga) SELECT ... FROM AVANCE` (the old `fechacarga` is preserved; `fecha_historico` takes its default).
  Decision O2 (verified against the legacy job and HGDesa): the legacy has NO SQL guard. The date-comparison branch of the master
  job (`Consulta Fecha actualizacion` -> `Simple evaluation`) exists but its hops are disabled (`enabled N`), and the live path goes
  straight to the import. What protected the history in practice was operational: the CSVs are moved `recibir -> en_proceso ->
  recibidos`, so a second run finds no files and ends "No existe archivo ... Finaliza con Error". HGDesa history confirms it: 73
  batches, none with two snapshot dates for the same `fechacarga`. An upload tool has no such consumption, so it needs a guard:
  the history copy is SKIPPED when the current `AVANCE` was itself loaded today (`fechacarga = current_date`, i.e. a same-day
  re-load that supersedes it; its predecessor is already archived). The skip is reported ("historial omitido: el Avance actual ya
  fue cargado hoy"). No DELETE privilege is needed. Option "legacy append" = always copy. Exact rule: skip iff `AVANCE` has rows
  AND every row has `fechacarga = current_date`; an empty or mixed-date Avance copies (empty copies nothing). It is evaluated with
  the DB-side `current_date` inside the write transaction, before the TRUNCATE. This clock is unrelated to the injected server
  clock used for report file names (AC-22).
- AC-16: Rebuild inserts, ported statement by statement from `Planificacion_avance_ftth_update_bd.ktr`: for INT then UDPEM,
  `INSERT INTO AVANCE (central, cable, zona, conca, edificio, empresa, fecha, director, ejecutor, estado, geom) SELECT s.central,
  '0'||trim(s.cable), s.zona, s.conca, s.edificio, s.empresa, s.plano_al_com, s.director, s.ejecutor, s.etiqueta, ST_Multi(zu.geom)
  FROM <staging> s INNER JOIN ZONES zu ON trim(s.edificio)||'|C0'||trim(s.cable)||'|Z'||trim(s.zona) =
  zu.edificio||'|'||REPLACE(zu.codigo_distrito,'Z','|Z') WHERE <status filter> GROUP BY <all selected columns>`.
  The `ZONES` status filter is decision O1 (open): the legacy text is `situacion_distrito <> 'Proyectado/Eliminación'` (with an
  accent, mojibake in the file) but HGDesa stores `Proyectado/Eliminacion` (no accent), so the legacy filter excludes NOTHING today
  and the published result contains 90 rows from eliminated zones. The filter is a named constant `EXCLUDED_DISTRICT_STATUSES`
  (list); option "parity" = empty list (what the legacy really does), option "intent" = `['Proyectado/Eliminacion']`.
- AC-17: Staging rows that find no zone are simply not inserted (legacy). The result reports unmatched = the number of DISTINCT
  trimmed keys `(edificio, cable, zona)` of the staging table, excluding zona `DO`/`Primario`/`PRIMARIO`, that find no zone in
  `ZONES`; and matched = the AVANCE rows inserted (the rebuild's GROUP BY collapses identical duplicate staging rows).
- AC-18: After the writes and before COMMIT: `SELECT count(*)` of each staging table equals its inserted valid rows minus the junk
  rows; `AVANCE` count equals the sum of the two INSERT `rowCount`s (NOT the staging counts: duplicates collapse); mismatch ->
  rollback with a clear message.
- AC-19: `dryRun`=`"true"`: the SAME code path (including the reports of AC-21 computed inside the transaction) and then
  `ROLLBACK`; the result is flagged `dryRun: true`, nothing persists. Serial values are not rolled back: every dry run (and every
  failed load) burns `gid` values of the staging and Avance tables and `id` values of the history table. UI button "Probar sin guardar". It exists because the PostGIS
  SQL cannot be tested without PostGIS; it takes locks on the target tables for its duration and the UI says so.
- AC-20: The result returns: per-file rows loaded/junk deleted, history rows copied (or skipped with the reason), avance rows
  inserted (INT, UDPEM, total), unmatched staging rows, the inserted rows broken down by `ZONES.situacion_distrito`
  (`Existente`, `Proyectado/Instalacion`, `Proyectado/Eliminacion`, `Proyectado/Modificacion`, ... computed with a SELECT of the
  same join grouped by status, run before the insert), report row counts, elapsed ms, `dryRun`, warnings.
- AC-20b: The review step shows, before anything is written, the distribution of `ZONES.situacion_distrito` and the current
  `AVANCE` rows per status (join on the same key), and says which statuses the active `EXCLUDED_DISTRICT_STATUSES` excludes. With
  parity (empty list) it shows a warning: "N filas del Avance actual provienen de zonas Proyectado/Eliminacion y se incluyen, igual
  que el job anterior". The dry run and the result show the same breakdown for the incoming data.

## Reports (the 5 legacy reports)
- AC-21: The 5 report queries are ported verbatim in meaning (the encoding mojibake in `Proyectado/Eliminaci?n` replaced by the
  AC-16 constant; unqualified `limite_central_ftth` qualified through `CENTRAL_LIMITS`):
  `duplicado_planilla_obras`, `error_estados_modificados`, `zonas_en_planilla_no_en_SIGRA`, `zonas_en_SIGRA_no_en_planilla`,
  `ZONAS_FTTH_fuera_central`. They run read-only against the post-load state: after COMMIT in their own `BEGIN READ ONLY`
  transaction with a larger statement timeout (a report failure never undoes the committed load: it is a warning and the others
  still run, as in the legacy where report errors only sent mail); in `dryRun` they run inside the load transaction before the
  rollback, each one inside its own SAVEPOINT (a failing report is rolled back to its savepoint, reported as a warning, and the
  remaining reports still run).
- AC-22: Report files: `;` separator, `"` enclosure only when needed, header row, Unix `\n`, ISO-8859-1 bytes, dates `yyyy-MM-dd`,
  columns exactly as the legacy `SelectValues`/`TextFileOutput` field lists, one file per report named
  `<prefix><yyyymmdd>.txt` with the prefixes of `configArch.ini` (`reporte_avance_duplicado_planilla_obras_`,
  `reporte_avance_zonas_en_planilla_no_en_SIGRA_`, `reporte_avance_zonas_en_SIGRA_no_en_planilla_`,
  `reporte_avance_error_estados_modificados_`, `reporte_avance_ZONAS_FTTH_fuera_central_`) and `yyyymmdd` = the server run day. All
  five go into one `AvanceFTTH_Reportes<yyyymmdd>.zip` (the legacy zip), built with a small stored-method zip writer using
  `node:zlib` `crc32` (no new dependency). An empty report is a header-only file (the legacy wrote the header always).
- AC-23: `POST avance-ftth/reports` (JSON `{connection, kind?}`) is read-only and independent of any load: with `kind` it returns
  that report's `.txt`, without it the zip; `Content-Disposition` attachment. Same pattern as the indicators reports.

## Endpoints, security, performance
- AC-24: All `POST`, `nodejs`, `force-dynamic`, declared in `module.routes.json` under `avance-ftth/plan|load|reports`, bound in
  `manifest.ts`; generated routes come from `npm run modules:routes`, never hand-edited.
- AC-25: Credentials only in the multipart/JSON body, never logged, password scrubbed from every error (reuse `toErrorResponse`).
- AC-26: Upload cap named constants (2 files, 10 MiB each, checked from `Content-Length` before the form is read and per file).
  A `plan`/`load` request WITHOUT `Content-Length` is refused with 411 ("La solicitud debe declarar su tamaño (encabezado Content-Length).");
  over the cap is 413; a malformed header is left to the form reader. The rule is `checkDeclaredBodySize(request, maxBodyBytes)` in
  `shared/uploadReaders.ts`, used by this part and by `indicators/`; the JSON `reports` routes need no declared size.
  The implementer reads `node_modules/next/dist/docs/` for the real route-handler body limits and reports any lower one.
- AC-27: Statement timeouts: write transaction constant (the rebuild joins ~9k rows to ~7.6k zones with geometry; measure in dry
  run), reports constant (the `fuera_central` report intersects every avance polygon with the 180 central limits and is the slowest).

## UI
- AC-28a: The workflow gains a first step "Tipo de carga" (before the connection) with two choices, "Cobertura (3G, LTE, 5G, NBIOT)"
  (stages `indicators`, `shp`) and "FTTH" (stage `avance-ftth`); `COVERAGE_STAGES` stays a flat list and `LOAD_TYPE_STAGE_IDS`
  (`workflow/domain/loadType.ts`) maps each stage to exactly one type. Order: Tipo de carga, Conexión, the stages of the chosen
  type only (mounted and shown in the result), Resultado; the stepper's "Paso n" follows it. CONTINUE needs a chosen type. Reopening the
  type is refused while a stage is busy; picking another type keeps the connection (and its revision) and resets all stage progress,
  picking the same type keeps the progress.
- AC-28: New stage "Avance FTTH" in `workflow/ui/coverageStages.ts` (the only edit outside `avance-ftth/` besides `manifest.ts`,
  `module.routes.json`, generated routes and docs), `StagePanelProps` contract, status and outcome published like the other stages.
  `ResultExtras` = the report downloads (zip and each report) like the indicators stage.
- AC-29: Steps: files (one dropzone accepting the two CSVs; each file is recognised by its name) -> review (per-file counts,
  rejected list with download as CSV `archivo;linea;texto;motivo`, current vs new, warnings, blockers) -> result (counts, report
  downloads). Buttons "Probar sin guardar" and "Cargar y reemplazar"; the load button only from a reviewed plan without blockers
  (pure reducer); a changed connection revision discards the reviewed plan. Spanish text, Lucide icons only, no inline styles, CSS
  modules, atomic components, types in type files, no single-letter identifiers, no raw string comparisons (const objects).

## Structure, docs, gauntlet
- AC-30: Layout `avance-ftth/{constants.ts,types.ts,domain/,services/,api/,ui/}`; DB plumbing only from `shared/`; `domain/` is
  pure (no `pg`, `next`, `react`); every SQL statement is a named exported constant in `services/queries/`.
  Generic pieces live once in `shared/` (never in a part, parts never import each other): `shared/domain/{compactDate,
  contentDisposition,latin1}.ts`, `shared/uploadReaders.ts` (`readForm`, `readFlag`, `checkDeclaredBodySize`) and, in the module
  `constants.ts`, `MAX_FILE_BYTES`, `MULTIPART_OVERHEAD_BYTES`, `CSV_SEPARATOR`, `CSV_ENCLOSURE`, `REJECTED_FILE_PREFIX`,
  `REJECTED_CSV_HEADER`. `csvFormat`/`rejectedCsv` stay per part on purpose: `indicators/` right-trims every field it writes,
  this part does not, so the behaviours differ.
- AC-31: Module stays deletable (folder + registry line + `tests/unit/modules/coverage-loads/`).
- AC-32: Docs: new section in `docs/tools/COVERAGE_LOADS_MODULE.md` (behaviour, endpoints, SQL order, privileges incl. TRUNCATE and
  DELETE, differences from the GeoKettle job, unverified items), this spec copied to
  `docs/specifications/COVERAGE_LOADS_AVANCE_FTTH_SPEC.md`, index lines in `docs/README.md` and `CLAUDE.md`.
- AC-33: Gauntlet green with real output: `modules:routes:check`, `lint` (0/0), `test`, `build`, `doctor`, `fallow`;
  `.claude/baseline.json` not regressed (record an exception if coverage moves).

## Differences from the GeoKettle job (deliberate)
- One transaction for the whole rebuild (legacy: staging committed in one transformation, rebuild in another).
- Files are uploaded; no `recibir/en_proceso/recibidos/enviar/enviados/error` folders, no move/delete of files, no
  `Truncate_Table`/date-comparison branches (they are disabled hops in the legacy job anyway).
- No emails (`mail` scripts to the Geomatica mailbox): success and failure are shown in the UI and the report zip is a download.
  Decision O3 (open) if a notification is wanted later.
- Row-level rejection list and a plan before writing; NBSP trimmed; privileges checked first.
- Decisions O1 (eliminated-zone filter, applies to the rebuild AND to the two zone-matching reports) and O2 (history skipped
  when the Avance was already loaded today) are explicit, visible choices instead of accidents.

## Unverified until a real run
- All SQL against PostgreSQL/PostGIS (no PostGIS in the test setup): first verification = "Probar sin guardar" on HGDesa with the
  two sample CSVs; expect unmatched staging rows (DO/Primario) and a total close to the published 7,311 (the zones layer was
  refreshed on 2026-10-15, after the last load, so an exact match with May is not expected).
- Duration of the `fuera_central` report and of the rebuild on HGDesa.
- HGDesa has 0 zones with NULL `situacion_distrito` today. Under parity the empty list is bound as `<> ALL('{}')`, which is true for
  NULL statuses too, whereas the legacy `<> 'x'` dropped them; it only matters if such zones appear.
