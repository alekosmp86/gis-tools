# Routine Jobs — "Actualizar padrones de carto": acceptance criteria

Stage 5 of the monthly carto update job (`ROUTINE_JOBS_MONTHLY_CARTO_UPDATE_SPEC.md`) in the `routine-jobs` module (`src/modules/routine-jobs/`).
Stage id `actualizar-padron`, Spanish name "Actualizar padrones". It reuses the conventions of the other stages: one wizard per stage, hub
connection, `TableSelector`, shared job store, per-target lock, planned-step checklist, Spanish messages, scrubbed passwords, shared report
components and CSV download. Acceptance criteria ids use the prefix `AP-`. Numbers of criteria that still apply are kept; `AP-8` is removed;
criteria added by the in-place design are `AP-37` and up.

## Context

- `carto.padron.id` is a stable identifier. It feeds the URNs `cgeo:padron:id:<id>` (addresses_master) and `access_point.id_padron` /
  `addresses_2_0_edit.id_padron`, which have no foreign keys. **Existing ids never change** (MJ-13).
- The staging table (`bdj_carto.catastro_paispadron_stg` in dev, a schema other than `carto`) is refreshed monthly by stage 1.
- This stage applies the staging padrones **in place** to one destination table chosen by the user:
  - a padron with no destination row of its key is inserted, and its id comes from the destination sequence;
  - a padron whose geometry moved beyond the tolerance gets its geometry updated, and only the geometry;
  - nothing else is written. Nothing is deleted, truncated, re-inserted or renumbered. Destination rows that the staging table no longer
    carries are counted and listed, never touched.
- The destination can be a scratch table (for example `carto.padron_tmp_actualizacion`) or `carto.padron` itself. Both are safe because the
  stage never removes or renumbers rows. Applying to `carto.padron` is the user's decision after the dry run.
- Dev finding (first real dry run): the locality table the user selects is `carto.territorial_unit` (`padron.id_cadastral_locality` points at
  it), which holds 8 unit types. 337 of 496 `LOCALIDAD CATASTRAL` names are shared with another unit type in the same province, so name-only
  resolution made 914,709 urban rows `LOCALIDAD_AMBIGUA`. The optional unit-type table and the locality type filter (AP-2b, AP-7b, AP-10,
  AP-10b) resolve this.

Precondition: the staging table has been loaded by stage 1 (`unidadcat`, `nomdepto`, `nomloccat`, `padron`, `geom` present).

Nothing in the module names a schema, table or column as a literal in SQL or API defaults. Table and schema names come from the user's
selection; column names come from the job's declared logical columns and are resolved against the catalog. String VALUES that are domain
data (`RURAL`, `URBANO`, `LOCALIDAD CATASTRAL`) are not identifiers; they are passed as bound parameters or literals.

## Layering (module_authoring.md)

- `src/core/`: `TableCatalogService` and its types are reused as they are.
- `src/ui-kit/`: `TableSelector` (with its optional `hint` line) and `ProfileSelect` are reused.
- `src/modules/routine-jobs/`: the job folder `jobs/actualizar-padron/`, the shared helpers in `jobs/shared/` (table resolution, destination
  preflight, geometry comparison, sequence repair, transaction, limits), the routes in `module.routes.json`, the wizard under `ui/`.
- The padron job and stage 3 (`unidad-territorial`) use the same shared helpers. The CSV list writer (`listCsvOf`) is shared by the stages
  that write change lists.

## Destination table (user-owned)

The user creates the destination table in `cartoSchema`, with any name. The job never creates, alters or drops it. Logical columns:

| Logical column | Type | Rule |
|---|---|---|
| `id` | integer | Filled only by the sequence default on insert. Never in an INSERT list or an UPDATE (AP-46). |
| `number` | varchar (up to 10) | Written by insert. Part of the key. |
| `type_padron` | varchar (up to 30) | Written by insert (`RURAL` / `URBANO`). Part of the key. |
| `id_cadastral_locality` | integer, nullable | Written by insert; NULL for rural. Part of the key. |
| `id_province` | integer | Written by insert. Part of the key. |
| `geometry` | geometry (MultiPolygon, metric SRID) | Written by insert; updated in place for changed geometries (AP-44). |

`id_address_master` and every other column keep their defaults (NULL on insert).

## Schemas

The wizard and the request carry two schema fields:
- `stagingSchema`: the schema of the staging table.
- `cartoSchema`: the schema of the destination, province, locality and (optional) unit-type tables (`carto` in dev).

## Catalog and table selection

- AP-1: `POST catalog/columns` accepts six roles: `actualizar-staging`, `actualizar-destino`, `actualizar-provincia`, `actualizar-localidad`,
  `actualizar-localidad-tipada` (the locality table read with `id_territorial_unit_type`, used only when a type table is selected) and
  `actualizar-tipo` (the unit-type table, optional). The required logical columns of each role come from the job constants. An unknown role
  answers `400 { success:false, error }` in Spanish. The role `actualizar-padron` of the previous version is removed.
- AP-2: Required logical columns per role, resolved with the catalog rules of the Cargar padrones spec (AC-2 tiers, generic `geom` exception):
  - staging: `unidadcat`, `nomdepto`, `nomloccat`, `padron`, `geom`;
  - destination: `id`, `number`, `type_padron`, `id_cadastral_locality`, `id_province`, `geometry`;
  - province (`cartoSchema`): `id`, `name`;
  - locality (`cartoSchema`): `id`, `name`, `id_province`, plus `id_territorial_unit_type` when a type table is selected (AP-2b);
  - type (optional, `cartoSchema`): `id`, `name`. Never required.
- AP-2b: When a type table is selected, the locality table is checked under `actualizar-localidad-tipada`, which additionally requires
  `id_territorial_unit_type`. A missing or ambiguous column is reported by AP-4 and the run cannot start. Without a type table,
  `id_territorial_unit_type` is neither required nor read.
- AP-3: The selected tables must be distinct as `schema.table`: staging, and the destination, province, locality and type tables in
  `cartoSchema`. Four distinct tables without a type table, five with one. A repetition answers `400` in Spanish naming the two tables; the
  lock is not taken and no query writes.
- AP-4: `POST actualizar-padron/start` (and the wizard's Tables step) report missing or ambiguous required columns of each selected role in
  Spanish. A selection with unresolved required columns cannot be started.

## Preflight (before BEGIN; no write)

- AP-5: Destination checks, all in Spanish, all refusing before any write:
  - the destination is a regular or partitioned table without inheritance (children or parent), triggers or rewrite rules (`relkind` `r`
    or `p`); a view, materialized view or foreign table is refused;
  - the destination has a sequence for `id` (serial, identity or a `nextval` default). The sequence is resolved with
    `pg_get_serial_sequence` or from the default, never named in code. Without one the run is refused, because inserts need ids;
  - no column outside the written logical columns may be NOT NULL without default (`id` included; an identity column counts as having a
    default);
  - the connecting role has INSERT, UPDATE and SELECT on the destination and UPDATE on its sequence. No DELETE or TRUNCATE privilege is
    requested, because neither is used.
- AP-6: Staging checks: the staging geometry column is a polygon type (Polygon, MultiPolygon or generic GEOMETRY); the staging `padron` column
  has a numeric data type; the staging table has at least one row; every staging geometry SRID exists in `spatial_ref_sys` (a geometry with
  SRID 0 or an unknown SRID refuses the run).
- AP-50: Destination key format (in the target check, before BEGIN, in dry run and real run alike): every row of the destination must have
  the key the stage generates, or the run is refused, so it never inserts a padron stored under another spelling of its key. One read-only
  query counts the rows that break any of: (a) `type_padron` is not exactly `RURAL` or `URBANO` (NULL included); (b) a `RURAL` row has a
  non-NULL `id_cadastral_locality`; (c) `number` is NULL or does not match `^(0|[1-9][0-9]*)$` (`0` is valid). The refusal is one Spanish
  message naming the count and one example row (`id`, `type_padron`, `id_cadastral_locality`, `number`). When the `number` column is not a
  text type (`text`, `character varying`, `character`), the refusal names the column and its type, and check (c) is not run.
- AP-7: The target SRID is read from the typmod of the destination geometry column (`geometry(MultiPolygon, <srid>)`). A generic (typmod 0)
  column refuses the run. The SRID must be metric, because the tolerance and the Hausdorff distance are in metres (the rule of stage 3).
- AP-7b: Locality type check (only when a type table is selected; before BEGIN): the type table must contain exactly one row where
  `upper(name) = upper(localityType)`. Zero or more than one refuses the run in Spanish, naming the type and the table. The id of that row is
  used as an equality on the locality join (AP-10). An absent `localityType` defaults to `LOCALIDAD CATASTRAL`; a blank one answers `400` at
  parse time (AP-20).

## Candidates (staging rows)

- AP-9: Province resolution: the province row where `upper(nomdepto) = upper(name)`. Zero matches -> skipped `PROVINCIA_NO_ENCONTRADA`; more
  than one -> `PROVINCIA_AMBIGUA`. The job never creates provinces.
- AP-10: Locality resolution (URBANO rows only): the locality row where `id_province` equals the province id and `upper(nomloccat) =
  upper(name)`. When a type table is selected, only locality rows whose `id_territorial_unit_type` equals the id of AP-7b count. Zero matches
  -> `LOCALIDAD_NO_ENCONTRADA`; more than one -> `LOCALIDAD_AMBIGUA`. RURAL rows never look up a locality and get `id_cadastral_locality`
  NULL. The job never creates localities.
- AP-10b: Without a type table, every locality row is a candidate. With a type table, locality rows whose `id_territorial_unit_type` is NULL
  never match.
- AP-11: Values: `number` = `trunc(padron)::text`; `type_padron` = `unidadcat`. A NULL `padron`, a NULL `unidadcat`, a `unidadcat` other than
  `RURAL` / `URBANO`, a NULL `nomdepto`, or an URBANO row with a NULL `nomloccat` -> skipped `CLAVE_NULA`. A `number` that does not fit the
  destination column rolls back the run with a Spanish error.
- AP-12: Geometry: a NULL or empty geometry -> skipped `SIN_GEOMETRIA`. An invalid geometry is repaired with `ST_MakeValid`, keeping only the
  polygonal part (`ST_CollectionExtract(..., 3)`), then `ST_Multi`; a repair that leaves nothing -> `SIN_GEOMETRIA`. A valid geometry that is
  not Polygon or MultiPolygon goes through the same polygonal extraction. A geometry with another SRID is transformed with `ST_Transform`.
  The candidate geometry is 2D and `ST_Multi`. Repair always runs; repaired rows are counted in the report (AP-16).
- AP-13: Natural-key collisions: after resolution the key of a row is `(type_padron, id_province, id_cadastral_locality, number)`, where two
  NULL localities are the same key. When several staging rows share a key, **every** row of that key is skipped with `CLAVE_DUPLICADA`.
  Each colliding key is counted and listed (AP-16).
- AP-14: Only accepted rows (candidates) are classified and written. Skipped rows are never candidates, never inserted and never update a
  destination row.

## Run control

- AP-15: After the apply, the job runs `ANALYZE` on the destination, inside the transaction, in both modes. Its failure rolls back the run.
- AP-16: Result report (built after the ANALYZE, returned in the job result):
  - totals: staging rows read, candidates (accepted rows), rows repaired (AP-12), rows skipped;
  - skipped rows by reason (`skipped.byReason`: all seven reasons, zero counts included);
  - skipped rows by department name and by locality name, top 20 by count each;
  - `skipped.byLocalityAndReason`: groups by (department, locality, reason), restricted to the two locality reasons and capped at 20 per
    reason (PG11 compatible; no global LIMIT). It feeds the UI lists of localities not found and ambiguous (AP-32b);
  - up to 20 sample skipped rows, and up to 20 colliding keys (AP-13);
  - the target report of AP-37 to AP-45 (inserted rows, geometry changes, missing and ambiguous samples, counts);
  - step timings: elapsed ms per step, labelled as the planned steps of AP-23;
  - warnings in Spanish (AP-40 to AP-45, skipped rows, repaired geometries, colliding keys, dry run, outcome unknown).
- AP-17: `dryRun` performs the whole stage, then `ROLLBACK`. The report carries `targetModified: false`. A real run performs the same, then
  `COMMIT`; `targetModified: true` is reported only when the commit succeeded. The rollback undoes the rows only: `nextval` (the inserts)
  and `setval` (AP-47) are not transactional, so a dry run leaves the destination id sequence advanced and the ids of the next real run
  show gaps (as CU-10a of Completar unidades territoriales).
- AP-18: A real run needs `confirm: true` and the password again. It also needs the destination table name typed again in the wizard (AP-31).
  The per-target lock is keyed on the destination: `host:port|db|cartoSchema|targetTable` (host trimmed and lowercased, port normalised, as in
  AC-24 of Cargar padrones). A second run on the same destination answers `409`.
- AP-19: Any failure before `COMMIT` rolls back: the destination is left as it was before the run. A `COMMIT` that throws gives
  `outcomeUnknown: true`; the UI asks the user to verify the destination table before retrying (as AC-21 of Cargar padrones).
- AP-20: The job runs in the background. `POST actualizar-padron/start` body = `{ connection, stagingSchema, stagingTable, cartoSchema,
  targetTable, provinceTable, localityTable, typeTable?, options: { tolerance, updateGeometries, localityType? }, dryRun, confirm }`.
  `stagingSchema` covers the staging table; `cartoSchema` covers the destination, province, locality and type tables. `typeTable` is optional
  (omitted or empty = no type table). `options.localityType` applies only when `typeTable` is present: an absent value defaults to
  `LOCALIDAD CATASTRAL`, a present blank value is refused with `400`, and a non-blank one is trimmed. `options.tolerance` is a number greater
  than or equal to 0 (`400` otherwise, AP-40). `options.updateGeometries` is a boolean. Answers `200 { success, jobId }` at once. Errors: `400`
  for an invalid body, repeated tables (AP-3), an unknown or ambiguous type (AP-7b), a blank `localityType` with a type table, a missing
  `confirm` on a real run; `409` with `Ya hay una actualización en curso para esta tabla.` when a job is running for the same destination.
- AP-21: `GET actualizar-padron/status?jobId=...` -> `200 { success, job }` with the fields of AC-25 of Cargar padrones (`jobId`, `state`,
  `step`, `current`, `total`, `dryRun`, `startedAt`, `finishedAt`, `result?`, `error?`, `outcomeUnknown?`). `400` without `jobId`, `404` for
  an unknown id. A `result` with `outcomeUnknown` is DONE with that flag.
- AP-22: `runActualizarPadron` takes injected dependencies (session, clock) and calls `onProgress({ label, current, total })` once per step, in
  order, 1-based. A throwing `onProgress` never fails the run. The planned steps come from the pure function `plannedStepLabels({ dryRun })`, so
  the UI checklist shows them before the run starts. A dry run has no COMMIT step; a real run has it.
- AP-23: Planned steps (labels in Spanish): validar tablas y columnas (includes the type check of AP-7b), validar tabla de destino (structure,
  privileges, sequence), contar filas de staging, resolver provincias y localidades (candidates and the skip report), clasificar padrones,
  ajustar secuencias de destino, aplicar cambios de padrones, analizar tabla de destino, generar informe, then confirmar cambios (real run) or
  revertir cambios de la simulación (dry run).
- AP-24: Session: the real session reuses the settings of shp-replace (`statement_timeout`, `lock_timeout`, `client_encoding = 'UTF8'`,
  memory settings) as in AC-28 of Cargar padrones. `connect` errors are scrubbed of the password; `close()` never throws. The password never
  appears in logs, statuses, results or error messages.
- AP-25: Sample and payload caps hold for every report field, so the status payload stays bounded whatever the table size: samples (skipped,
  missing, ambiguous) and colliding keys at `SAMPLE_LIMIT` (20); skipped groups at 20; locality-and-reason groups at 20 per reason; the
  inserted list and the geometry change list at `DETAIL_LIST_LIMIT` (500).
- AP-26: The job store is the shared helper of the module (AC-26 of Cargar padrones): namespace `actualizar-padron`, `tryStart` per destination
  key, `progress`, `finish`, `fail`, `get`, `sweep`. The lock is always released; a background throw marks the job FAILED.

## Classification and apply (in place)

- AP-37: A candidate matches the destination rows with the same key `(type_padron, id_province, id_cadastral_locality, number)`. The
  locality equality is NULL-safe (a rural row has no locality). The match is by key only: names never take part.
- AP-38: Every candidate gets exactly one class, and every destination row with no candidate gets `MISSING`:
  - `NEW`: no destination row has the key;
  - `AMBIGUOUS`: two or more destination rows have the key;
  - `UNCHANGED`: one destination row whose geometry is equal after snapping to 0.001 m and normalising;
  - `WITHIN_TOLERANCE`: one destination row, geometries differ, Hausdorff distance <= tolerance (AP-40);
  - `CHANGED`: one destination row, Hausdorff distance > tolerance;
  - `MISSING` (destination rows only): the key has no candidate.
- AP-39: The geometry comparison is cheap first: an equality test on the snapped and normalised geometries; the Hausdorff distance is computed
  only for candidates whose geometries differ and whose destination row exists. The area ratio (symmetric difference over union) is computed
  only for the listed geometry changes.
- AP-40: Tolerance option `Tolerancia (m)`: a number greater than or equal to 0, default 1.0, in metres. The request validates it as stage 3
  does (`readTolerance`). The wizard blocks Siguiente on an invalid value.
- AP-41: `MISSING` rows are only counted and sampled (up to 20, ordered by province and number). They are never deleted, updated or renumbered.
  A key that exists in staging only as a skipped row (AP-12, AP-13) has no candidate and so counts as `MISSING`; the skip reasons of the report
  show why.
- AP-42: `NEW` candidates are inserted with the list `(type_padron, id_cadastral_locality, id_province, number, geometry)`. The id comes from
  the destination sequence (its `nextval` default). The insert order is deterministic (`id_province`, `number`, `type_padron`,
  `id_cadastral_locality`). `id_address_master` stays NULL.
- AP-43: `UNCHANGED` and `WITHIN_TOLERANCE` candidates: nothing is written.
- AP-44: `CHANGED` candidates: an UPDATE of the `geometry` column only, and only when `Actualizar geometrías` is on. When it is off, the changes
  are counted and listed as detected, not applied (`Geometría detectada (no aplicada)`).
- AP-45: `AMBIGUOUS` candidates: untouched and reported (count and up to 20 samples). The stage never guesses which destination row is right.
- AP-46: The only writes of the stage are the INSERT of AP-42 and the UPDATE of AP-44. No statement writes `id`, `id_address_master` or any
  other column, and the stage issues no DELETE and no TRUNCATE (a unit test greps the stage's SQL for both).
- AP-47: The sequence repair (`Ajustar secuencias de destino`) runs after the classification and before the insert, in the same transaction:
  `setval` to the maximum id plus one, or to the current sequence position when that is higher. Its privilege is checked by AP-5.
- AP-48: Count checks roll back the whole transaction on mismatch, with a Spanish error: inserted rows equal the `NEW` count; updated rows equal
  the `CHANGED` count when `Actualizar geometrías` is on (zero otherwise).

## Shared job store

- AP-26 (above) is the only store criterion; the Cargar padrones job uses the same helper without behaviour change.

## Client (UI)

Everything user-facing is Spanish; code is English; modular CSS, no inline styles, Lucide icons only.

- AP-27: Wizard (`ui/ActualizarPadronWizard.tsx`), five steps with `WizardOrchestrator`: (1) Conexión, (2) Tablas, (3) Opciones, (4) Revisar,
  (5) Resultado. The reducer is pure (`ui/actualizarPadronWizardState.ts`). `canContinue` requires: connection fields valid; the two schemas
  chosen; the required tables chosen, distinct and valid (the type table is optional); when a type table is selected, a non-blank locality
  type; a valid tolerance; for a real run, the typed destination table name and the password match. Changing the connection resets the schemas
  and table choices. Changing a schema resets only the table choices that live in that schema (`stagingSchema`: staging table; `cartoSchema`:
  destination, province, locality and type tables).
- AP-28: Connection step uses the shared saved-connection selector (`ProfileSelect` over `core/services/localStorageDbConfig.ts`), as the
  Cargar padrones step. Profiles are connection-only (host, port, database, user; never the password). The wizard does not store schemas,
  tables or options in profiles.
- AP-29: Tables step: two schema fields (staging schema, carto schema), then the `TableSelector` instances: "Tabla de origen" (staging),
  "Tabla de destino" (the table that receives the data), "Tabla de provincias", "Tabla de localidades", and "Tabla de tipos de unidad
  (opcional)". There is no padron selector. The Tables step also holds the link option of AP-51 (a checkbox, off by default) and, only when it is on, the "Tabla de direcciones maestras" selector of AP-53. The destination shows the hint that it receives inserts and geometry updates, that it never loses
  rows and never changes ids, and that a scratch table such as `padron_tmp_actualizacion` is the way to test. Each selector shows the
  Spanish required-column status of AP-2 and AP-2b. A distinctness violation (AP-3) is shown in Spanish and blocks Siguiente.
- AP-30: Options step: a "Tipo de localidad" text field (default `LOCALIDAD CATASTRAL`, a domain value, not an identifier), shown only when a
  type table is selected and not empty (AP-7b). `Tolerancia (m)` (default `1,0`, same validation and hint as stage 3) and `Actualizar
  geometrías` (default on, with the warning that it replaces the destination geometry by the cadastre polygon, and the hint that inserts are
  applied either way). No clear mode, no repair toggle and no sequence option.
- AP-31: Review step: summary of the selected tables (the type table and the locality type only when a type table is selected), the tolerance
  and the geometry option. The info line "Inserta los padrones nuevos y actualiza la geometría de los existentes. Nunca borra filas ni cambia
  ids." is always shown. When `Actualizar geometrías` is on, the overwrite warning is shown. "Analizar sin cargar" = dry run (password required).
  "Actualizar padrones" = real run (password and destination table name typed again). With the link option on, the review also shows
  the option and the address master table, and the warning of AP-59 when the destination is not named `padron`.
- AP-32: Result step: planned-step checklist (every planned step listed at once, done / current / pending, planned steps sent by the server in
  the job status), elapsed time from the run store while running; the report afterwards (AP-16), laid out as AP-32b. A dry run shows the
  banner that the destination was not modified. An `outcomeUnknown` result shows the verify-before-retry banner.
- AP-32b: Report layout:
  - a KPI row: rows read, candidates, skipped, inserted, updated, geometry changes; below it the outcome banner (dry run "Análisis: la tabla de
    destino no fue modificada", or confirmed "Actualización confirmada: la tabla de destino fue modificada", or unknown);
  - skipped by reason: a compact table with one row per non-zero reason, a proportional bar and the percentage; zero reasons collapsed into
    one line ("Sin filas: n motivos"). Each shown reason has a one-line Spanish explanation;
  - the target section (destination table name): counts "Insertadas", "Actualizadas", "Geometrías que cambian", "Sin cambios", "Sin cambios
    dentro de tolerancia", "Faltantes en destino", "Ambiguas", a note when geometry changes were detected but not applied, and collapsible
    lists (inserted, geometry changes, missing, ambiguous) whose summary says "primeras N de M" when cut;
  - skipped by department and by locality: top 10 with "Ver todo (n)" for the rest;
  - "Localidades no encontradas" and "Localidades ambiguas" (AP-16), shown when non-empty;
  - skipped samples and colliding keys in collapsible tables; step timings in a collapsible;
  - warnings as a list; body text at least 14 px, nothing below 12 px, zebra rows in every table.
- AP-33: Run store (`ui/actualizarPadronRunStore.ts`) follows AC-29 of Cargar padrones: holds the active job id, polls status every 2 s (timer
  injected), stops on DONE/FAILED, survives in-app navigation, gives up only after consecutive poll failures span 60 s and then reports an
  unknown outcome with the job id; never keeps the password in its snapshot. Its plan is `{ dryRun, destinationTable }`.
- AP-34: Report view-model (`ui/actualizarPadronReportView.ts`): pure and unit tested. It turns the result into display data: KPI values, the
  percentage per reason (share of the skipped rows; 0 when nothing was skipped), the non-zero reasons sorted by count, the top 10 lists per
  department and locality with a `rest` count, the localities-not-found and ambiguous aggregations from `skipped.byLocalityAndReason`, the
  target counts and lists with their summaries, samples, warnings (without the dry-run and unknown-outcome texts, which are banners) and banners.
- AP-35: Dashboard: the routine-jobs job list shows "Actualizar padrones" as stage 5 of the monthly update; its wizard opens from there. The module
  page, the home card and the manifest need no new entry point.
- AP-36: Routes: `module.routes.json` declares the two endpoints (`actualizar-padron/start`, `actualizar-padron/status`) and the catalog roles
  travel with `catalog/columns`. The generated routes are regenerated with `npm run modules:routes`, never hand-edited; `npm run
  modules:routes:check` passes.

- AP-62: The table pickers prefill from `config/monthlyTables.ts`: staging = stage 1 staging (else `bdj_carto.paispadron`), target `carto.padron`, province `carto.province`, locality `carto.territorial_unit`, type `carto.territorial_unit_type`; the address master stays empty until the link option is on. The locality picker shows the hint that the locality table must be `territorial_unit`, because padron rows store unit ids.

## Change list (CSV)

- AP-49: "Descargar CSV" exports the database changes only, as a flat table with the header
  `Tabla,Cambio,Tipo,Provincia,Localidad,Padrón,Distancia (m),Relación de área,Id`. The `Id` column is empty for the rows below; only the
  AP-58 rows fill it, so the ids of inserted padrones are still not exported. One row per inserted padron (`Insertada`) and one per
  geometry change (`Geometría modificada` when applied, `Geometría detectada (no aplicada)` when not). The rows are ordered by kind, then
  department (Provincia), locality (Localidad), padrón. `Provincia` and `Localidad` are the staging names, empty cells are "sin dato". The
  formula guard and the escaping of the shared CSV helper apply. When a list is cut at its cap (the real count is greater than the list length)
  the CSV ends with one marker row per cut list (MJ-14): Tabla = destination table, Cambio = `Lista incompleta: se muestran las primeras 500 de N
  padrones insertados` or `... de N geometrías que cambian`, other cells empty. The filename follows the convention of the other stages with the
  slug `actualizar-padron`.

## Inconsistencies list (CSV)

- AP-61: "Descargar inconsistencias" appears only when the report has skipped rows (`skipped.skippedRows` non-empty) and exports the skipped
  staging rows, not database changes: a flat table with the header `Motivo,Departamento,Localidad,Padrón`, one row per skipped row. `Motivo`
  is the Spanish label of the skip reason (the same labels as the report), `Departamento`, `Localidad` and `Padrón` are the staging values
  (empty cells are "sin dato"). The rows come from the report SQL, capped at `DETAIL_LIST_LIMIT` (500), ordered by skip reason, department,
  locality and padrón. The total comes from the counts. When the list is cut, the CSV ends with one marker row: the `Lista incompleta: se
  muestran las primeras 500 de N filas omitidas` text in the second cell, the other cells empty. The formula guard and the escaping of the
  shared CSV helper apply. The filename is `carto-actualizar-padron-<simulacion|real>-inconsistencias-<stamp>.csv`. The 20-sample table of
  the report is unchanged, and the database-changes CSV (AP-49) does not change.

## Address master links (option)

The padrones this stage inserts have no address master record (`id_address_master` is NULL). The option below links them, in the same
transaction. The rules are the legacy `addressMaster.sql` PADRON block (URN `cgeo:padron:id:<id>`, insert with latitude and longitude 0,
link where NULL), with the MJ-13 invariants: exact URN equality (never `SPLIT_PART`), no id is written, no DELETE or TRUNCATE. The SQL is the
shared one of `jobs/shared/addressMasterLink*` that stage 4 also uses, so both stages apply the same rules.

- AP-51: Option `Enlazar direcciones maestras de los padrones` (`options.linkAddressMaster`, a boolean parsed strictly, as the other boolean
  options; the wizard sends it, default off). Off: the stage behaves exactly as above, and the request carries no `addressMasterTable`. On:
  the request must carry `addressMasterTable` (in the carto schema, distinct from the destination, province, locality and type tables) and
  the stage links the destination padrones to their address master records as AP-52 describes.
- AP-52: The linking pass runs inside the same `REPEATABLE READ` transaction, after the upsert of AP-42 and AP-44 and its count check
  (AP-48), before ANALYZE. Candidates: every destination row with `id_address_master IS NULL`, that is the rows just inserted and any older
  row still unlinked. Each candidate's URN is `cgeo:padron:id:` followed by its id, matched by exact equality. No record with that URN: a
  new record `(urn, latitud, longitud) = (urn, 0, 0)`, ordered by padron id, its id from the table sequence. Exactly one record: only
  linked. Two or more: AMBIGUOUS, neither created nor linked, reported (count and up to 20 samples). The only write is `UPDATE <destination>
  SET id_address_master = ... WHERE id_address_master IS NULL`; the address master table receives only `urn`, `latitud` and `longitud`.
- AP-53: Preflight, before BEGIN and refusing with Spanish messages like AP-5, when the option is on: the address master table is a
  regular or partitioned table without inheritance, triggers or rules; the user has SELECT and INSERT on it and UPDATE on its sequence; its
  `addresses_master_id` has a sequence and `urn`, `latitud` and `longitud` resolve. The destination resolves `id` and `id_address_master`
  (the latter only when the option is on); a missing column is named in the block.
- AP-54: The address master sequence is repaired (`Ajustar secuencia de direcciones maestras`) once, before the first address master
  insert of the transaction, after the destination's own repair (AP-47). The lock key set of the run includes the address master table when
  the option is on, so the lock prevents another stage-5 run on the same tables. The job stores are per stage, so a stage-4 run and a
  stage-5 run on `addresses_master` do not block each other. That is harmless: the URN prefixes differ and the sequence repair never
  lowers the sequence.
- AP-55: Count checks roll back the whole transaction on mismatch, in Spanish: records created equal the classification's `toCreate`
  ("Los registros de dirección maestra creados para padrones (X) no coinciden con los esperados (Y) en T."); padrones linked equal
  `toCreate + alreadyHadRecord` ("Los padrones enlazados (X) no coinciden con los esperados (Y) en T."); padrones still without address
  master after the link equal the ambiguous count ("Los padrones sin dirección maestra después del enlace (X) no coinciden con los
  ambiguos (Y) en T.").
- AP-56: A dry run rolls back both passes; the report says the destination was not modified. A real run commits both or neither. The
  result carries the address master section only when the option is on (AP-57).
- AP-57: Result section `addressMaster` (present only when the option is on): counts (padrones sin dirección maestra, registros por crear,
  registros creados, padrones enlazados, ya tenían registro, ambiguos, sin dirección maestra después del enlace), the linked list (up to
  `DETAIL_LIST_LIMIT`, with id, address master id and created or existing), and the ambiguous samples (up to `SAMPLE_LIMIT`). The report
  shows it as a section of its own after the destination section, with the list cut markers of AP-58.
- AP-58: The stage CSV (AP-49) appends, when the option is on, one row `Dirección maestra creada para padrón` (Tabla = address master table,
  Id = padron id) per created record and one row `Padrón enlazado` (Tabla = destination table, Id = padron id) per linked padron. A cut list
  gets its marker (MJ-14) for the created and for the linked lists. No metadata rows.
- AP-59: Safety warning: when the option is on and the destination table name is not `padron`, the review step shows a visible warning,
  in Spanish: "La tabla de destino no es «padron»: se crearán direcciones maestras reales para los ids de esa tabla." It does not block
  the run; the typed confirmation of AP-18 is unchanged.
- AP-60: Legacy script rules, noted for review: the link never renumbers, never deletes, never writes the address master id, and never
  overwrites a non-null `id_address_master`. A second run finds nothing to link except the ambiguous padrones.

## Performance expectation

- The whole stage is set-based SQL. No row-by-row loops, no per-row round trips.
- PostgreSQL 11 materialises every CTE. The candidate chain runs once per statement: once for the classification and once inside the apply
  statement, so that the write is a single data-modifying statement (as in stage 3). `ST_IsValid` is computed once per staging row inside the
  chain. `ST_MakeValid` runs only on invalid rows and `ST_Transform` only on rows whose SRID differs from the target.
- Keys are matched by hash joins on `(type_padron, id_province, number)` plus the NULL-safe locality. The geometry comparison is cheap first
  (AP-39).
- **The first real dry run on dev must measure it**: about 1.3 million staging rows, and a first run into an empty destination inserts about
  1.2 million rows (the CSV is then capped and the marker line matters). Record the elapsed ms per step (AP-16) and the database time. No index is
  created by the job; an index on the destination key would speed the joins, and is a decision for the DBA after the measurement.
- No hard time budget is set yet.

## Out of scope

- Deleting, truncating, re-inserting or renumbering destination rows. Missing rows are counted and listed only (AP-41).
- Comparison histograms and per-department comparison counts. The user and the assistant compare by hand with queries on dev.
- Creating or dropping the destination table, provinces or localities. Creating missing localities is a separate decision (see the monthly spec).
- Accent-insensitive name matching, repair toggles, sequence reset options, preprod/prod runs, index creation, wiki pages beyond the user guide.

## Open questions / assumptions

1. Decision: stage 6 "Aplicar padrones" of the monthly spec is removed. Stage 5 inserts and updates in place in the chosen destination table
   (a test table first, then `carto.padron`), so no separate apply stage is needed.
2. A key present in staging only as a skipped row (`SIN_GEOMETRIA`, `CLAVE_DUPLICADA`) counts as `MISSING` in the destination, because
   `MISSING` is defined on accepted candidates. Confirm this reading with the user.
3. The destination needs UPDATE on its table and its sequence even when `Actualizar geometrías` is off, as in stage 3. Confirm with dev roles.
4. The destination geometry must have a metric SRID (AP-7). The previous version only required a non-zero SRID. Confirm that `carto.padron`
   has a metric SRID before the first real run.
5. Performance on dev is unmeasured (see Performance expectation). The timeout and the lock settings of AP-24 apply to this stage too.
6. The locality table links to the province through `id_province`, and the type filter assumes `id_territorial_unit_type` on the locality
   table (assumed; verify both on dev, `carto.territorial_unit` included).
7. Name matching is `upper()` on both sides, with no accent or whitespace normalisation (as before).

## Acceptance criteria count

AP-1 to AP-7b, AP-9 to AP-14 (AP-8 removed), AP-15 to AP-36, AP-37 to AP-49, with AP-2b, AP-7b, AP-10b and AP-32b. AP-50 is the
destination key-format check. AP-51 to AP-60 are the address master link option. Criteria AP-26 and AP-49 are the shared-store and CSV
criteria. AP-61 is the inconsistencies list. AP-62 is the table defaults and the locality hint.
