# Routine Jobs — "Cargar localidades": acceptance criteria

Third job of the `routine-jobs` module (`src/modules/routine-jobs/`, id `routine-jobs`). Job id: `cargar-localidades`. Spanish name:
"Cargar localidades". It sits next to "Cargar padrones" (`ROUTINE_JOBS_CARGAR_PADRONES_SPEC.md`) and "Actualizar padrones de carto"
(`ROUTINE_JOBS_ACTUALIZAR_PADRON_SPEC.md`), and reuses their conventions: one wizard per job, shared connection selector and profiles,
`TableSelector`, the shared job store, per-target lock, step checklist from server-sent planned steps, Spanish messages, scrubbed passwords.
Acceptance criteria ids use the prefix `CL-`.

Legacy oracle: lines 60-101 of the one-time script `C:\Alekos\Tasks\Cargando carto.padron.sql` (outside the repo, read-only). That
block inserts the same SELECT twice: into `bdj_carto.cadastral_locality` (lines 62-77) and into `carto.cadastral_locality` (lines 82-101).
This job reproduces both inserts, faithfully, with the safety rules below. Lines 1-58 and 103-201 of the script are not part of this job.

## Context

- Monthly run, in this order:
  1. "Cargar padrones" builds the padron staging table (`bdj_carto.catastro_paispadron` in dev).
  2. **"Cargar localidades" (this job)** fills or maintains the locality tables that the script writes.
  3. The user's EXTERNAL process refreshes `carto.territorial_unit` from `carto.cadastral_locality`. Not part of this module.
  4. "Actualizar padrones de carto" resolves padron localities against `territorial_unit`.
- The job maintains one or two locality tables for the same source set. The user picks them in the wizard, each with its own schema
  (typically dev `bdj_carto.cadastral_locality` and `carto.cadastral_locality`); the same logic applies to each chosen target. No table or
  schema name is a literal in SQL or API defaults.
- The job never creates provinces, padrones, `territorial_unit` rows or URNs. It never deletes localities.

Precondition: "Cargar padrones" has loaded the padron staging table, and the localities staging table (`catastro_paislocalidades`) is
loaded by db-shapefile-sync (Replace).

Nothing in the module names a schema, table or column as a literal in SQL or API defaults. Column names come from the job's declared
logical columns and are resolved against the catalog. String VALUES that are domain data (`URBANO`, the font type id) are not identifiers
and are passed as bound parameters or constants.

## Domain constants

- `FONT_TYPE_ID = 4` (constants file of the job). The script writes the literal `4` into `id_font_type` (line 63 and line 84). It is a
  documented domain constant, not an option. No `font_type` table is part of the request, so preflight does not check it (Open questions).
- `SNAP_GRID_M = 0.001` (grid for the geometry comparison, CL-27). To be confirmed against the manual comparison (Open questions).
- Default tolerance `1.0` m (CL-26); the request carries it explicitly in `options.tolerance`.

## Layering (module_authoring.md)

- `src/core/`: `TableCatalogService` and its types are reused. The single-geometry fallback of the column resolver for the logical names
  `geom` and `geometry` (AC-2 of Cargar padrones, with the core unit test of Actualizar padrones) applies to the target geometry column.
- `src/ui-kit/`: `TableSelector` and `ProfileSelect` are reused as they are.
- `src/modules/routine-jobs/`: the new job folder `jobs/cargar-localidades/` (constants, domain SQL builders, planned steps, runner,
  session wiring, types), new routes in `module.routes.json`, the new wizard under `ui/`. Imports `core`, `ui-kit` and its own folder only.
- The job store helper is the module's shared one (moved to a shared location by AP-26 of Actualizar padrones). It is not copied. This job
  uses it under its own namespace (CL-33).

## Mapping of the script to the job

| Script (lines) | Job |
|---|---|
| 62 / 82: target columns `code, name, geometry, id_font_type, id_province` | Same columns written by the INSERT (`id` is never written, CL-17). |
| 63 / 84: `ST_TRANSFORM(aa.geom,32721)` | Target SRID read from the target geometry typmod, per target (CL-18, CL-7). The literal 32721 is not used. |
| 63 / 84: literal `4` | `FONT_TYPE_ID` (CL-17). |
| 64-73 / 86-97: source subquery, `bdp.unidadcat = 'URBANO' AND bdp.nomofidel IS NOT NULL` | Source set (CL-11). **Deliberate deviation:** the `nomofidel IS NOT NULL` predicate is dropped (CL-11). |
| 70 / 93: `INNER JOIN ... ON bdpl.coddepto = bdp.coddepto AND bdpl.localidad = bdp.nomloccat` | Same join, exact equality, no `upper()` (CL-11). |
| 72-73 / 96-97: `GROUP BY` of the source subquery | Same grouping (CL-11). |
| 74-75 / 98-99: `LEFT JOIN carto.province prov ON nomdepto_padron = prov.name` | Province lookup on exact name; no match is skipped, not inserted with NULL `id_province` (CL-13). **Deliberate deviation.** |
| 76 / 100: outer `GROUP BY` and `ORDER BY prov.name, aa.localidad` | Candidate set (CL-15); ordering kept (CL-16). |
| 62 / 82: plain `INSERT` | INSERT of NEW keys only and geometry UPDATE of CHANGED keys (CL-19, CL-22, CL-23). **Deliberate deviation:** the script has no existence check and would insert duplicates on a second run. |

## Source query (faithful to lines 60-101)

- CL-11: Source set, built from the padron staging table (selected columns: `unidadcat`, `nomdepto`, `coddepto`, `nomloccat`,
  `codloccat`, `padron`) and the localities staging table (selected columns: `localidad`, `coddepto`, `geom`):
  - rows of the padron staging table `WHERE unidadcat = 'URBANO'` (`'URBANO'` as a bound parameter). The script's `nomofidel IS NOT NULL`
    predicate is **dropped**: the new PaisUrbano shapefile has no `NOMOFIDEL` column, so the padron staging table holds it NULL on every
    urban row and the predicate would exclude every row. No other filter is applied;
  - `INNER JOIN` the localities staging table `ON coddepto = coddepto AND localidad = nomloccat` (exact equality, no `upper()`, no
    accent normalisation, as the script);
  - `GROUP BY (coddepto, localidad, nomdepto, nomloccat, codloccat, geom)` (lines 72-73 without `nomofidel`, which is no longer read).
  The grouped rows are the "filas de origen". The rows before grouping are the "filas leídas" (report, CL-37).
- CL-12: Repair happens before grouping, so the grouping compares repaired geometries. A NULL, empty or unusable localities geometry is not a
  candidate (`SIN_GEOMETRIA`, CL-15 reasons). An invalid geometry is repaired with `ST_MakeValid`, keeping only the polygonal part
  (`ST_CollectionExtract(..., 3)`), then `ST_Multi`. Valid polygonal geometries are untouched. Each staging geometry SRID is checked by CL-9.
  Repair always runs (no option); repaired geometries are counted (CL-37).
- CL-13: Province lookup: `nomdepto = province.name`, exact (as the script). Zero matches -> skipped `PROVINCIA_NO_ENCONTRADA`; more than
  one province row with that name -> skipped `PROVINCIA_AMBIGUA`. The lookup yields one row per name (`count(*)` per name), so a duplicated
  province name cannot fan out rows. The job never creates provinces.
- CL-14: NULL `codloccat` -> skipped `CODIGO_NULO` (the script would write a NULL code; the job does not). This is an addition to the three
  reasons named in the decision, listed in the report with the others.
- CL-15: Candidate set = the distinct `(id_province, name, code, geometry)` of the grouped source rows that survived CL-12 to CL-14 (the
  script's outer `GROUP BY`). A candidate key is `(id_province, name)`. When one key has more than one distinct candidate (several codes or
  several geometries for the same locality in one province), **every** candidate of that key is skipped `CLAVE_DUPLICADA`, counted and
  listed (up to 20 keys, CL-37). Keeping one would be arbitrary.
- CL-16: Output columns per target: `code` = `codloccat`, `name` = `localidad`, `geometry` = the candidate geometry transformed to that
  target's SRID (CL-18), `id_font_type` = `FONT_TYPE_ID`, `id_province` = the province id. Ordered by province name, then `localidad`
  (as the script; this fixes the order in which new ids are assigned on insert).
- CL-17: The job never sets `id`. `FONT_TYPE_ID` is the only font type written. The inserts use the target table's own `id` default (CL-22).
- CL-18: Geometry per target: the candidate geometry (staging SRID) is transformed with `ST_Transform` to the SRID of that target's
  `geometry` column, read from the catalog typmod (`postgis_typmod_srid`). The two targets may have different SRIDs; the transform is
  applied per target. Target SRID 0 refuses the run (CL-7). The stored geometry is `ST_Multi`.

## Targets, catalog and table selection

- CL-1: Targets are a list `targets` of one or two `{ schema, table }` entries, chosen by the user (typically `bdj_carto.cadastral_locality`
  and `carto.cadastral_locality`). Each target has its own schema. Every target gets the same classification and writes, all in the same
  transaction (CL-25). Zero or more than two targets, or two equal `schema.table` targets, answer `400`.
- CL-2: Target logical columns, resolved per AC-2 of Cargar padrones: `id`, `code`, `name`, `geometry`, `id_font_type`, `id_province`.
  `id` is required to report the ids of the inserted rows (CL-37); the job never writes it.
- CL-3: The selected tables (padron staging, localities staging, province, and each target) must be distinct as `schema.table`. A repetition
  answers `400` in Spanish naming both tables; no lock is taken and no query writes. A target is never a source.
- CL-4: `POST catalog/columns` accepts four new roles in addition to the existing ones: `localidades-staging-padron`,
  `localidades-staging-localidad`, `localidades-provincia`, `localidades-destino` (one role for every target, since targets are chosen by
  the user). Unknown role -> `400 { success:false, error }` in Spanish. Existing roles are unchanged.
- CL-5: Required logical columns per role (taken from the job constants, never from the request). The padron and localities staging
  tables share one schema (`stagingSchema`); the province table has its own schema (`provinceSchema`):
  - `localidades-staging-padron` (`stagingSchema`): `unidadcat`, `nomdepto`, `coddepto`, `nomloccat`, `codloccat`, `padron`. `nomofidel` is
    not required: the new PaisUrbano shapefile lacks the field (see CL-11).
    `padron` is in the user's selection but is not referenced by lines 60-101 (Open questions).
  - `localidades-staging-localidad` (`stagingSchema`): `localidad`, `coddepto`, `geom`.
  - `localidades-provincia` (`cartoSchema`): `id`, `name`.
  - `localidades-destino` (the schema of each target): `id`, `code`, `name`, `geometry`, `id_font_type`, `id_province`.
- CL-6: Missing or ambiguous required columns of any selected role are reported in Spanish on the Tables step and at `start` (AC-3 and
  AC-4 of Cargar padrones). A selection with unresolved required columns cannot be started.

## Preflight (before BEGIN; no write)

- CL-7: Target structure, for each target, Spanish refusal before any write:
  - `pg_class.relkind` is `r` or `p`; a view, materialized view or foreign table is refused;
  - the table has no inheritance children and is not itself a child (`pg_inherits`); partitioned tables are accepted (writes are routed
    to the partitions);
  - no user trigger (`pg_trigger` with `NOT tgisinternal`) and no rewrite rule other than the implicit `_RETURN` (`pg_rewrite`) on the
    table: either could redirect or extend writes;
  - the `geometry` column type is `MULTIPOLYGON` or generic `GEOMETRY` (`postgis_typmod_type`); `POLYGON` alone is refused because the
    ST_Multi output would not fit;
  - the `geometry` column SRID (`postgis_typmod_srid`) is not 0, is present in `spatial_ref_sys`, and is a metre-based projected system
    (`spatial_ref_sys.proj4text` contains `+units=m`, or `srtext` declares the unit as metre). The Hausdorff distance and the tolerance
    (CL-26) are in metres; a geographic SRID refuses the run.
- CL-8: Privileges, checked with `has_table_privilege` before BEGIN, a Spanish refusal naming table and privilege: `INSERT` and `UPDATE` on
  each target; `SELECT` on each target and on the padron staging, localities staging and province tables. A missing privilege means no write.
- CL-9: Staging checks, before any write: the localities staging `geom` column is a polygon type (Polygon, MultiPolygon or generic
  GEOMETRY, as AC-5 of Cargar padrones); the padron staging table and the localities staging table have at least one row; every SRID
  present in the localities staging geometries is non-zero and exists in `spatial_ref_sys` (mixed SRIDs are allowed; each geometry is
  transformed by its own SRID). A violation refuses the run in Spanish.
- CL-10: Columns of each target that the job does not write and that are NOT NULL without default (`id` included; an identity column counts
  as having a default) refuse the run before BEGIN, naming the column. Same rule as AP-5 of Actualizar padrones.

## Classification and write (inside one transaction)

- CL-19: Match key per target: `(id_province, name)`. Classification per candidate and per target, independently:
  - **NEW**: no target row with the key -> INSERT (CL-22);
  - **UNCHANGED**: exactly one target row with the key, and its geometry equals the candidate geometry (CL-26 step 1), or differs within the tolerance;
  - **CHANGED**: exactly one target row with the key, geometry different and farther than the tolerance -> geometry UPDATE (CL-23);
  - **AMBIGUOUS** (target): several target rows with the key -> the candidate is neither inserted nor updated; each such key is reported.
- CL-20: **MISSING** = target rows whose key matches no source row at all, skipped or not. Reported only; never deleted, never updated. A
  target key that matches a candidate skipped as `CLAVE_DUPLICADA` is neither missing nor updated; it is listed under `CLAVE_DUPLICADA`.
- CL-21: Skipped candidates (CL-12 to CL-15) are never written to either target. Each source row is counted once, under its first reason (CL-37).
- CL-22: INSERT of NEW candidates uses the target's own `id` default; the job never sets `id`. `RETURNING id, name, id_province` supplies the
  list of inserted localities (CL-37). The inserts do not use `ON CONFLICT`: the classification has already excluded existing keys.
- CL-23: Geometry UPDATE of CHANGED rows, for the target and in the same transaction, only when the option "Actualizar geometrías" is on
  (CL-30). The UPDATE sets `geometry` only. `id`, `code`, `name`, `id_font_type` and `id_province` of existing rows are never changed, and no
  row is deleted. With the option off, the CHANGED set is still computed and reported, labelled "no aplicado".
- CL-24: Count check, after the writes and before COMMIT, per target: inserted rows = NEW count; updated rows = CHANGED count when the option is
  on (0 otherwise). A mismatch rolls back with a Spanish error (AC-14b of Cargar padrones).
- CL-25: One transaction for both targets, started with `BEGIN ISOLATION LEVEL REPEATABLE READ`, so the classification and the writes read the
  same snapshot. `ANALYZE` on both targets runs inside the transaction in both modes (as AP-15 of Actualizar padrones); its failure rolls back.
- CL-26: Comparison of geometries. Option `tolerance` in metres, default `1.0`, non-negative number. Steps per candidate and existing target row:
  1. prefilter: `ST_Normalize(ST_SnapToGrid(ST_Multi(target_geometry), SNAP_GRID_M)) = ST_Normalize(ST_SnapToGrid(ST_Multi(candidate), SNAP_GRID_M))`
     (binary equality on geometry). Equal -> UNCHANGED, no further work;
  2. not equal -> `d = ST_HausdorffDistance(target, candidate)` in metres. `d <= tolerance` -> UNCHANGED (counted as "dentro de tolerancia");
     `d > tolerance` -> CHANGED with `d`;
  3. only for CHANGED: `ratio = ST_Area(ST_SymDifference(target, candidate)) / ST_Area(ST_Union(target, candidate))`; the ratio is NULL when the
     union area is 0 (the change is still CHANGED).
  Hausdorff and symmetric difference are computed only for the rows that failed step 1 (no cost for identical geometries).
- CL-27: Geometry equality constant `SNAP_GRID_M = 0.001` (CL-26 step 1). Open question on the value.

## Run control

- CL-28: `dryRun` performs the whole run (CL-19 to CL-26, the INSERTs and UPDATEs, the ANALYZE and the report), then `ROLLBACK`. The report
  carries `targetsModified: false`. A dry run consumes `nextval` values of the target id sequences (CL-29).
- CL-29: A real run performs the same, then `COMMIT`; `targetsModified: true` is reported only when the commit succeeded. In both modes no
  row of the staging, province, padron or any table other than the targets is written.
  Sequences (user delta, replaces the former "never calls setval"): step "Ajustar secuencias de destino" runs before the applies, for every
  target, the core repair statement (`setval` to `max(id) + 1` or to the sequence's own next value, whichever is greater). It only raises a
  sequence; it never resets it and never renumbers ids. The id sequence must exist (preflight, CL-10) and the role needs `UPDATE` on it.
  `setval` and `nextval` are not transactional, so values consumed by a dry run or by a rolled-back real run stay consumed (gaps). This is
  harmless for uniqueness. No sequence reset option exists in this version.
- CL-30: A real run needs `confirm: true`, the password again, and the carto target table name typed again in the wizard (CL-47). The option
  "Actualizar geometrías" (`updateGeometries`, default ON) turns off the geometry UPDATE only; the INSERTs still run in a real run.
- CL-31: Any failure before `COMMIT` rolls back both targets: both are left as they were before the run. A `COMMIT` that throws gives
  `outcomeUnknown: true`; the UI asks the user to verify both target tables before retrying (AC-21 of Cargar padrones).
- CL-32: The per-target lock: one lock key per target, `host:port|db|schema|table` (host trimmed and lowercased, port normalised, as AC-24
  of Cargar padrones). A job holds the keys of all its targets; a start whose targets overlap any RUNNING job's targets answers `409`.
  The shared job store takes a list of lock keys for this (`tryStart(lockKeys, ...)`; a single string still works as before).

## Shared job store and HTTP

- CL-33: The shared job store (module helper, AP-26 of Actualizar padrones) is used with namespace `cargar-localidades`: the lock key is
  `cargar-localidades|<lockKey>`, so it never collides with another job's key. `tryStart`, `progress`, `finish`, `fail`, `get`,
  `sweep(maxAgeMs)` as AC-26 of Cargar padrones; the lock is always released, and a background throw marks the job FAILED.
- CL-34: `POST cargar-localidades/start` body = `{ connection, stagingSchema, padronTable, localityStagingTable, provinceSchema,
  provinceTable, targets: [{ schema, table }], options: { tolerance, updateGeometries }, dryRun, confirm }`. `tolerance` is a finite number
  `>= 0` and `updateGeometries` a boolean, both required. Validated (CL-4 to CL-10, booleans, tolerance, `options` shape, 1 to 2 targets).
  Answers `200 { success, jobId }` at once; the run continues in the background.
  Errors: `400` for an invalid body, repeated tables (CL-3), missing or ambiguous columns (CL-6), a failed preflight (CL-7 to CL-10), or a real
  run without `confirm`; `409` with `Ya hay una carga de localidades en curso para esta tabla.` when a job is RUNNING for any of the targets.
- CL-35: `GET cargar-localidades/status?jobId=...` -> `200 { success, job }` with `{ jobId, state, step, current, total, dryRun, startedAt,
  finishedAt, result?, error?, outcomeUnknown? }` as AC-25 of Cargar padrones. `400` without `jobId`, `404` for an unknown id. Passwords
  are scrubbed from every field.
- CL-36: `plannedStepLabels({ dryRun, tables })` is a pure function returning the Spanish step labels for the checklist; the server sends
  them in the status. `runCargarLocalidades` calls `onProgress({ label, current, total })` once per step, in order, 1-based; a throwing
  `onProgress` never fails the run. A real run ends with the step "Confirmar cambios"; a dry run ends with "Revertir cambios de la
  simulación". The labels do not depend on `updateGeometries`. Planned steps, in order (user delta: targets are generic, so the per-target
  steps carry the table label; the sequence step is added):
  validar tablas y columnas; validar tablas de destino; contar filas de origen; resolver provincias y localidades;
  clasificar localidades: <table> (one per target); ajustar secuencias de destino; aplicar cambios: <table> (one per target);
  analizar tablas de destino; generar informe; confirmar cambios (real run) or revertir cambios de la simulación (dry run).

## Report

- CL-37: Report, built after the ANALYZE and returned in the job result. Totals: source rows read ("filas leídas" = rows of the INNER JOIN
  before grouping), grouped source rows ("filas de origen"), repaired geometries (grouped rows whose geometry was invalid), distinct
  accepted candidates, and skipped rows by reason. Skip counts are per grouped source row, each row counted once under its first reason;
  `CLAVE_DUPLICADA` applies to every grouped row of a key that has more than one distinct candidate.
  Per target (`table` = `schema.table` label; one entry per chosen target):
  - `inserted` (count) and `insertedList`: all inserted localities with `id`, name and department (capped at 500 with a warning if there are more);
  - `updated` (CHANGED count) and `updateApplied` (boolean); `changed` (CHANGED count, also when not applied);
  - `unchanged` (equal after CL-26 step 1) and `unchangedWithinTolerance`;
  - `missing` (count) with up to 20 sample keys;
  - `ambiguous` (candidate keys whose target key has several rows) with up to 20 samples;
  - `codeDiffers` (existing rows whose `code` differs from the candidate code; informational, nothing is changed) with up to 20 samples;
  - `geometryChanges`: top 20 CHANGED rows by distance, each with key (department, name), distance in metres and area ratio.
  Skipped candidates / source rows: `skipped.byReason` with all five reasons (`PROVINCIA_NO_ENCONTRADA`, `PROVINCIA_AMBIGUA`, `SIN_GEOMETRIA`,
  `CODIGO_NULO`, `CLAVE_DUPLICADA`), zero counts included, and up to 20 samples per reason (department, name, code, reason).
- CL-38: Step timings (elapsed ms per planned step, CL-36), warnings in Spanish (skipped rows present, repaired geometries present, ambiguous
  targets present, MISSING present, geometry changes present, option off, dry run: targets not modified / outcome unknown), `targetsModified`,
  and `outcomeUnknown` when set.
- CL-39: The report is built with set-based statements, no row-by-row loop and no per-row round trip. Each target has two statements that
  share the same source chain (PostgreSQL 11 materializes each CTE): a read-only classification statement (the report counts and samples),
  and an apply statement (INSERT of NEW rows and, when the option is on, the UPDATE of CHANGED rows, with `RETURNING`, in one data-modifying
  statement). Both run in the same transaction snapshot, so the apply uses the classification of that snapshot. The geometry comparison
  therefore runs twice for CHANGED rows; the cost is measured on dev (Open questions). Every report field is capped (20 samples, top 20,
  the 500 cap of CL-37), so the status payload is bounded.
- CL-40: Session settings as shp-replace (`statement_timeout`, `lock_timeout`, `client_encoding = 'UTF8'`, memory settings; reuse of the exported
  helpers of `src/core/services/server/shpReplace/pgShpSession.ts` where they fit), `connect` errors scrubbed of the password, a `close()` that
  never throws, `REPEATABLE READ` (CL-25). The password never appears in logs, statuses, results or messages.
- CL-41: Golden check of the source (testable with no database): on a fixture where no candidate is skipped, the job's source set and
  candidate rows (`id_province, name, code, geometry`) equal the rows of the script's SELECT (lines 64-77) run on the same fixture, with the
  SRID literal replaced by the target SRID and `4` by `FONT_TYPE_ID`.

## Client (UI)

Everything user-facing is Spanish; code is English; modular CSS, no inline styles, Lucide icons only.

- CL-42: Wizard (`ui/CargarLocalidadesWizard.tsx`) with `WizardOrchestrator`, five steps: (1) Conexión, (2) Tablas, (3) Opciones, (4) Revisar,
  (5) Resultado. The reducer is pure (`ui/cargarLocalidadesWizardState.ts`). `canContinue` requires: connection fields valid; the three schemas
  chosen; the five tables chosen, distinct and all valid; options valid; for a real run, the typed carto target table name and the password
  match.
- CL-43: Dependency resets: changing the connection resets schemas and tables. Changing `stagingSchema` resets the two staging tables;
  `cartoSchema` resets the province and carto target tables; `bdjSchema` resets the BDJ target table.
- CL-44: Connection step uses the shared saved-connection selector (`ProfileSelect` over `core/services/localStorageDbConfig.ts`); profiles
  are connection-only; the password is never stored; the wizard does not store schemas, tables or options in profiles.
- CL-45: Tables step: three schema fields (staging, carto, BDJ) and five `TableSelector` instances: padron staging table, localities staging
  table, province table, carto locality table, BDJ locality table. Each shows the Spanish required-column status (CL-5). A distinctness
  violation (CL-3) is shown in Spanish and blocks Siguiente.
- CL-46: Options step: "Tolerancia (m)" numeric field (default 1.0), and the toggle "Actualizar geometrías" (default ON), with the warning
  text of CL-48 next to it. Repair, sequence reset and font type are not options.
- CL-47: Review step: summary of the five tables, the tolerance and the toggle; "Analizar sin cargar" = dry run (password required);
  "Cargar localidades" = real run (password and carto target table name typed again). The warning of CL-48 is shown on the toggle and again
  on the real-run confirmation.
- CL-48: Overwrite warning (Spanish, shown on Opciones and Revisar): "Actualizar geometrías reemplaza la geometría de las localidades que
  cambiaron. Si corregiste geometrías a mano (por ejemplo solapes) directamente en estas tablas, esas correcciones se perderán. El análisis
  lista cada geometría que cambiaría: revísala antes de cargar, o desactiva la opción."
- CL-49: Result step: planned-step checklist (done / current / pending, server-sent labels, no raw counter), elapsed time from the run store while
  running; afterwards the report, laid out as Actualizar padrones (KPI cards: filas leídas, candidatas, omitidas, geometrías que cambian;
  per target: insertadas, actualizadas, sin cambios, faltantes, ambiguas; skipped by reason with a one-line Spanish explanation; top 10 lists
  with "Ver todo"; inserted list and geometry changes in collapsibles; samples in collapsibles; warnings and banners). A dry run shows the banner
  "Análisis: las tablas de localidades no fueron modificadas". An `outcomeUnknown` result shows the verify-before-retry banner.
- CL-50: Run store (`ui/cargarLocalidadesRunStore.ts`) as AC-29 of Cargar padrones: polls every 2 s (timer injected), stops on DONE/FAILED,
  survives in-app navigation, gives up only after 60 s of consecutive poll failures and then reports an unknown outcome with the job id; never
  keeps the password in its snapshot.
- CL-51: Report view-model (`ui/cargarLocalidadesReportView.ts`): pure and unit tested. Percentages per reason over the candidates plus skipped
  (0 when nothing was read), non-zero reasons sorted by count with their explanation, `rest` counts for the top 10 lists, banners and warnings.
- CL-52: Dashboard: the routine-jobs job list shows "Cargar localidades" next to the other two jobs and opens its wizard. The module page, the
  home card and the manifest need no new entry point. `module.routes.json` declares the two endpoints and the five catalog roles; the generated
  routes are regenerated with `npm run modules:routes`, never hand-edited; `npm run modules:routes:check` passes.

## Out of scope

- Creating or changing `carto.territorial_unit` rows; the external refresh from `carto.cadastral_locality` (step 3 above).
- `id_address_master`, URN (`cgeo:...`) generation and any other step of the script (lines 1-58 and 103-201).
- Creating provinces, font types or territorial unit types (the job only reads `carto.province`).
- Deleting localities, including MISSING ones. Changing `id`, `code`, `name`, `id_font_type` or `id_province` of existing rows.
- Accent- or whitespace-insensitive name matching (exact equality, as the script).
- Sequence reset options, repair toggle, preprod/prod runs, index creation, wiki page for this job.

## Open questions / assumptions

1. Column `padron` of the padron staging table is in the user's selection but not referenced by lines 60-101. It is kept as a required column
   (to validate the padron staging table); drop it if it is not wanted.
2. `FONT_TYPE_ID = 4` must exist in the target `font_type` table. Verify on dev (a foreign key would refuse the insert and roll back).
   The preflight check for it is NOT implemented: the request has no font type table and the spec does not require the check (user
   decision, this round). Add it only if a font type table is added to the request.
3. The id default of the two locality tables (sequence behind `id`) must be in step with `max(id)`; verify on dev. The job does not reset it.
4. `SNAP_GRID_M = 0.001` and the prefilter form are assumed to match the manual padron comparison; confirm the value.
5. Lock scope: resolved (user delta): one lock key per target; a job holds all of its target keys. The lock lives in one process (the
   shared job store), as for the other jobs.
6. CLAVE_DUPLICADA compares codes too: two codes for one locality name in one province, even with the same geometry, make the key duplicate.
   Confirm this is wanted (the script would insert both).
7. The `geometry` column of the targets is assumed MULTIPOLYGON or generic. Verify the typmod on dev before the first run.
8. `statement_timeout` and the cost of ST_HausdorffDistance on the full locality set are to be measured on dev; the report returns the step timings. The geometry comparison runs twice for CHANGED rows (classification statement and apply statement, CL-39).
9. The single-process in-memory job store (same as the existing jobs) is the lock; a second server process would not see it.
10. A NULL geometry on an existing target row with a source candidate is classified CHANGED (distance and area ratio NULL), so the geometry is filled when the option is on. The area ratio uses `ST_MakeValid` on both sides, so a self-intersecting manual geometry does not abort the run.

## Acceptance criteria count

CL-1 to CL-52 (52 criteria). CL-41 is the golden source check; CL-7 to CL-10 are the preflight checks.
This round builds the backend and HTTP only (CL-1 to CL-41, CL-34 and CL-35). CL-42 to CL-52 (wizard, run store, report view, dashboard
entry) are for the next round.
