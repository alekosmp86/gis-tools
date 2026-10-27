# Routine Jobs — "Actualizar carto.padron" (user-facing: "Actualizar padrones de carto"): acceptance criteria

Second job of the `routine-jobs` module (`src/modules/routine-jobs/`, id `routine-jobs`). It sits next to the first job, "Cargar padrones"
(`ROUTINE_JOBS_CARGAR_PADRONES_SPEC.md`), and reuses its conventions: one wizard per job, shared connection selector, job store, per-target
lock, progress checklist, Spanish messages, scrubbed passwords.

Job id: `actualizar-padron`. Spanish name: "Actualizar padrones de carto". Acceptance criteria ids use the prefix `AP-` to avoid clashing with
the `AC-` ids of the Cargar padrones spec.

## Context

The padron staging table is refreshed monthly by "Cargar padrones" (one unified row per padron, in the staging table, dev example
`bdj_carto.catastro_paispadron_stg`, that is, a schema other than `carto`). The job of this spec populates a user-created work table from
that staging table.

Comparison of the work table with the live `carto.padron` (NEW / MISSING / CHANGED / AMBIGUOUS, distances, histograms) is NOT part of the
job. The user and the assistant do it by hand with queries on dev, to get context before the destination table is finally written.

`carto.padron.id` is a stable identifier: it feeds the URNs `cgeo:padron:id:<id>` (addresses_master) and `access_point.id_padron` /
`addresses_2_0_edit.id_padron` (no foreign keys). **Existing ids never change.** Nothing in this job deletes, re-inserts or re-numbers rows
of `carto.padron`.

Dev finding (first real dry run): the locality table the user selects is `carto.territorial_unit` (`padron.id_cadastral_locality` points at
it), which holds 8 unit types. 337 of 496 `LOCALIDAD CATASTRAL` names are shared with another unit type in the same province, so name-only
resolution made 914,709 urban rows `LOCALIDAD_AMBIGUA`. The optional unit-type table and the locality type filter (AP-2b, AP-7b, AP-10, AP-10b)
resolve this.

Scope of this version:
- **Stage A (populate):** the job fills a user-created work table (the "temporary table") from the staging table. This is the whole job.
- **Comparison with `carto.padron`:** manual, outside the job (see above).
- **Stage C (apply to `carto.padron`: insert new rows, update geometry in place, never touch missing rows) is FUTURE.** It is listed under
  "Out of scope" and will be specified after the manual comparison.

Precondition: the staging table has been loaded by "Cargar padrones" (`unidadcat`, `nomdepto`, `nomloccat`, `padron`, `geom` present).

Nothing in the module names a schema, table or column as a literal in SQL or API defaults. Table and schema names come from the user's
selection; column names come from the job's declared logical columns (below) and are resolved against the catalog. String VALUES that are
domain data (`RURAL`, `URBANO`, `LOCALIDAD CATASTRAL`) are not identifiers and are allowed; they are passed as bound parameters.

## Layering (module_authoring.md)
- `src/core/`: `TableCatalogService` and its types are reused. One backward-compatible change: the single-geometry-column fallback of the
  column resolver applies to the logical names `geom` and `geometry` (covered by a core unit test).
- `src/ui-kit/`: `TableSelector` and `ProfileSelect` are reused as they are.
- `src/modules/routine-jobs/`: the new job folder `jobs/actualizar-padron/` (constants, domain SQL builders, planned steps, runner, session
  wiring, types), the new routes in `module.routes.json`, the new wizard under `ui/`. Imports `core`, `ui-kit` and its own folder only.
- The job store helper is shared inside the module (see AP-26), not copied.

## Work table (user-owned)

The user creates the work table in the work schema, with a name of their choice. The job never creates, alters or drops it. Its columns:

| Logical column | Type | Rule |
|---|---|---|
| `number` | varchar (up to 10) | Written by stage A. |
| `type_padron` | varchar (up to 30) | Written by stage A (`RURAL` / `URBANO`). |
| `id_cadastral_locality` | integer, nullable | Written by stage A; NULL for rural. |
| `id_province` | integer | Written by stage A. |
| `geometry` | geometry (MultiPolygon, SRID of `carto.padron`, or generic) | Written by stage A. |
| `id` | integer | Optional. The job **never writes `id`** (see AP-5). |

Any other column of the work table is either nullable or has a default; a NOT NULL column without default that the job does not write
makes the run refuse (AP-5).

## Schemas

The wizard and the request carry three schema fields (AP-20, AP-27):
- `stagingSchema`: the schema of the staging table.
- `workSchema`: the schema of the work table only.
- `cartoSchema`: the schema of the padron, province, locality and (optional) unit-type tables (`carto` in dev).

## Catalog and table selection

- AP-1: `POST catalog/columns` accepts seven new roles in addition to the existing `rural | urbano | target`: `actualizar-staging`,
  `actualizar-temp`, `actualizar-padron`, `actualizar-provincia`, `actualizar-localidad`, `actualizar-localidad-tipada` (the locality table
  read with `id_territorial_unit_type`, used only when a type table is selected), `actualizar-tipo` (the unit-type table, optional).
  The required logical columns of each role are taken from the job constants, never from the request. An unknown role -> `400 { success:false,
  error }` in Spanish. Existing roles are unchanged.
- AP-2: Required logical columns per role, resolved per the catalog rules of the Cargar padrones spec (AC-2 tiers, generic `geom`
  exception applied to the logical geometry column of every role):
  - staging: `unidadcat`, `nomdepto`, `nomloccat`, `padron`, `geom`.
  - temp: `number`, `type_padron`, `id_cadastral_locality`, `id_province`, `geometry`.
  - padron (`carto.padron`, in `cartoSchema`): `id`, `geometry`. The padron table is used only for the two catalog reads of AP-5 and AP-7; no
    row of it is read or written.
  - province (`carto.province`, in `cartoSchema`): `id`, `name`.
  - locality (`carto.cadastral_locality`, or `carto.territorial_unit` in dev, in `cartoSchema`): `id`, `name`, `id_province`. Plus `id_territorial_unit_type`
    when a type table is selected (AP-2b).
  - type (optional, `actualizar-tipo`, in `cartoSchema`): `id`, `name`. Selected or not, it is never required.
- AP-2b: When a type table is selected, the locality table is checked under the role `actualizar-localidad-tipada` (AP-1), which additionally
  requires the logical column `id_territorial_unit_type`, resolved like the others (for example `id_territorial_unit_type`). A missing or ambiguous `id_territorial_unit_type` is reported by AP-4 and the run cannot be started. When no type table
  is selected, `id_territorial_unit_type` is neither required nor read.
- AP-3: The selected tables must be distinct as `schema.table` across the three schemas: staging, work, and the padron, province, locality and
  type tables (in `cartoSchema`). Five distinct tables when no type table is selected, six when it is. A repetition -> `400` in Spanish naming
  the two tables; the lock is not taken and no query writes.
- AP-4: `POST actualizar-padron/start` (and the wizard's Tables step) report missing or ambiguous required columns of each selected role in
  Spanish; a selection with unresolved required columns cannot be started.

## Preflight (before BEGIN; no write)

- AP-5: Work table checks, all in Spanish, all refusing before any write:
  - the work table must be a regular or partitioned table (`pg_class.relkind` `r` or `p`); a view, materialized view or foreign table is
    refused, because a DELETE or INSERT through it could reach another table such as `carto.padron`;
  - no column of the work table (`id` or any other) may default to the sequence that backs the padron table's `id` (`carto.padron.id` in
    dev). That sequence is resolved with `pg_get_serial_sequence` (serial and identity columns), not named in code. A work table that uses it
    is refused;
  - no column outside the resolved logical columns may be NOT NULL without default (`id` included, since it is never written); an identity
    column counts as having a default;
  - the resolved geometry column must be a geometry column whose SRID is the padron SRID or 0 (generic).
- AP-6: Staging checks: staging geometry column is a polygon type (Polygon, MultiPolygon or generic GEOMETRY), as in AC-5 of Cargar
  padrones; the staging `padron` column has a numeric data type; the staging table has at least one row; every staging geometry SRID is
  either the padron SRID or exists in `spatial_ref_sys` (SRID 0 or an unknown SRID refuses the run). Empty or wrong staging -> refused
  before any write, in Spanish.
- AP-7: The target SRID is read from the catalog typmod of the padron table's geometry column in `cartoSchema` (`carto.padron` in dev; the
  same rule as AC-8 of Cargar padrones). A generic (typmod 0) padron geometry column refuses the run.
- AP-7b: Type table check (only when a type table is selected; before BEGIN; no write): the type table must contain exactly one row where
  `upper(name) = upper(localityType)`. Zero or more than one -> refused in Spanish, naming the type (the `localityType` value) and the table
  (`schema.table`). `localityType` is embedded in the populate SQL as a quote-escaped SQL literal and is validated by preflight against the
  type table. The type id found here is the one used by AP-10. An absent `localityType` defaults to `LOCALIDAD CATASTRAL`; a blank
  one is refused with `400` at parse time (AP-20), before any catalog read.

## Stage A: populate the work table

- AP-8: One transaction for the whole run, started with `BEGIN ISOLATION LEVEL REPEATABLE READ` so the populate and the report read the same
  staging snapshot. Clearing option: `DELETE` (default) or `TRUNCATE`, as in AC-15/AC-16 of Cargar padrones
  (privilege checked with `has_table_privilege` before BEGIN; TRUNCATE refused when another table has a foreign key to the work table; never
  `CASCADE`). The padron table is never cleared or written.
- AP-9: Province resolution: a staging row maps to the province row (`carto.province` in dev) where `upper(nomdepto) = upper(name)`. Zero
  matches -> row skipped with reason `PROVINCIA_NO_ENCONTRADA`; more than one match -> skipped with `PROVINCIA_AMBIGUA`. The job never creates
  provinces.
- AP-10: Locality resolution (URBANO rows only): the locality row where `id_province` equals the resolved province id and
  `upper(nomloccat) = upper(name)`. When a type table is selected (AP-2b), only locality rows whose `id_territorial_unit_type` equals the type id found by
  AP-7b are considered. Zero matches -> skipped with `LOCALIDAD_NO_ENCONTRADA`; more than one -> `LOCALIDAD_AMBIGUA`. RURAL rows never look up
  a locality and get `id_cadastral_locality` NULL. The job never creates localities.
- AP-10b: Without a type table the type filter is not applied: every locality row of the locality table is a candidate, and `id_territorial_unit_type` is
  neither required nor read, so `carto.cadastral_locality` keeps working. With a type table, locality rows whose `id_territorial_unit_type` is NULL never
  match.
- AP-11: Values: `number` = `trunc(padron)::text` (no decimals). `type_padron` = `unidadcat`. A NULL `padron`, a NULL `unidadcat`, a
  `unidadcat` other than `RURAL` / `URBANO`, a NULL `nomdepto`, or an URBANO row with a NULL `nomloccat` -> skipped with reason
  `CLAVE_NULA`. A `number` that does not fit the work table column rolls back the run with a Spanish error.
- AP-12: Geometry: a NULL or empty geometry -> skipped `SIN_GEOMETRIA`. A geometry that is not valid is repaired with `ST_MakeValid`, keeping
  only the polygonal part (`ST_CollectionExtract(..., 3)`), then `ST_Multi`; a repair that leaves nothing -> skipped `SIN_GEOMETRIA`. A valid
  geometry that is not Polygon or MultiPolygon (generic staging column holding a point or a line) goes through the same polygonal
  extraction and is skipped `SIN_GEOMETRIA` when nothing polygonal remains. Valid polygonal geometries are untouched. A geometry with a SRID
  other than the target SRID is transformed with `ST_Transform`. The stored geometry is `ST_Multi`. Repair always runs (no option in this
  version); repaired rows are counted in the report (AP-16).
- AP-13: Natural-key collisions: after resolution, the natural key of a row is `(type_padron, id_province, id_cadastral_locality, number)`.
  When several rows share a key, **every** row of that key is skipped with reason `CLAVE_DUPLICADA` (keeping one would be arbitrary). Each
  colliding key is counted and listed in the report as a sample (AP-16).
- AP-14: Skipped rows are never written. Written rows are exactly the accepted rows; a count mismatch between accepted rows and the rows
  actually inserted rolls back the run with a Spanish error.
- AP-15: After the insert the job runs `ANALYZE` on the work table, inside the transaction, in both modes. Its failure rolls back the run.
- AP-16: Result report (built after the ANALYZE, returned in the job result):
  - totals: staging rows read, rows accepted, rows written (must equal accepted), rows repaired (AP-12), rows skipped;
  - skipped rows by reason (`skipped.byReason`: all seven reasons, zero counts included, so the UI can collapse them);
  - skipped rows by department name (`skipped.byDepartment`) and by locality name (`skipped.byLocality`), top 20 by count each;
  - `skipped.byLocalityAndReason`: groups by (department, locality, reason) with their counts, restricted to the two locality reasons
    (`LOCALIDAD_NO_ENCONTRADA`, `LOCALIDAD_AMBIGUA`) and capped at 20 per reason (`row_number() OVER (PARTITION BY skip_reason ORDER BY count DESC)`,
    PG11 compatible; no global LIMIT). It feeds the UI lists of localities not found and ambiguous with their padron counts (AP-32b);
  - up to 20 sample skipped rows (department, locality, padron, reason), and up to 20 colliding keys (AP-13);
  - step timings: elapsed ms per step, labelled as the planned steps of AP-23;
  - warnings in Spanish (for example: skipped rows present, repaired geometries present, rows of a colliding key present, dry run: work
    table not modified, outcome unknown).

## Run control

- AP-17: `dryRun` performs stage A, `ANALYZE`, the report, then `ROLLBACK`. The report carries `tempModified: false`. A real run performs the
  same, then `COMMIT`; `tempModified: true` is reported only when the commit succeeded. In both modes `padronModified` is `false`.
- AP-18: A real run needs `confirm: true` and the password again. It also needs the work table name typed again in the wizard (AP-31). The
  per-target lock is keyed on the work table: `host:port|db|workSchema|workTable` (host trimmed and lowercased, port normalised, as in
  AC-24 of Cargar padrones). A second run on the same work table answers `409`.
- AP-19: Any failure before `COMMIT` rolls back: the work table is left as it was before the run. A `COMMIT` that throws gives
  `outcomeUnknown: true`; the UI asks the user to verify the work table before retrying (as AC-21 of Cargar padrones).
- AP-20: The job runs in the background. `POST actualizar-padron/start` body = `{ connection, stagingSchema, stagingTable, workSchema,
  workTable, cartoSchema, padronTable, provinceTable, localityTable, typeTable?, options: { clearMode, localityType? }, dryRun, confirm }`.
  `stagingSchema` covers the staging table; `workSchema` covers the work table only; `cartoSchema` covers the padron, province, locality and
  type tables. `typeTable` is optional (omitted or empty = no type table). `options.localityType` (text) applies when
  `typeTable` is present: an absent (undefined) `localityType` defaults to `LOCALIDAD CATASTRAL`, a present blank (empty or whitespace-only)
  one is refused with `400`, and a non-blank one is trimmed. It is ignored when no type table is given. Validated (AP-1..AP-7b, booleans, enum values).
  Answers `200 { success, jobId }` at once. Errors: `400` for invalid body, repeated tables (AP-3), an unknown or ambiguous type (AP-7b) or
  an empty `localityType` with a type table, `400` for `confirm` missing on a real run, `409` with `Ya hay una actualización en curso para
  esta tabla.` when a job is RUNNING for the same work table.
- AP-21: `GET actualizar-padron/status?jobId=...` -> `200 { success, job }` with the fields of AC-25 of Cargar padrones (`jobId`, `state`,
  `step`, `current`, `total`, `dryRun`, `startedAt`, `finishedAt`, `result?`, `error?`, `outcomeUnknown?`). `400` without `jobId`,
  `404` for an unknown id. A `result` with `outcomeUnknown` is DONE with that flag.
- AP-22: `runActualizarPadron` takes injected dependencies (session, store, clock) and calls `onProgress({ label, current, total })` once per
  step in order, 1-based. A throwing `onProgress` never fails the run. The planned steps come from a pure function,
  `plannedStepLabels({ dryRun, clearMode })`, so the UI checklist shows the steps before the run starts; a dry run has no COMMIT step, a
  real run has it.
- AP-23: Planned steps (labels in Spanish): validar tablas y columnas (includes the type check of AP-7b), contar filas de staging, vaciar
  tabla de trabajo, resolver provincias y localidades, cargar tabla de trabajo (includes repairing and validating geometries, AP-12), analizar
  tabla de trabajo, generar informe, confirmar cambios (real run) or revertir (dry run).
- AP-24: Session: the real session reuses the settings of shp-replace (`statement_timeout`, `lock_timeout`, `client_encoding = 'UTF8'`,
  memory settings) as in AC-28 of Cargar padrones. `connect` errors are scrubbed of the password; `close()` never throws. The password never
  appears in logs, statuses, results or error messages.
- AP-25: Sample and payload caps (AP-14, AP-16, including the 20 groups per locality reason of `skipped.byLocalityAndReason`) hold for every report field, so the
  status payload stays bounded regardless of table size.

## Shared job store

- AP-26: The job store is a helper of the module, shared by both jobs: the `globalThis` singleton of AC-26 of Cargar padrones
  (`tryStart(tableKey, dryRun)` returns null while RUNNING for that key, `progress`, `finish`, `fail`, `get`, `sweep(maxAgeMs)` with
  finished jobs older than 1 h swept on the next start or status). The Cargar padrones job switches to the shared helper without behaviour
  change, and its tests keep passing. The lock is always released: a background throw marks the job FAILED.

## Client (UI)

Everything user-facing is Spanish; code is English; modular CSS, no inline styles, Lucide icons only.

- AP-27: Wizard (`ui/ActualizarPadronWizard.tsx`), five steps with `WizardOrchestrator`: (1) Conexión, (2) Tablas, (3) Opciones, (4) Revisar,
  (5) Resultado. The reducer is pure (`ui/actualizarPadronWizardState.ts`); `canContinue` requires: connection fields valid; the three schemas
  chosen; the required tables chosen, distinct and all valid (the type table is optional); when a type table is selected, a non-empty
  locality type; options valid; for a real run the typed work table name and password match.
  Changing the connection resets the schemas and table choices. Changing a schema resets only the table choices that live in that schema
  (`stagingSchema`: staging table; `workSchema`: work table; `cartoSchema`: padron, province, locality and type tables).
- AP-28: Connection step uses the shared saved-connection selector (`ProfileSelect` over `core/services/localStorageDbConfig.ts`), as the
  Cargar padrones step. Profiles are connection-only (host, port, database, user; never the password). The wizard does not store schemas,
  tables or options in profiles.
- AP-29: Tables step: three schema fields (staging schema, work schema, carto schema), then the `TableSelector` instances: staging table, work
  table, padron, province, locality, and an optional "Tabla de tipos de unidad" (may be left empty). Each shows the Spanish required-column
  status of AP-2 and AP-2b. A distinctness violation (AP-3) is shown in Spanish and blocks Siguiente.
- AP-30: Options step: clear mode `DELETE` / `TRUNCATE` with the privilege note of AP-8, and a "Tipo de localidad" text field (default
  `LOCALIDAD CATASTRAL`, domain value, not an identifier). The text field is shown only when a type table is selected and must not be empty
  (AP-7b). No tolerance, no repair toggle and no sequence option.
- AP-31: Review step: summary of the selected tables (the type table and the locality type only when a type table is selected) and the clear
  mode; "Analizar sin cargar" = dry run (password required); "Actualizar tabla de trabajo" = real run (password and the work table name typed
  again, plus a warning that the work table is overwritten and that `carto.padron` is not modified).
- AP-32: Result step: planned-step checklist (every planned step listed at once, done / current / pending, planned steps sent by the server in
  the job status, no raw `current / total` counter) and elapsed time from the run store while running; the report afterwards (AP-16), laid out
  as AP-32b. A dry run shows a banner that the work table was not modified. An `outcomeUnknown` result shows the verify-before-retry banner.
- AP-32b: Report layout (readability; the first real report was hard to read: long full-width label/value lists, tiny text, a very long
  department list):
  - summary header with four KPI cards: staging rows read, rows written, rows skipped, rows repaired; below them one banner: dry run ("Análisis:
    la tabla de trabajo no fue modificada") or real run done ("Tabla de trabajo actualizada");
  - skipped by reason: a compact table with one row per non-zero reason, a proportional bar and the percentage. Zero reasons are collapsed
    into one line ("Sin filas: n motivos") or hidden. Each shown reason has a one-line Spanish explanation of what it means and what to do;
  - skipped by department and by locality: compact two-column tables limited to the top 10, with a "Ver todo (n)" collapsible for the rest;
  - "Localidades no encontradas" (locality, department, padron count, top 20 from `skipped.byLocalityAndReason`) shown when
    `LOCALIDAD_NO_ENCONTRADA` > 0, and "Localidades ambiguas" likewise for `LOCALIDAD_AMBIGUA`;
  - samples and colliding keys in collapsible tables; step timings in a collapsible;
  - warnings and banners as in AP-32; consistent spacing scale, body text at least 14 px, nothing below 12 px, zebra rows in every table.
- AP-33: Run store (`ui/actualizarPadronRunStore.ts`) follows AC-29 of Cargar padrones: holds the active job id, polls status every 2 s
  (timer injected), stops on DONE/FAILED, survives in-app navigation, gives up only after consecutive poll failures span 60 s and then
  reports an unknown outcome with the job id; never keeps the password in its snapshot.
- AP-34: Report view-model (`ui/actualizarPadronReportView.ts`): pure and unit tested. It turns the result into display data: KPI values,
  the percentage per reason (share of the skipped rows, that is of the sum of `skipped.byReason`; 0 when nothing was skipped), the non-zero reasons sorted by count with their explanation, the
  top 10 lists per department and locality with a `rest` count (`n` minus 10 when positive), the localities-not-found and ambiguous
  aggregations taken from `skipped.byLocalityAndReason` (filtered by reason, sorted by count), samples, warnings and banners.
- AP-35: Dashboard: the routine-jobs job list (`RoutineJobsDashboard`) shows "Actualizar padrones de carto" next to "Cargar padrones"; both open
  their wizard. The module page (`/tools/m/routine-jobs`), the home card and the manifest need no new entry point.
- AP-36: Routes: `module.routes.json` declares the two new endpoints (`actualizar-padron/start`, `actualizar-padron/status`) and the new
  catalog roles (`actualizar-localidad-tipada` and `actualizar-tipo` included); the generated routes are regenerated with `npm run modules:routes`, never hand-edited;
  `npm run modules:routes:check` passes.

## Performance expectation

- The whole job is set-based SQL. No row-by-row loops, no per-row round trips.
- PostgreSQL 11 materializes every CTE, so the classification chain must run as few times as possible: `ST_IsValid` is computed once per
  staging row; the populate is one statement; the report is ONE statement over one chain (totals plus the bounded top lists, the
  locality-and-reason groups, samples and colliding keys) that carries no geometry columns; there is no separate "accepted count" chain: the
  written count is compared with `rowsRead - skipped` of the report (same snapshot, AP-8).
- Stage A: one `INSERT ... SELECT` from the staging table with hash joins to the province and locality tables (both small). The type id of
  AP-7b is resolved once and applied as an equality on the locality join; no subquery per row.
  `ST_MakeValid` runs only on invalid rows (`CASE`), and `ST_Transform` only on rows whose SRID differs from the target, so valid
  geometries cost one check each.
- The job requires no index on the work table or on the padron table. It runs `ANALYZE` on the work table after populate (AP-15). The padron
  table is read only for catalog metadata, so no index is needed on it.
- No hard time budget is set yet. The report returns elapsed ms per step (AP-16) so real dev runs produce the figures for the next spec.

## Out of scope

- Comparison of the work table with `carto.padron` (NEW, MISSING, CHANGED, AMBIGUOUS, Hausdorff distances, histograms, per-department
  comparison counts, comparison samples). Done manually by the user and the assistant with queries on dev, not by this job.
- Stage C: inserting new rows into `carto.padron`, updating geometry in place, reporting the new ids, and never touching missing rows.
  FUTURE: specified after the manual comparison.
- Any write to `carto.padron`, its sequence, or any table other than the work table.
- Creating or dropping the work table, provinces or localities. Creating missing localities (for example `ALFREDO MONES QUINTELA`) is NOT
  done by this job; the user will decide whether a separate "Cargar localidades" job is needed. Rows of such localities stay skipped
  (`LOCALIDAD_NO_ENCONTRADA`) and are listed in the report (AP-32b).
- Tolerance option, repair toggle, sequence reset options, wiki page for this job, preprod/prod runs, index creation.

## Open questions / assumptions

1. Work table DDL is owned by the user: the job does not create it. It is a regular table in the work schema (not `pg_temp`), so the wizard
   can list it. The user drops or empties it when done.
2. Privileges: SELECT on the province, locality and (when selected) type tables in `cartoSchema`; the catalog metadata of the padron table
   (column default and typmod) readable by the connecting role, with no row read; SELECT, INSERT, DELETE (and TRUNCATE when chosen) plus
   ANALYZE on the work table; SELECT on the staging table. The job checks the work-table privileges before BEGIN; read privileges on the
   others are assumed and fail with a database error if missing.
3. The locality table links to the province through a column named `id_province`, and the type filter assumes a column `id_territorial_unit_type` on the
   locality table (assumed; verify both on dev before the first run, `carto.territorial_unit` included).
4. Name matching is `upper()` on both sides, with no accent or whitespace normalisation. Accent mismatches appear as skipped rows with
   samples; an accent-insensitive match is a later decision.
5. `statement_timeout` for the populate statements on the staging volume is taken from shp-replace settings; it is to be measured on dev.
6. Stage C design (insert policy for NEW, in-place geometry update for CHANGED, handling of MISSING and AMBIGUOUS) is deliberately left open
   until the manual comparison has been done on dev.
7. Whether a separate "Cargar localidades" job is needed for localities missing from the locality table (see Out of scope) is the user's
   decision; this spec does not create them.

## Acceptance criteria count

AP-1 to AP-36 plus AP-2b, AP-7b, AP-10b and AP-32b (40 criteria).
