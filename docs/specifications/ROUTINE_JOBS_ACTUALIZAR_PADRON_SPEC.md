# Routine Jobs — "Actualizar padrones de carto": acceptance criteria

Stage 4 of the monthly carto update job (`ROUTINE_JOBS_MONTHLY_CARTO_UPDATE_SPEC.md`) in the `routine-jobs` module (`src/modules/routine-jobs/`).
Stage id `actualizar-padron`, Spanish name "Actualizar padrones". It reuses the conventions of the other stages: one wizard per stage, hub
connection, `TableSelector`, shared job store, per-target lock, planned-step checklist, Spanish messages, scrubbed passwords, shared report
components and CSV download. Acceptance criteria ids use the prefix `AP-`. Numbers of criteria that still apply are kept; `AP-8` is removed;
criteria added by the in-place design are `AP-37` and up.

## Context

- `carto.padron.id` is a stable identifier. It feeds the URNs `cgeo:padron:id:<id>` (addresses_master) and `access_point.id_padron`, which
  has no foreign key. **Existing ids never change** (MJ-13).
- The staging table (`bdj_carto.catastro_paispadron_stg` in dev, a schema other than `carto`) is refreshed monthly by stage 1.
- This stage applies the staging padrones **in place** to one destination table chosen by the user:
  - a padron with no destination row of its key is inserted, and its id comes from the destination sequence;
  - a padron whose geometry moved beyond the tolerance gets its geometry updated, and only the geometry;
  - a destination row the staging table no longer carries, that no pair decision is waiting on and that nothing references (AP-102 to
    AP-108) is deleted automatically, with no marking step;
  - nothing else is written. Nothing is truncated, re-inserted or renumbered, and no row is deleted unless unpairable and reference-free as
    above. Destination rows that the staging table no longer carries are counted and listed, and untouched unless deleted this way.
- The destination can be a scratch table (for example `carto.padron_tmp_actualizacion`) or `carto.padron` itself. Both are safe because the
  stage never removes or renumbers rows. Applying to `carto.padron` is the user's decision after the analysis.
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
  - the connecting role has INSERT, UPDATE, SELECT and DELETE on the destination and UPDATE on its sequence (AP-106 needs DELETE; checked
    the same way as the other three, a missing DELETE privilege refuses the run here, before BEGIN, in Spanish, rather than surfacing as a
    raw database error from inside the transaction when a padrón happens to be delete-eligible). No TRUNCATE privilege is requested: it is
    never used.
- AP-6: Staging checks: the staging geometry column is a polygon type (Polygon, MultiPolygon or generic GEOMETRY); the staging `padron` column
  has a numeric data type; the staging table has at least one row; every staging geometry SRID exists in `spatial_ref_sys` (a geometry with
  SRID 0 or an unknown SRID refuses the run).
- AP-50: Destination key format (in the target check, before BEGIN, in dry run and real run alike): every row of the destination must have
  the key the stage generates, or the run is refused, so it never inserts a padron stored under another spelling of its key. One read-only
  query counts the rows that break any of: (a) `type_padron` is not exactly `RURAL` or `URBANO` (NULL included); (b) a `RURAL` row has a
  non-NULL `id_cadastral_locality`; (c) `number` is NULL or does not match `^(0|[1-9][0-9]*)$` (`0` is valid). The refusal is one Spanish
  message naming the count and one example row (`id`, `type_padron`, `id_cadastral_locality`, `number`). When the `number` column is not a
  text type (`text`, `character varying`, `character`), the refusal names the column and its type, and check (c) is not run.
- AP-63: Locality table reference check (in the target check, before BEGIN, in dry run and real run alike). One read-only query over the
  destination rows with a non-NULL `id_cadastral_locality` counts the total and the rows whose id has no row in the chosen locality table
  (`NOT EXISTS`). Zero total, or zero unresolved, passes. Unresolved at least half of the total refuses the run, in Spanish, naming the
  locality table and both counts, and asking for `territorial_unit`: the destination's ids are unit ids and this stage would write the
  ids of another table. Any smaller unresolved count does not refuse; it adds a warning to the report, naming the count, the destination
  and the locality table. The check never changes an INSERT or an UPDATE (AP-46).
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

- AP-15: A real run runs `ANALYZE` on the destination after the apply, inside the transaction. Its failure rolls back the run. An analysis
  runs no `ANALYZE` (AP-88).
- AP-16: Result report (built after the ANALYZE in a real run, and from the classification in an analysis, AP-88; returned in the job result):
  - totals: staging rows read, candidates (accepted rows), rows repaired (AP-12), rows skipped;
  - skipped rows by reason (`skipped.byReason`: all seven reasons, zero counts included);
  - skipped rows by department name and by locality name, top 20 by count each;
  - `skipped.byLocalityAndReason`: groups by (department, locality, reason), restricted to the two locality reasons and capped at 20 per
    reason (PG11 compatible; no global LIMIT). It feeds the UI lists of localities not found and ambiguous (AP-32b);
  - up to 20 sample skipped rows, and up to 20 colliding keys (AP-13);
  - the target report of AP-37 to AP-45 (inserted rows, geometry changes, missing and ambiguous samples, counts); in an analysis the
    inserted, updated and paired counts are the planned ones and the inserted list is empty (AP-88);
  - step timings: elapsed ms per step, labelled as the planned steps of AP-23;
  - warnings in Spanish (AP-40 to AP-45, skipped rows, repaired geometries, colliding keys, analysis (read-only), outcome unknown).
- AP-17: `dryRun` is the read-only analysis of AP-88: it runs the classification in a `READ ONLY` transaction and writes nothing, so it
  never advances the destination id sequence. The report carries `targetModified: false` and a `planId` (AP-89). A real run performs the
  whole stage, then `COMMIT`; `targetModified: true` is reported only when the commit succeeded. The ids of a real run can still show gaps,
  because `nextval` (the inserts) and `setval` (AP-47) are not transactional and a rolled-back real run keeps its ids spent (as UT-23 (a)
  of the monthly spec, for the units).
- AP-18: A real run needs `confirm: true` and the password. In the wizard the password stays filled from the analysis (the dry run keeps it so
  "Volver a analizar con la selección" works). The destination table name is not typed again (RC-1). The persist is refused with the
  message asking for the password when it is missing.
  A real run also needs a usable plan from an analysis of the same parameters (AP-89, AP-90).
  The per-target lock is keyed on the destination: `host:port|db|cartoSchema|targetTable` (host trimmed and lowercased, port normalised, as in
  AC-24 of Cargar padrones). A second run on the same destination answers `409`.
- AP-19: Any failure before `COMMIT` rolls back: the destination is left as it was before the run. A `COMMIT` that throws gives
  `outcomeUnknown: true`; the UI asks the user to verify the destination table before retrying (as AC-21 of Cargar padrones).
- AP-20: The job runs in the background. `POST actualizar-padron/start` body = `{ connection, stagingSchema, stagingTable, cartoSchema,
  targetTable, provinceTable, localityTable, typeTable?, options: { tolerance, updateGeometries, localityType?, pairChoices? }, dryRun, confirm,
  planId? }`. A real run (`dryRun: false`) also sends the `planId` of its analysis (AP-89).
  `stagingSchema` covers the staging table; `cartoSchema` covers the destination, province, locality and type tables. `typeTable` is optional
  (omitted or empty = no type table). `options.localityType` applies only when `typeTable` is present: an absent value defaults to
  `LOCALIDAD CATASTRAL`, a present blank value is refused with `400`, and a non-blank one is trimmed. `options.tolerance` is a number greater
  than or equal to 0 (`400` otherwise, AP-40). `options.updateGeometries` is a boolean and `options.geometryAreaThreshold` a number from 0 to 1 (absent means 0.05, AP-92). Answers `200 { success, jobId }` at once. Errors: `400`
  for an invalid body, repeated tables (AP-3), an unknown or ambiguous type (AP-7b), a blank `localityType` with a type table, a missing
  `confirm` on a real run, and a real run whose `planId` is missing or not a plan id (AP-90, `400`); `409` with `Ya hay una actualización en
  curso para esta tabla.` when a job is running for the same destination. A plan that is unknown, expired or for other parameters is refused
  by the job itself (AP-90): the job is FAILED with the Spanish message and nothing is written.
- AP-21: `GET actualizar-padron/status?jobId=...` -> `200 { success, job }` with the fields of AC-25 of Cargar padrones (`jobId`, `state`,
  `step`, `current`, `total`, `dryRun`, `startedAt`, `finishedAt`, `result?`, `error?`, `outcomeUnknown?`). `400` without `jobId`, `404` for
  an unknown id. A `result` with `outcomeUnknown` is DONE with that flag.
- AP-22: `runActualizarPadron` takes injected dependencies (session, clock) and calls `onProgress({ label, current, total })` once per step, in
  order, 1-based. A throwing `onProgress` never fails the run. The planned steps come from the pure function `plannedStepLabels({ dryRun })`, so
  the UI checklist shows them before the run starts. An analysis has no sequence, apply, ANALYZE, backup, COMMIT or rollback step (AP-23).
- AP-23: Planned steps (labels in Spanish). A real run: validar tablas y columnas (includes the type check of AP-7b), validar tabla de
  destino (structure, privileges, sequence), contar filas de staging, resolver provincias y localidades (candidates and the skip report),
  clasificar padrones, ajustar secuencias de destino, aplicar cambios de padrones, analizar tabla de destino, generar informe, generar
  respaldo para revertir and confirmar cambios. An analysis (AP-88): the same validation, count, resolve and classify steps, then
  clasificar padrones sin dirección maestra (only with the link option) and generar informe. The backup step exists only in a real run (AP-68).
- AP-24: Session: the real session reuses the settings of shp-replace (`statement_timeout`, `lock_timeout`, `client_encoding = 'UTF8'`,
  memory settings) as in AC-28 of Cargar padrones. `connect` errors are scrubbed of the password; `close()` never throws. The password never
  appears in logs, statuses, results or error messages.
- AP-25: Sample and payload caps hold for every report field, so the status payload stays bounded whatever the table size: samples (skipped,
  missing, ambiguous) and colliding keys at `SAMPLE_LIMIT` (20); skipped groups at 20; locality-and-reason groups at 20 per reason; the
  inserted list, the geometry change list and the missing padrón review list (AP-96) at `DETAIL_LIST_LIMIT` (500). No uncapped list is in any
  payload: the full pending geometry list lives in the plan record and is served by AP-95.
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
  only for candidates whose geometries differ and whose destination row exists, and it only decides `CHANGED` against the tolerance. The area
  ratio (symmetric difference over union, `areaRatioOf`) is computed once for every `CHANGED` row (AP-92) and ranks the geometry change list
  (AP-94): pending first, then the ratio descending (nulls first), then department, locality and padrón.
- AP-40: Tolerance option `Tolerancia (m)`: a number greater than or equal to 0, default 1.0, in metres. The request validates it as stage 3
  does (`readTolerance`). The wizard blocks Siguiente on an invalid value.
- AP-41: `MISSING` rows are counted and sampled on the server (up to 20, ordered by province and number; the samples are not shown in the report). They are never deleted, updated or renumbered.
  A destination row consumed by an applied pair (AP-64) is not missing.
  A key that exists in staging only as a skipped row (AP-12, AP-13) has no candidate and so counts as `MISSING`; the skip reasons of the report
  show why.
- AP-42: `NEW` candidates are inserted with the list `(type_padron, id_cadastral_locality, id_province, number, geometry)`, except the new rows
  consumed by an applied pair (AP-64), which are not inserted. The id comes from
  the destination sequence (its `nextval` default). The insert order is deterministic (`id_province`, `number`, `type_padron`,
  `id_cadastral_locality`). `id_address_master` stays NULL.
- AP-43: `UNCHANGED` and `WITHIN_TOLERANCE` candidates: nothing is written.
- AP-44: `CHANGED` candidates: an UPDATE of the `geometry` column only, when `Actualizar geometrías` is on and the area ratio is below the
  threshold (AP-92). Any other `CHANGED` candidate is pending: not written, counted and listed with state `PENDING`. When `Actualizar
  geometrías` is off, every `CHANGED` candidate is pending (`Geometría detectada (no aplicada)`).
- AP-45: `AMBIGUOUS` candidates: untouched and reported (count and up to 20 samples). The stage never guesses which destination row is right.
- AP-46: The only writes of the stage are the INSERT of AP-42, the UPDATE of AP-44 and the pair UPDATE of AP-65. No statement writes `id`, `id_address_master` or any
  other column, and the stage issues no DELETE and no TRUNCATE (a unit test greps the stage's SQL for both).
- AP-47: A real run's sequence repair (`Ajustar secuencias de destino`) runs after the classification and before the insert, in the same
  transaction (an analysis never repairs a sequence, AP-88):
  `setval` to the maximum id plus one, or to the current sequence position when that is higher. Its privilege is checked by AP-5.
- AP-48: Count checks roll back the whole transaction on mismatch, with a Spanish error: inserted rows equal the `NEW` count; updated rows equal
  the applied geometry updates (AP-92; zero when `Actualizar geometrías` is off); paired rows (AP-65) equal the applied pairs (AP-67).

## Reclassified and renumbered padrones (pairs)

- AP-64: Pairing. A pair is a `NEW` candidate and a destination row whose key no staging row carries, skipped or not (the unmatched destination
  rows). The bounding-box probe on the destination geometry index reads every destination row whose box meets a candidate, matched or not;
  the footprint is evaluated only on the unmatched rows. Both sides must have the same `id_province`, overlapping bounding boxes and valid
  destination and candidate geometries, and the footprint must meet the STRICT or the LOOSE tier of AP-84 (98 % or 85 % overlap of the
  destination area, area within 2 % or 10 %). A destination row whose key a skipped staging row still carries is not paired (it stays listed as
  missing, AP-41). The Hausdorff distance is not measured for pairs, and the tolerance does not gate a pair. Status: `APPLIED` when each side
  occurs in exactly one pair and the pair is STRICT or is chosen by the user (AP-86, AP-93); `NOT_APPLIED_PENDING` when the pair is LOOSE and not
  chosen (AP-93); `NOT_APPLIED_AMBIGUOUS` when either side occurs in more than one pair, whatever the tier.
- AP-65: Applied pairs are written in place: one UPDATE of the destination row sets `type_padron`, `id_cadastral_locality` and `number` to the
  new key, and `geometry` to the candidate geometry only when `Actualizar geometrías` is on. The statement never sets `id`, `id_address_master`
  or `id_province`, and it issues no DELETE or TRUNCATE. The row keeps its id and its address master link. The number may change only in an
  applied pair (STRICT, or LOOSE when chosen, AP-93). The new row of an applied pair is not inserted (AP-42) and its old row is not missing (AP-41).
- AP-66: `NOT_APPLIED_AMBIGUOUS` and `NOT_APPLIED_PENDING` pairs change nothing: the new row is inserted (AP-42) and the old row is listed as
  missing (AP-41). They are reported (AP-67) and warned about in Spanish.
- AP-67: Reporting and verification. The target report lists every pair, applied or not, up to `PAIR_LIST_LIMIT` (5000), ordered by department,
  locality and padrón, with the old and the new key, the changed parts (type, locality, number), the overlap and the area ratio (AP-86), the
  location fields of AP-94, and the status label: `Aplicado`, `No aplicado: ambiguo` or `Pendiente: coincidencia parcial`. The report shows no flat table of
  these pairs (AP-32b): applied pairs are only counted (`Claves actualizadas`) and exported, pending pairs are listed in AP-99 and ambiguous
  ones in the group cards of AP-87. The change CSV (AP-49) gets one `Clave actualizada` row per applied pair, with the new key in the usual
  columns and the old `Tipo anterior`, `Localidad anterior` and `Padrón anterior` in the three appended columns (empty elsewhere). The
  inconsistencies CSV (AP-61) gets one row per not-applied new padrón (`Posible par no aplicado (ambiguo)` or `Posible par pendiente (coincidencia
  parcial)`); a new row that matched several destination rows is listed once. Its total is `pairs_not_applied` (ambiguous new rows) plus
  `pairs_pending`. The count check of AP-48 compares the paired rows with the applied pairs. Verification: a second run of the same stage on the
  same data inserts and updates nothing.
- AP-84: Tiers. Each pair candidate carries a `tier`: `STRICT` when the overlap is at least 98 % (`PAIR_OVERLAP_MIN` 0.98) and the area is
  within 2 % (`PAIR_AREA_RATIO_TOLERANCE` 0.02, `0.98 x` to `1.02 x`); otherwise `LOOSE` when the overlap is at least 85 %
  (`PAIR_LOOSE_OVERLAP_MIN` 0.85) and the area is within 10 % (`PAIR_LOOSE_AREA_RATIO_TOLERANCE` 0.10, `0.90 x` to `1.10 x`). A candidate
  that meets STRICT is tagged STRICT even when it also meets LOOSE; a candidate that meets neither is not a candidate. The intersection area is
  computed once per candidate, and only for valid geometries (the CASE guard of AP-64). The one-to-one count of AP-64 runs over the candidates of
  both tiers, so an ambiguity blocks both. A `LOOSE` pair is applied only when the user chooses it (AP-93). The classify result carries
  `pairs_loose` (applied pairs with tier `LOOSE`), and every element of `pairs_list` carries `tier`. The writes of AP-65 do not change: a pair
  UPDATE sets only `type_padron`, `id_cadastral_locality`, `number` and, when `Actualizar geometrías` is on, `geometry`.
- AP-85: Tier report. Every element of `pairs_list` carries its tier (`Estricta` or `Parcial (coincidencia parcial)`) and a status label, which shows
  `Pendiente: coincidencia parcial` for a pending LOOSE pair; the report has no flat pairs table, so the tier is shown in the group cards (AP-87) and in the CSV. When `pairsLoose` (applied LOOSE pairs, all chosen) is greater than zero, the
  warnings carry the Spanish line "N padrones se actualizan por coincidencia parcial (superposición 85-98%); revisarlos en el listado de pares."
  (singular: "1 padrón se actualiza ...; revisarlo ..."). When `pairsPending` is greater than zero, the warnings carry "N posibles pares de
  coincidencia parcial están pendientes: se insertan como nuevos y la fila antigua se lista como faltante." (singular: "1 posible par de
  coincidencia parcial está pendiente ..."). The change CSV (AP-49) keeps its columns; the row of an applied `LOOSE` pair has the `Cambio` value
  `Clave actualizada (coincidencia parcial)`, and a `STRICT` pair keeps `Clave actualizada`.
- AP-86: User choices for ambiguous groups. The start request takes `options.pairChoices`, a list of `PairChoice` objects (absent means
  `[]`). Each choice holds the new row key as in a `pairs_list` element (`typePadron`, `provinceId`, `localityId` or null, `number`) and
  `oldId`, the destination id chosen for that key, or null (no pair: insert as new). Deny by default for ambiguous groups: without a choice
  an ambiguous group pairs nothing (AP-66). A key with no choice and a single STRICT candidate pairs as AP-64 says; a single LOOSE candidate stays pending (AP-93). Pruning:
  before the one-to-one count of AP-64, a pair candidate is
  dropped when its new key has a choice whose `oldId` differs from the candidate's old id (a null choice drops every candidate of that
  key), or when its old id is chosen for a different new key. The surviving candidates are counted and tiered as usual, so a unique
  survivor is `APPLIED` when it is STRICT or chosen (AP-93). The writes of AP-65 do not change.
  Validation, as an invalid request naming `pairChoices` in Spanish: not a list (null included); an entry that is not an object, or whose
  `provinceId` or `localityId` or `oldId` is not an integer within the int4 range, -2147483648 to 2147483647 (`localityId` and `oldId` may
  be null), or whose `typePadron` is not `RURAL` or `URBANO` (the only unit types the stage classifies: any other value is `CLAVE_NULA`, so
  a choice with another value could never match), or whose `number` is not filled text (its digit form is not validated: the stage builds
  `number` as `trunc(padron)::text`, which can carry a sign or an exponent); two choices for the same new key; the same non-null `oldId`
  chosen for two new keys (two null choices are accepted); more than `PAIR_LIST_LIMIT` (5000) entries. The list is rejected, never truncated.
  The classify result carries `choices_unapplied`: the number of choices with a non-null `oldId` that did not end as an `APPLIED` pair. It
  maps to `choicesUnapplied` in the target report and, when greater than zero, the warning "N elecciones de par no se aplicaron (el padrón
  elegido ya no es candidato o sigue siendo ambiguo)." (singular: "1 elección de par no se aplicó ..."). A null choice is never counted.
  Every `pairs_list` element carries `overlap` (intersection area over the old area) and `areaRatio` (new area over the old area) as
  numbers, or null when the old area is zero. They are mapped to `PadronPair` and to the report view as data only; no column shows them yet.
  The control that sends the choices is AP-87.
- AP-87: Choice control. The dry-run report (stage 4, target section) lists the `NOT_APPLIED_AMBIGUOUS` pairs grouped by new key
  (`typePadron`, `provinceId`, `localityId`, `number`) in the section "Grupos ambiguos", in report order. Each group card shows the new
  padrón (department, locality, number, type) and its candidates as a radio list, one per pair: the old id, the old key (type, locality,
  number), the tier (`Estricta` or `Parcial`), the overlap in percent and the area ratio; a last option "No emparejar (insertar como
  nuevo)" chooses a null `oldId`. No option is selected by default: a group without a choice pairs nothing (AP-86). A candidate whose old
  id is chosen for another group is disabled, so the request never repeats an old id. The choices live in the wizard state
  (`pairChoices`), are kept across "Volver a Revisar", are sent in `options.pairChoices` by the dry run and the real run (only the groups
  with a choice; absent when there is none), and are cleared when the connection (except the password), a schema, a table, or an option
  changes, and by "Nueva carga". The dry-run result shows "N de M grupos con elección" (groups with a choice of the groups listed) and
  the button "Volver a analizar con la selección", which starts an analysis with the current choices; it is enabled only when an analysis
  can start (the password typed on the review). A group the re-run resolves (its pair is applied) leaves the list; its pair stays in the
  `Claves actualizadas` count and in the changes CSV.
  Cascade: a choice also removes its old padrón from the candidates of the other groups (AP-86 pruning), so it can resolve them; the
  re-analysis shows it. When the choices differ from those of the last analysis that completed, the persist (AP-91) is not blocked: it first analyzes again
  with the current selection and persists that new plan (flow in AP-91; the message "Analice de nuevo con la selección de pares actual antes de persistir." remains the guard `simulationBlockingReason`). The choices equal those of the last analysis when
  the choices (same set of key and old id, order-insensitive) equal those of the last analysis that completed, including when every choice
  was cleared after an analysis that had choices (the server would refuse the plan). The wizard state keeps that set as `simulatedChoices`;
  an analysis that failed or is still running does not count. The review shows "N elecciones de par incluidas" when there are choices.
  Unapplied: a choice is unapplied when its own submitted version (the choices sent with the shown run, kept in the run plan) has a
  non-null `oldId` and no `APPLIED` pair of that run has the same new key and the same `oldId`. A group card carries the badge
  "Elección no aplicada" only when its own submitted choice is unapplied, not when it was picked after the run.
  There is no choices list in the results: every choice is shown by its own list (the group card for an ambiguous pair, the pending section of AP-99 for a
  pending pair), and an applied or unapplied choice appears as the pair outcome. A remount of a completed dry run seeds the choices from the run plan, so the cards and the guard match the
  shown run. The backend warning (`choicesUnapplied`) stays in the warnings. A real-run result shows the same groups
  read-only, with the submitted choices: the radios are disabled, there is no count and no re-run button.

## Analysis plan (read-only analysis, guarded load)

- AP-88: Read-only analysis. `dryRun: true` runs the same preflight checks, then the classification (`buildPadronClassifySql`) inside a
  `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction. It runs no sequence repair, no apply, no revert table, no revert backup, no
  `ANALYZE` and no address master write: the link option is classified only. The report is built from the classification: the inserted,
  updated and paired counts are the planned `new`, `updates` and `pairs`; the inserted list is empty (the ids exist only after an insert)
  and is omitted; the address master counts are the planned ones, and a warning says that the links of the new padrones are computed when
  the load is saved. The result carries `targetModified: false` and the `planId` of AP-89. The read-only transaction is a second line: the
  database rejects any write inside it.
- AP-89: Plan record. A successful analysis writes a plan file to `<os.tmpdir()>/gis-tools-routine-jobs/plans/<planId>.json`, in the same private
  folder as the revert backups (a folder that is a link or belongs to another user is refused; the file is created with mode 0600). The
  `planId` is 128 random bits as 32 lowercase hex characters. The record holds `planId`, `createdAt`, `expiresAt` (three days after
  `createdAt`), `paramsFingerprint`, `dataFingerprint`, `expected` and `pendingGeometryChanges` (the uncapped pending list that feeds the
  pending CSV, AP-95; it is not part of any fingerprint), and never the password. `paramsFingerprint` is the SHA-256 of the
  canonical request parameters that define the result: host (trimmed, lowercased), port, database, user, staging and carto schemas, the
  table names, the locality type, the tolerance, the geometry area threshold, `updateGeometries`, `linkAddressMaster`, `pairChoices` sorted and `acceptedGeometries` sorted (AP-100); the password and the
  confirmation flags are not part of it. `dataFingerprint` is read by the classify statement: the destination row count, its maximum id, the
  staging candidate count, and `digest`, an md5 over the sorted entries of the planned writes: `N|` for each NEW key, `P|` for each applied
  pair (new key and old id) and `C|` for each applied geometry update (with its target id, AP-92); each entry carries the md5 of its candidate geometry. `expected`
  holds the inserted, updates and pairs counts. `pendingGeometryChanges` holds the full list of pending geometry changes (AP-92) for the CSV of AP-95;
  it is not part of `dataFingerprint`, `paramsFingerprint` or the digest, and it never reaches a payload. Plan files older than three days are removed
  when a new plan is written.
- AP-90: Persist guard. A real run (`dryRun: false`) requires a `planId` in the request: a missing or non-text value answers `400` with the
  Spanish message that asks to analyse first, and a value that is not in the plan id format answers `400` as an unknown plan. Before any
  connection is opened, the run refuses (the job is FAILED with the Spanish message, nothing is written) when the plan is unknown, expired
  (`El plan del análisis caducó: vuelva a analizar.`) or its `paramsFingerprint` differs from the request's. Inside the write transaction the
  classification is read again before any write, and before the sequence repair: when its data fingerprint or its expected counts differ
  from the plan, the run aborts with `El plan cambió desde el análisis; vuelva a analizar.` and writes nothing. When they are equal, the stage
  runs as AP-42 to AP-48. A plan is single use: it is deleted once its real run has committed (`targetModified: true`); a run that fails
  keeps it, and the digest check refuses it after any committed change.

- AP-91: Wizard flow of the analysis and the persist (UI). The review step (AP-31) has one primary button, `Analizar` (`dryRun: true`), and the
  password that connecting needs. It has no real-run button: the only field is the password that connecting needs. On the result of a completed
  analysis (a DONE job with `dryRun: true`) the top of the screen is the panel `Persistir cambios revisados`: a one-line summary built from
  the planned counts of the report, `Se aplicarán: N padrones nuevos, M pares actualizados, K geometrías actualizadas.` (`target.inserted`,
  `target.pairsApplied`, `target.updated`), the password (still filled from the analysis, AP-18), and the
  button `Persistir cambios revisados` with the Database icon. The button is disabled, and the reason is shown, when the result carries no
  `planId` (the plan of AP-89) or when the confirmation is incomplete. When the pair choices (AP-86) or the accepted geometries (AP-100) differ
  from those of the last completed analysis (guard `simulationBlockingReason`) the button stays enabled and a note under it reads "Se volverá a analizar con su
  selección antes de persistir; las cifras pueden cambiar."; the summary line is the last analysis's and may be stale. When the selection is the analysed one, a click sends the real run through the existing start flow: `dryRun: false`, `confirm: true`, the
  same tables, options and pair choices as the analysis, and the `planId` of the analysis result. The panel is never shown on a real-run result
  nor while a run is active. After a persist the result and the automatic backup download follow AP-77 to AP-82 unchanged. When the server
  refuses the persist (missing, expired or changed plan, AP-90) the failed result shows the server's Spanish message and the action
  `Volver a analizar`, which returns to the review step. The button `Volver a analizar con la selección` (AP-87) re-runs the analysis on the
  result screen; the review's `Volver a Revisar` is unchanged.
  Persist with a changed selection (pure logic in `actualizarPersistFlow.ts`: `persistDecisionOf` and `autoPersistOutcomeOf`): a click on `Persistir cambios
  revisados` whose selection differs from the last analysis (and whose plan and confirmation are present) does not block. The wizard (1) starts an
  analysis (`dryRun: true`) with the current choices and accepted geometries, exactly what `Volver a analizar con la selección` sends, and shows "Analizando con su
  selección…" over the usual step checklist; (2) waits for that job to be DONE (the per-destination lock is held only while a job is RUNNING, so it is free by then; never two jobs at once);
  (3) if the result carries a `planId` and both `choicesUnapplied` and `geometryAcceptsUnapplied` are zero, starts the real run with `dryRun: false`, `confirm: true`,
  the same choices and acceptances and the NEW `planId`, and the usual real-run checklist follows. In any other case it does not write: a failed or unknown
  analysis shows its error, a result without `planId` or with unapplied choices or acceptances (even though that is not an error) shows the new analysis result with its warnings and the persist panel
  again. Resetting the run (`Nueva carga`) or leaving the wizard cancels the pending persist.
  `Volver a analizar con la selección` stays for reviewing the new figures first.

- AP-92: Geometry gate. `options.geometryAreaThreshold` (a number from 0 to 1, default 0.05; the wizard sends the `Umbral de cambio de área
  para aplicar (%)` of AP-30 divided by 100) decides which `CHANGED` rows are written. A request value that is not a number from 0 to 1 answers
  `400`. The area ratio of AP-39 is computed once per `CHANGED` row, in the `changed_geometry` CTE, with the two areas; the counts, the UPDATE,
  the digest and the lists all read that CTE. A row is applied when `Actualizar geometrías` is on and its ratio is below the threshold (strictly)
  or the user accepted its key (AP-100);
  otherwise it is `PENDING`: not written, counted in `geometry_pending` (`geometryPending` of the target report) and listed with state
  `PENDING`. A `CHANGED` row whose destination geometry is NULL has no ratio to gate: it is a fill-in, applied when `Actualizar geometrías`
  is on (and counted in `updates`, listed as `APPLIED`). A NULL ratio of a row with a destination geometry (no usable area) is pending. `updates` counts the applied rows only, so AP-48 compares applied rows. A pending row is not
  part of the plan digest (AP-89) and not a planned write. The threshold is part of `paramsFingerprint` (AP-89). The full list of pending rows
  (`pending_geometry_changes`) has no cap: the analysis stores it in the plan record (AP-89) and the pending CSV of AP-95 serves it. The report keeps
  only the capped geometry list (AP-94) and the exact counts; the status payload never carries the full list.
- AP-93: Loose pairs pending. A pair of tier `LOOSE` (AP-84) is `APPLIED` only when a user pair choice (AP-86) names its new key and its old id.
  Otherwise its status is `NOT_APPLIED_PENDING`: the old row is not written, the new row is inserted (AP-42) and the old row is listed as missing
  (AP-41). `STRICT` pairs stay applied by default. A new key or an old row claimed by two candidates is `NOT_APPLIED_AMBIGUOUS` whatever the tier,
  and a pending candidate takes part in the one-to-one count of AP-64 as before. The counts: `pairs` and `pairs_loose` count applied pairs only;
  `pairs_pending` counts pending pairs; `pairs_not_applied` counts ambiguous new keys only. A pending pair is listed in `pairs_list` with status
  `NOT_APPLIED_PENDING`. The control that lets the user choose a pending pair is not part of this round.
- AP-94: Locating data. The geometry change list and the pairs list (the latter feeds the pending section, the group cards and the CSVs) drop the Hausdorff distance and carry these fields instead: `oldId` (the
  destination id, shown as `Id actual`), `typePadron`, `provinceId`, `department` and `locality` (the staging nomdepto and nomloccat; the locality
  falls back to the destination locality name when the staging name is empty), `number`, `oldAreaM2` and `newAreaM2` (`ST_Area` on the destination
  SRID, in m²), `areaChangePct` (`areaRatio` × 100, one decimal), `centroidLat` and `centroidLon` (the centroid of the new geometry in WGS84, six
  decimals). For a pair, `areaRatio` is the new area over the old one (AP-86), and its `areaChangePct` is the signed change, `(areaRatio − 1) × 100`
  rounded to one decimal: 0 is the same area, −2.0 is 2 % smaller. The Hausdorff distance stays only inside the class `CHANGED` (AP-38) and is not in any
  report or view model of these lists. The geometry
  list (`geometry_changes`) keeps `DETAIL_LIST_LIMIT` rows, pending first, then by area ratio descending, department, locality and padrón, each with
  `state` `APPLIED` or `PENDING`. The target section shows the counts `Geometrías pendientes` and `Pares pendientes`. Columns of the geometry
  table: Tipo, Departamento, Localidad, Padrón, Id actual, Área anterior (m²), Área nueva (m²), Área no coincidente (%), Latitud, Longitud, Estado.
  The UI lists only the pending rows (and those the user accepted or rejected, so an acceptance can be undone); the rows applied under the
  threshold are a plain count line (AP-32b) and stay in the changes CSV.

## Shared job store

- AP-26 (above) is the only store criterion; the Cargar padrones job uses the same helper without behaviour change.

## Client (UI)

Everything user-facing is Spanish; code is English; modular CSS, no inline styles, Lucide icons only.

- AP-27: Wizard (`ui/ActualizarPadronWizard.tsx`), five steps with `WizardOrchestrator`: (1) Conexión, (2) Tablas, (3) Opciones, (4) Revisar,
  (5) Resultado. The reducer is pure (`ui/actualizarPadronWizardState.ts`). `canContinue` requires: connection fields valid; the two schemas
  chosen; the required tables chosen, distinct and valid (the type table is optional); when a type table is selected, a non-blank locality
  type; a valid tolerance. The password that a real run needs is checked by the persist panel of
  AP-91, not by the review step. Changing the connection resets the schemas
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
  applied either way). `Umbral de cambio de área para aplicar (%)` (default `5`, 0 to 100, shown with `Actualizar geometrías`, sent as a fraction, AP-92). No clear mode, no repair toggle and no sequence option.
- AP-31: Review step: summary of the selected tables (the type table and the locality type only when a type table is selected), the tolerance
  and the geometry option. The info line "Inserta los padrones nuevos y actualiza la geometría de los existentes. Nunca borra filas ni cambia
  ids." is always shown. When `Actualizar geometrías` is on, the overwrite warning is shown. The only action is "Analizar" (the analysis,
  `dryRun: true`, password required); the review has no real-run button (AP-91). The info line "El análisis no modifica
  la base de datos. Los cambios se guardan después, desde el resultado del análisis." is always shown. With the link option on, the review
  also shows the option and the address master table, and the warning of AP-59 when the destination is not named `padron`.
- AP-32: Result step: planned-step checklist (every planned step listed at once, done / current / pending, planned steps sent by the server in
  the job status), elapsed time from the run store while running; the report afterwards (AP-16), laid out as AP-32b. A dry run shows the
  banner that the destination was not modified, and the persist panel of AP-91 at the top. An `outcomeUnknown` result shows the
  verify-before-retry banner.
- AP-32b: Report layout:
  - a KPI row: rows read, candidates, skipped, inserted, updated, geometry changes; below it the outcome banner (dry run "Análisis: la tabla de
    destino no fue modificada", or confirmed "Actualización confirmada: la tabla de destino fue modificada", or unknown);
  - skipped by reason: a compact table with one row per non-zero reason, a proportional bar and the percentage; zero reasons collapsed into
    one line ("Sin filas: n motivos"). Each shown reason has a one-line Spanish explanation;
  - the target section (destination table name), one list per case (a case needing review appears in exactly one list; a case applied by default has no
    list):
    - a one-line summary above the lists: "Aplicados sin revisión: A claves actualizadas, B geometrías. Para revisar: C pares pendientes, D grupos
      ambiguos, E geometrías pendientes, F faltantes." (A: `pairsApplied`; B: `changed` − `geometryPending`, 0 with `Actualizar geometrías` off; C:
      `pairsPending`; D: `pairsNotApplied`; E: `geometryPending`; F: `missing` minus the padrones awaiting a pair decision, "hasta F" when the pairs list is cut);
    - applied strict pairs: only the count `Claves actualizadas` and the changes CSV (no list); applied geometries: a count line and the CSV (no rows);
    - pending geometries: the section "Geometrías pendientes" (summary "primeras N de M pendientes", M = `geometryPending`) with AP-100;
    - pending partial-match pairs: the section of AP-99; ambiguous pairs: only the group cards "Grupos ambiguos" of AP-87 (no flat table; no
      "Elecciones de par" list);
    - missing padrones (AP-96, AP-101): the old side of a pending or ambiguous pair is not listed there; the line "N faltantes esperan una decisión de par
      (ver pares pendientes y ambiguos)" counts them (N: distinct old ids of the pending and ambiguous listed pairs; "Al menos N" when `pairs_list` is cut);
    - counts "Insertadas", "Actualizadas", "Geometrías que cambian", "Sin cambios", "Sin cambios
    dentro de tolerancia", "Faltantes en destino", "Ambiguas", a note when geometry changes were detected but not applied, and collapsible
    lists (inserted, geometry changes, ambiguous) whose summary says "primeras N de M" when cut. "Faltantes en destino" is only a count: the
    report has no sample table of missing keys (the missing padrones review above is the list);
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
- AP-35: Dashboard: the routine-jobs job list shows "Actualizar padrones" as stage 4 of the monthly update; its wizard opens from there. The module
  page, the home card and the manifest need no new entry point.
- AP-36: Routes: `module.routes.json` declares the two endpoints (`actualizar-padron/start`, `actualizar-padron/status`) and the catalog roles
  travel with `catalog/columns`. The generated routes are regenerated with `npm run modules:routes`, never hand-edited; `npm run
  modules:routes:check` passes.

- AP-62: The table pickers prefill from `config/monthlyTables.ts`: staging = stage 1 staging (else `bdj_carto.paispadron`), target `carto.padron`, province `carto.province`, locality `carto.territorial_unit`, type `carto.territorial_unit_type`; the address master stays empty until the link option is on. The locality picker shows the hint that the locality table must be `territorial_unit`, because padron rows store unit ids.

## Change list (CSV)

- AP-49: "Descargar CSV" exports the database changes only, as a flat table with the header
  `Tabla,Cambio,Tipo,Provincia,Localidad,Padrón,Id,Área anterior (m²),Área nueva (m²),Cambio de área (%),Área no coincidente (%),Latitud,Longitud,Tipo anterior,Localidad anterior,Padrón anterior`
  (`Área no coincidente (%)` is filled by the geometry rows, `Cambio de área (%)` by the key-update rows; each row fills only its own column)
  (the last three are filled only by `Clave actualizada` rows, AP-67). `Id` is the destination id of a geometry change or a key update; it is
  empty for an inserted padron, whose id is still not exported. One row per inserted padron (`Insertada`), one per applied geometry change
  (`Geometría modificada`) and one per pending geometry change (`Geometría detectada (no aplicada)`), both read from the capped geometry list
  (AP-94), so the CSV never carries the full pending list (that one is downloaded with AP-95); and one per applied key update (AP-67). The rows
  are ordered by kind, then department (Provincia), locality (Localidad), padrón. `Provincia` and `Localidad` are the staging names, empty cells
  are "sin dato". The formula guard and the escaping of the shared CSV helper apply. When a list is cut at its cap (the real count is greater
  than the list length) the CSV ends with one marker row per cut list (MJ-14): Tabla = destination table, Cambio = `Lista incompleta: se muestran
  las primeras 500 de N padrones insertados` or `... de N geometrías que cambian` (the geometry rows against the changed count), other cells
  empty. A complete list has no marker. The filename follows the convention of the other stages with the slug `actualizar-padron`.

## Inconsistencies list (CSV)

- AP-61: "Descargar inconsistencias" appears only when the report has skipped rows (`skipped.skippedRows` non-empty) or not-applied pairs
  (AP-66), and exports the skipped staging rows and the not-applied pairs (AP-67), not database changes: a flat table with the header `Motivo,Departamento,Localidad,Padrón`, one row per skipped row. `Motivo`
  is the Spanish label of the skip reason (the same labels as the report), `Departamento`, `Localidad` and `Padrón` are the staging values
  (empty cells are "sin dato"). The rows come from the report SQL, capped at `DETAIL_LIST_LIMIT` (500), ordered by skip reason, department,
  locality and padrón. The total comes from the counts. When the list is cut, the CSV ends with one marker row: the `Lista incompleta: se
  muestran las primeras 500 de N filas omitidas` text in the second cell, the other cells empty. The formula guard and the escaping of the
  shared CSV helper apply. The filename is `carto-actualizar-padron-<simulacion|real>-inconsistencias-<stamp>.csv`. The 20-sample table of
  the report is unchanged, and the database-changes CSV (AP-49) does not change. The Motivo of a not-applied pair is `Posible par no aplicado (ambiguo)` (AP-66) or `Posible par pendiente (coincidencia parcial)` (AP-93).

## Address master links (option)

The padrones this stage inserts have no address master record (`id_address_master` is NULL). The option below links them, in the same
transaction. The rules are the legacy `addressMaster.sql` PADRON block (URN `cgeo:padron:id:<id>`, insert with latitude and longitude 0,
link where NULL), with the MJ-13 invariants: exact URN equality (never `SPLIT_PART`), no id is written, no DELETE or TRUNCATE. The SQL is the
shared one of `jobs/shared/addressMasterLink*` that stage 3 also uses, so both stages apply the same rules.

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
  the option is on, so the lock prevents another stage-4 run on the same tables. The job stores are per stage, so a stage-3 run and a
  stage-4 run on `addresses_master` do not block each other. That is harmless: the URN prefixes differ and the sequence repair never
  lowers the sequence.
- AP-55: Count checks roll back the whole transaction on mismatch, in Spanish: records created equal the classification's `toCreate`
  ("Los registros de dirección maestra creados para padrones (X) no coinciden con los esperados (Y) en T."); padrones linked equal
  `toCreate + alreadyHadRecord` ("Los padrones enlazados (X) no coinciden con los esperados (Y) en T."); padrones still without address
  master after the link equal the ambiguous count ("Los padrones sin dirección maestra después del enlace (X) no coinciden con los
  ambiguos (Y) en T.").
- AP-56: An analysis writes no address master row and links nothing; it classifies the links only (AP-88), and the report says the
  destination was not modified. A real run commits both passes or neither. The result carries the address master section only when the
  option is on (AP-57).
- AP-57: Result section `addressMaster` (present only when the option is on): counts (padrones sin dirección maestra, registros por crear,
  registros creados, padrones enlazados, ya tenían registro, ambiguos, sin dirección maestra después del enlace), the linked list (up to
  `DETAIL_LIST_LIMIT`, with id, address master id and created or existing), and the ambiguous samples (up to `SAMPLE_LIMIT`). The report
  shows it as a section of its own after the destination section, with the list cut markers of AP-58.
- AP-58: The stage CSV (AP-49) appends, when the option is on, one row `Dirección maestra creada para padrón` (Tabla = address master table,
  Id = padron id) per created record and one row `Padrón enlazado` (Tabla = destination table, Id = padron id) per linked padron. A cut list
  gets its marker (MJ-14) for the created and for the linked lists. No metadata rows.
- AP-59: Safety warning: when the option is on and the destination table name is not `padron`, the review step shows a visible warning,
  in Spanish: "La tabla de destino no es «padron»: se crearán direcciones maestras reales para los ids de esa tabla." It does not block
  the run; the password confirmation of AP-18 is unchanged.
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

- Deleting a destination row that anything still references, that a pair decision is still waiting on, or when the reference scan is blocked
  (AP-102 to AP-108); truncating, re-inserting or renumbering destination rows. Such a missing row is counted and listed only (AP-41). A
  padrón is deleted automatically otherwise, with no user marking. The one referenced padrón that is deleted is a `SUBDIVIDED` one (AP-96) whose
  referencing rows are first reassigned to its new parts (AP-109 to AP-115). `REPLACED_ONE`, `PARTIAL` and `ORPHAN` padrones with references are
  kept; reassigning addresses for them is out of scope.
- Comparison histograms and per-department comparison counts. The user and the assistant compare by hand with queries on dev.
- Creating or dropping the destination table, provinces or localities. Creating missing localities is a separate decision (see the monthly spec).
- Accent-insensitive name matching, repair toggles, sequence reset options, preprod/prod runs, index creation, wiki pages beyond the user guide.

## Open questions / assumptions

1. Decision: the former stage 6 "Aplicar padrones" of the monthly spec is removed. Stage 4 inserts and updates in place in the chosen destination table
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

## Revert backup (real run)

Before the COMMIT of a real run, the stage writes a SQL script that reverts exactly what the run changed. An analysis writes nothing and
never reaches this step (AP-88). The script covers only the changed rows (never a dump of the table), and the stage's own SQL never runs it.

- AP-68: No backup, no write. The backup is built inside the real run's transaction, after the apply, the address master pass and the
  report, before COMMIT. If capturing, building, writing, verifying or registering the backup fails, the transaction rolls back and the
  run fails with the Spanish message `No se pudo generar el respaldo para revertir: <detalle>.`, wrapped by
  the transaction's outcome sentence ("Las tablas de destino no fueron modificadas."). A commit is never reached.
- AP-69: Capture. A real run creates the temporary table `padron_revert` (`ON COMMIT DROP`) before the apply. The apply statement exposes the
  old values of each geometry update (kind `U`), each applied pair (`P`) and each inserted row (`I`) through RETURNING and writes them to that
  table in the same statement. Before the address master link pass, the destination rows without `id_address_master` are captured (`A`), and
  the largest address master id is read (AP-70a). The SET lists and the key lists of AP-46 and AP-65 do not change; the apply SQL is the same
  statement as before, and an analysis never runs it.
- AP-70: Contents and order of the script. The file is gzip `padron-revert-<schema>-<table>-<yyyymmdd-HHMMSS>.sql.gz`, with sanitised
  identifiers. It starts with `SET client_encoding = 'UTF8';` (plain SQL, no psql meta-commands, so psql, pgAdmin and any SQL client run the whole file), then header comments (run time,
  destination table, counts per kind, a warning that it reverts only this run's rows and assumes nothing changed them since, the
  `gunzip` and run-the-whole-file instructions (`psql -v ON_ERROR_STOP=1 -f` or any SQL client), that id sequences are not reverted, and, when the link pass ran, the address master rule of AP-70a),
  then `BEGIN;`, then in this order: (a) when the link pass ran, `UPDATE <destination> SET id_address_master = NULL WHERE id IN (...)` in
  chunks of 1000 ids (kind `A`), then the address master deletes of AP-70a in chunks of 1000 ids; (b)
  `DELETE FROM <destination> WHERE id BETWEEN a AND b;` for each run of consecutive inserted ids (kind `I`); (c) `UPDATE` statements that
  restore type_padron, id_cadastral_locality, number and geometry of each pair (kind `P`), and geometry of each update (kind `U`); then
  `COMMIT;`. Each statement's text is produced by the database with `format('%L')`, so escaping is exact; a NULL stays NULL; the geometry is
  written as its EWKB hex (`ST_AsEWKB`), so the SRID is restored exactly.
- AP-70a: Address master deletes. The link pass creates an address master row only for a destination row that had no
  `id_address_master` before it (kind `A`), with urn `cgeo:padron:id:<id>`. The script therefore deletes only those rows:
  `DELETE FROM <addresses_master> WHERE <id column> > <max before> AND <urn column> IN ('cgeo:padron:id:<id>', ...);`, one statement per
  chunk of 1000 kind `A` ids, the urn prefix taken from the subject spec. Rows with a larger id but another urn, and rows with a matching
  urn at or below the saved max, are never deleted. The max is read fail closed: a missing or non-numeric value fails the backup (AP-68)
  and rolls the run back; an empty table legitimately reads 0.
- AP-71: Only changed rows. The script covers the kinds `U`, `P`, `I` and `A` only. Its size grows with the rows the run changed, not with
  the size of the destination. The `A` kind holds every destination row that had no address master before the link pass, so it may include
  rows the pass left unlinked; restoring NULL on them changes nothing.
- AP-72: Verification before COMMIT. The lines written per kind equal the rows of the temporary table per kind. The `U`, `P` and `I` counts
  equal the apply outcome (`updated`, `paired`, `inserted`). Any mismatch throws, which rolls back the run (AP-68).
- AP-73: Storage and download. Files go to `<os tmp>/gis-tools-routine-jobs`. Each one is registered under a random token (UUID) in
  memory. A real run that created the file returns `backup: { token, fileName, bytes, counts }` in its result, also when the commit outcome
  is unknown. `GET routine-jobs/actualizar-padron/backup?token=<uuid>` streams the file as `application/gzip` with
  `Content-Disposition: attachment; filename="<fileName>"`, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. The folder is
  created private (mode 0700) and the stage refuses it when it is a link or belongs to another user; files are created 0600. A missing token answers `400`; an unknown token, or a file that is no longer on
  disk, answers `404` with a Spanish error. The client never supplies a path.
- AP-74: Retention. Each registration removes backup files older than 7 days from the directory and their tokens from memory. Tokens live in
  memory: after a server restart the files stay on disk until the retention removes them, but their tokens no longer resolve.
- AP-75: The tool never executes the revert file. Its `DELETE` statements are text in the file only; the stage's own SQL keeps AP-46 (no
  DELETE and no TRUNCATE). The temporary table needs the TEMP privilege on the database; a role without it fails the run with AP-68.
- AP-76: Planned steps. A real run lists `Generar respaldo para revertir` right before `Confirmar cambios`. An analysis lists no backup
  step (AP-23).
- AP-77: Automatic download. After a real run whose result has `backup`, the report's backup section downloads the file by itself: it calls
  `GET routine-jobs/actualizar-padron/backup?token=<token>` and saves the response with `backup.fileName` (browser download, Downloads or
  the browser's save dialog). A dry run, or a result without `backup`, downloads nothing and shows no section.
- AP-78: Once per token. The client keeps a set of tokens already downloaded automatically, in memory and mirrored to sessionStorage. A
  re-render, a remount of the result step or a repeated effect never downloads the same token twice in the session. Without storage the
  in-memory set still applies and the UI works.
- AP-79: Section content. The section `Respaldo para revertir` shows the file name, its size in MB with one decimal, the counts of
  `Geometrías actualizadas`, `Claves actualizadas`, `Padrones insertados` and `Padrones sin dirección maestra antes del enlace`, and the
  button `Descargar respaldo` (secondary, with the download icon). The button downloads the same file on each click; it is not limited by AP-78.
- AP-80: Failure. A failed automatic download (no connection, `400`, `404`) never throws into the page: the section shows the Spanish error
  text `No se pudo descargar el respaldo.` with the server message near the block, and the button stays usable to retry.
- AP-81: Instructions. Three Spanish lines explain how to revert (gunzip the file and run the whole .sql against the database with psql or any SQL client; it reverts only
  this run's changes and assumes nobody changed those rows since), that the server keeps a temporary copy for 7 days, and that the download
  links stop working after a server restart.
- AP-82: No folder, no setting. The UI asks for no folder and no option: the browser decides where the file is saved.

## Refresh suggestion (materialized views)

- AP-83: The stage never refreshes `mv_padron` and `mv_padron_wms` (the view names are a named constant list, in order). After a real run
  whose target changed or may have changed (`targetModified` or an unknown commit outcome, and inserted + updated + applied pairs + removed
  (AP-106) greater than 0 — a run that only deletes padrones still modifies the destination) the report shows the section
  `Siguiente paso sugerido`, after the backup section and before the KPI cards. Its text is the Spanish sentence "Las vistas
  materializadas de padrones no se actualizan solas. Refrésquelas, en este orden, para que el mapa y el WMS muestren los cambios:" and
  its statement block has two lines, in this order: `REFRESH MATERIALIZED VIEW "<schema>"."mv_padron";` then
  `REFRESH MATERIALIZED VIEW "<schema>"."mv_padron_wms";`, with identifiers quoted and `<schema>` the schema of the destination table. No
  copy button. A dry run and a run that changed nothing show no suggestion. The tool never runs the statements.

## Acceptance criteria count

AP-1 to AP-7b, AP-9 to AP-14 (AP-8 removed), AP-15 to AP-36, AP-37 to AP-49, with AP-2b, AP-7b, AP-10b and AP-32b. AP-64 to AP-67 are the
pairs of reclassified and renumbered padrones, AP-84 and AP-85 are their loose tier and its report, and AP-86 is the user's choice for an ambiguous group, AP-87 its control in the dry-run report. AP-50 is the
destination key-format check. AP-51 to AP-60 are the address master link option. Criteria AP-26 and AP-49 are the shared-store and CSV
criteria. AP-61 is the inconsistencies list. AP-62 is the table defaults and the locality hint. AP-63 is the locality table reference
check (preflight, refusal or warning). AP-68 to AP-76 (AP-70a included) are the revert backup of a real run (no backup, no write; capture; script contents;
changed rows only; verification; storage and download; retention; the tool never runs the revert file; planned step). AP-77 to AP-82 are
the UI of that backup (automatic download once per token, section content, fallback button, failure text, instructions, no folder setting).
AP-83 is the refresh suggestion after a real run that changed the destination (materialized views `mv_padron` and `mv_padron_wms`).
AP-88 is the read-only analysis, AP-89 the plan record it stores (fingerprints, TTL, no password), AP-90 the server-side guard of a real run
and AP-91 the wizard flow built on them (one analysis button, the persist panel on the analysis result, its guards and the refused-persist action). AP-92 is the geometry threshold gate, AP-93 the pending loose pairs and AP-94 the locating columns of the two lists.

AP-95 is the pending geometry CSV endpoint and AP-96 the replacement classification of the missing padrones. AP-97 is the read-only geometries endpoint of the map, AP-98 the map panel with the Catastro data (and the review inside it) and AP-99 the acceptance of the pending loose pairs. AP-100 is the acceptance of pending geometry changes and AP-101 the removal-mark selection (UI) of the missing padrones. AP-102 to AP-108 are the real deletion they drive: the `pg_catalog` reference scan (also read by AP-96's `refs`), delete-eligibility, the request, the classification counts and digest entry, the apply statement and its revert kind `D`, the planned step, and the report/UI.

## Pending geometry CSV and missing padrones review

- AP-95: Pending geometry CSV. `GET /api/m/routine-jobs/actualizar-padron/pending-csv?planId=<id>` returns every pending geometry change of the
  analysis that stored the plan `<id>` (AP-89), uncapped, as `text/csv; charset=utf-8` with a UTF-8 BOM and the header
  `Tipo,Provincia,Departamento,Localidad,Padrón,Id actual,Área anterior (m²),Área nueva (m²),Área no coincidente (%),Latitud,Longitud`. `Tipo` is the
  padrón type, `Provincia` the province id, `Departamento` and `Localidad` the staging names (empty cells are "sin dato"), `Id actual` the
  destination id. `Área no coincidente (%)` is the non-overlapping share of the combined area of the old and new geometry (0 identical, 100
  disjoint; the symmetric difference over the union, AP-92). Rows are ordered by `Área no coincidente (%)`, largest first, missing values last. The plan id is the same kind of secret as the backup
  token (AP-77): the client sends the id only, never a path. Errors: a missing or malformed `planId` answers `400` with `El identificador del plan no
  es válido.`; an unknown plan answers `404` with `El plan del análisis no existe: vuelva a analizar.`; an expired plan answers `410` with
  `El plan del análisis caducó: vuelva a analizar.`. The file is not removed on download: it lives as long as the plan (AP-89). The analysis result
  shows the button `Descargar geometrías pendientes (CSV)` (Lucide `Download`) when the result is an analysis and `geometryPending` is greater than
  0. A real run consumes its plan (AP-90), so the result of a real run offers no pending CSV.
- AP-96: Missing padrones review. A destination padrón that no staging row carries and no applied pair claims (the `Faltante en destino` of AP-41)
  is classified against the new padrones that no applied pair consumes (the rows the insert would add, AP-42), of the same `id_province` (the
  province rule of AP-64), with a valid geometry on both sides. The overlap is the intersection area over the old area; a new padrón is a part
  when it covers at least `REPLACEMENT_PART_MIN_PCT` (5 %) of the old area. The classes, in this order of tests: `REPLACED_ONE` when one part covers
  at least `REPLACEMENT_COVER_MIN_PCT` (90 %) of the old area; `SUBDIVIDED` when two or more parts exist and their union covers at least 90 %;
  `PARTIAL` when the union covers at least `REPLACEMENT_PARTIAL_MIN_PCT` (50 %); otherwise `ORPHAN` (also when there is no overlap or the old
  geometry is invalid). `coveredPct` is the union of the parts, one decimal. `parts` lists up to `REPLACEMENT_PARTS_LIMIT` (5) replacing padrones
  as `tipo número (x.x %)`, largest cover first. The thresholds and limits are constants of `constants.ts`.
  The report carries the exact counts per class (`missingByClass`: subdivided, replaced one, partial, orphan) and `missingReview`: the rows ordered
  by class in the order SUBDIVIDED, REPLACED_ONE, PARTIAL, ORPHAN and then department, locality and padrón, capped at `DETAIL_LIST_LIMIT` (500).
  Each row carries `oldId`, `typePadron`, `provinceId`, `department` and `locality` (the destination locality name), `number`, `oldAreaM2`,
  `centroidLat` and `centroidLon` of the OLD geometry (WGS84, six decimals), `class`, `coveredPct`, `parts`, `partKeys`, `refs` and `removalReason` (AP-103; null when the padrón will be deleted). `refs` is
  `{ total, byTable }`: the rows of every `<carto schema>` table the catalog scan of AP-102 finds with an `id_padron` column, whose `id_padron`
  is the old id. The scan, and so `refs`, is never limited to `access_point`: a table added to the schema later is
  covered without a code change. The counts are one grouped aggregate per found table over the old ids of every missing padrón (one scan per table, never one
  per listed row), read-only. `refs.total` is zero when no referencing row exists; a scan that finds no table, or a table the role cannot read,
  blocks the deletion instead (AP-102).
  The overlaps of the classification are read from the destination's geometry index, one bounding-box lookup per new padrón.
  The real run's classification (AP-90) reads no replacement block: its report carries no `missingReview` and every `missingByClass` count is zero; the analysis is the only place that shows them. The review is informational: it writes nothing, deletes nothing, changes no planned write and is not part of the
  plan digest (AP-89). The analysis report shows the section `Padrones que ya no están en el catastro` with the counts per class and the capped table; its
  CSV `Descargar padrones faltantes` is built in the browser from the listed rows. A real run's report shows only the line `La clasificación de padrones que ya no están en el catastro se muestra en el análisis previo.` and no CSV button.
  The listed row also carries `partKeys` (AP-98): for each part of `parts`, in the same order, its `typePadron`, `number` and `locality` (the staging
  locality name, null for a rural part). The field is read from the same parts query and is optional in the type, so older results still load.
- AP-97: Geometries endpoint (read-only). `POST /api/m/routine-jobs/actualizar-padron/geometries` returns the outlines of up to
  `GEOMETRY_MAP_ITEMS_LIMIT` (6) padrones for the map of AP-98. The body carries `connection` (as the start endpoint, the password only in the body),
  `stagingSchema`, `stagingTable`, `cartoSchema` and `targetTable` (the map reads the staging and the destination table only), and `items`: a list
  of 1 to 6 entries, each with an optional `oldId` (an integer: the destination id) and an optional `staging` object `{typePadron, department,
  locality, number}`. An entry carries at least one of them. `typePadron` is `RURAL` or `URBANO`; `locality` is required for `URBANO` and ignored
  for `RURAL`; `number` is digits only. The answer is `200 { success: true, features }`, where each feature is `{ itemIndex, role, label, geometry }`:
  `role` is `old` for an `oldId` and `new` for a `staging` key, `itemIndex` is the entry it answers, `label` is the Spanish name shown in the legend and
  the popup, and `geometry` is a GeoJSON geometry in WGS84 (`ST_AsGeoJSON(ST_Transform(ST_SimplifyPreserveTopology(geom, tolerance), 4326))`). The
  tolerance is 2 m; an outline over 1 km² takes 5 m and one over 100 km² takes 20 m, so the payload stays small. The old outline is the destination row
  with that id; the new outline is the union of the staging rows that match the key: `upper(nomdepto)` equals `upper(department)` (the province rule
  of AP-64), `unidadcat` equals `typePadron`, `trunc(padron)::text` equals `number`, and `upper(nomloccat)` equals `upper(locality)` for an `URBANO`
  key. Staging geometries in another SRID are transformed to the destination SRID first, as the classification does. Identifiers are checked by the
  catalog (the same table resolution as the analysis, required columns and polygonal geometry); values are bound parameters, never interpolated.
  The read runs in one `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY` transaction, rolled back at the end, with `SET LOCAL statement_timeout` of
  20 s. Errors: a malformed body or item answers `400` with a Spanish message; a missing destination id, a staging key with no rows or a row
  without geometry answers `404` (`No existe un padrón de destino con id <id> y geometría.` or `No se encontró <padrón> en la tabla de origen.`);
  a timeout answers `500` with `La lectura de las geometrías tardó demasiado. Pruebe de nuevo con menos padrones.`; any other failure answers `500`
  with `No se pudieron leer las geometrías:` and the database message, with the password scrubbed. Nothing is logged. The route is declared in
  `module.routes.json` and generated with `npm run modules:routes`.
- AP-98: Map modal, labels and Catastro data (UI). Each row of the pending geometry change table, of the pending pairs table, of the ambiguous group cards and of
  the missing padrones table has a `Ver en mapa` icon button (Lucide `Map`) in its FIRST column; the column is sticky to the left inside the
  table's scroll box, so the button stays visible when the table scrolls sideways. The button opens a modal dialog over the report (not a panel):
  `role="dialog"`, `aria-modal`, labelled by the padrón title; the map takes most of the dialog height. Escape, the close button (Lucide `X`) and a
  click on the backdrop close it; focus moves into the dialog and returns to the row button on close; the page behind does not scroll while it is
  open; on mobile widths the dialog fills the screen and the map takes 60 % of its height above the details. The map shows ONLY the selected padrón:
  the old outline in one colour and the new outline in another (for a missing padrón, the old outline and each replacing part), with the legend of
  the shared map (`Padrón anterior`, `Padrón nuevo`). Every outline has a permanent minimal label built from the subject: `TIPO NÚMERO · anterior` for
  the old outline (`RURAL 1345 · anterior`), `· nuevo` for the new one and `· parte` for each replacing part of a missing padrón. The outlines are
  fetched lazily through AP-97 with the connection of the wizard, and cached by item (the old id and each staging key) for the life of the modal. The
  password is read from the wizard state: without it the modal asks in Spanish to type the password on the connection step. Loading shows
  `Cargando geometrías…`; a failure shows the server's Spanish message and `Reintentar`. Before any click the details area shows
  `Haga clic en un padrón del mapa para ver todos sus datos.`. A click on an outline selects it: it is drawn highlighted, the map centres on it, and
  its details replace the hint; a click on another outline switches the selection; a click on empty map clears it. Clicks open no map popup. The
  details of the selected outline only list Tipo, Departamento, Localidad, Número, Id actual, the areas (m²), the area difference (new minus old, m²),
  the change (`Cambio de área (%)` for a pair, `Área no coincidente (%)` for a changed geometry), and the centroid (WGS84). A pair's new outline also
  shows its old key (`Clave anterior`). The block `Datos para buscar en Catastro` lists, for the NEW padrón of the selected outline (Tipo,
  Departamento, Localidad catastral and Número), each with a copy button; the old outline shows `No hay padrón nuevo que buscar en el catastro.`.
  The map is not shown for a padrón whose keys cannot name a staging row (a missing department, an URBANO row without locality or a non-digit
  number): only its old outline is asked for then.
  Amendment (review inside the modal): the modal receives the ordered rows of the table it was opened from and the index of the row on screen.
  Above the map it shows `Anterior` and `Siguiente` (Lucide `ChevronLeft` / `ChevronRight`, disabled at the ends) and `N de M`; moving keeps the
  dialog open, keeps the outline cache and clears the outline selection. The details column starts with the decision of the row, read live
  from the wizard state, by kind: a geometry change (AP-100: its state `Aceptada`, `Pendiente`, `Rechazada` or `Aplicada (bajo el umbral)` and,
  when decidable, `Aceptar` / `Rechazar`); a pending loose pair (AP-99: `Aceptar` / `Rechazar`, state `Aceptado` or `Pendiente`); an ambiguous pair
  or group (AP-87: its candidates as radio options plus `No emparejar (insertar como nuevo)`, each candidate numbered `candidato N` with a colour
  swatch; the map shows the new outline and every candidate's old outline, up to five, each in a distinct colour of `MAP_CANDIDATE_TYPES` with
  the label `TIPO NÚMERO · candidato N (id <id>)` and the legend `Candidato N`); a missing padrón (AP-101: its class, `Reemplazado por`, `Cubierto
  (%)` and `Referencias` shown prominently, and its read-only removal status). No applied pair is listed, so none opens the modal. The modal's `Anterior` / `Siguiente` rows are those of the list it was opened from: the pending geometries, the pending pairs, the ambiguous groups or the missing padrones. The decision panels of
  geometries, pending pairs and groups also carry `Volver a analizar con la selección` in an analysis. Each ambiguous group card has its own
  `Ver en mapa` button; the modal's copy of the card uses its own radio name. The tables carry a `Decisión` column: the pending pairs table shows the
  acceptance of a pending pair (`Aceptado` / `Pendiente`); the ambiguous groups show their choice in the radios;
  the geometry table the state of AP-100; the missing table has the read-only `Eliminación` column of AP-101. A real-run result shows the same modal
  read-only.
- AP-99: Accepting the pending loose pairs (UI). The analysis result has the section `Pares por coincidencia parcial pendientes` with every pair of the
  report list whose status is `NOT_APPLIED_PENDING` (AP-93): its departamento and localidad (the new padrón), the old key (tipo, localidad, padrón and
  id) and the new key (tipo, padrón), the area change (signed, AP-94) and the state. Each row has `Aceptar` and `Rechazar` and the `Ver en mapa` button of
  AP-98. `Aceptar` adds the pair as a choice `{typePadron, provinceId, localityId, number, oldId}` to the pair choices of the wizard (the same choices
  the ambiguous groups use, AP-86); `Rechazar` removes that choice. `Aceptar` is disabled when the pair is blocked: another new key already chose the
  same old id (the request refuses it, AP-86). The header actions are `Aceptar todos` (every open pair of the list, each old id once) and
  `Rechazar todos` (removes the choices of the list), and the counter reads `N aceptados de M pendientes` (with the blocked count when there are
  blocked pairs). When the list is capped at `PAIR_LIST_LIMIT` (5000) the section says so: `Aceptar todos` then acts only on the listed pairs. A
  choice does not apply the pair by itself: a pending pair becomes `APPLIED` only after `Volver a analizar con la selección` (the same button and the
  same guard as AP-86 and AP-91); pressing the persist instead re-analyzes automatically with the selection and then persists (AP-91). The section is read-only in a real run result. Bulk changes are one
  state update (`pairChoicesChosen` and `pairChoicesRemoved` in the wizard reducer), so a long list stays linear. The state of an open pair reads
  `Pendiente` (it read `Sin aceptar` before AP-100). The bulk controls, counter, notes and re-analysis button are the shared component of the pending section (read-only in a real run); bulk acceptance never
  picks an ambiguous pair, which is chosen one by one in its group card.
- AP-100: Accepting pending geometry changes. The start request takes `options.acceptedGeometries`, a list of `AcceptedGeometry` keys
  `{typePadron, provinceId, localityId|null, number}` (the new key of a `CHANGED` row, as a pair choice without `oldId`); absent means `[]`.
  Validation, as an invalid request naming `acceptedGeometries` in Spanish: not a list (null included); an entry that is not an object, whose
  `provinceId` or `localityId` is not an int4 integer (`localityId` may be null), whose `typePadron` is not `RURAL` or `URBANO`, or whose `number`
  is not filled text; the same key twice; more than `PAIR_LIST_LIMIT` (5000) entries. The list is rejected, never truncated. The classify
  statement builds a typed `geometry_accepts` VALUES CTE (strings escaped with `literal()`, integers validated, a typed empty CTE when there is
  none) and the `changed_geometry` CTE marks each row `accepted` when its key (NULL-safe on the locality) is in it. A row is applied when
  `Actualizar geometrías` is on AND (its destination geometry is NULL, OR its ratio is below the threshold, OR it is accepted). The counts
  (`updates`, `geometry_pending`), the UPDATE, the digest, the lists and the CSV of AP-95 all read that CTE, so an accepted row is `APPLIED`
  everywhere and is a planned write. The list is part of `paramsFingerprint` (sorted, AP-89). The classify result carries
  `geometry_accepts_unapplied`: the accepted keys with no applied `CHANGED` row (gone, no longer `CHANGED`, or `Actualizar geometrías` off), mapped
  to `geometryAcceptsUnapplied` of the target report (optional: older results lack it) and, when greater than zero, the warning "N geometrías
  aceptadas no se aplicaron (el padrón ya no tiene un cambio de geometría o Actualizar geometrías está desactivado)." (singular "1 geometría
  aceptada no se aplicó ..."). UI: the wizard state keeps `acceptedGeometries` and `simulatedAcceptedGeometries` (those of the last completed
  analysis, from the run plan); they are sent by the analysis and the persist (only when there is one), cleared on the same events as the pair
  choices, seeded from the run plan on a remount, and, while they differ (order-insensitive), the guard `simulationBlockingReason` reads "Analice de nuevo con las geometrías aceptadas actuales antes de
  persistir." after the pair-choice reason; the persist no longer blocks on it but analyzes again with the selection first (AP-91). Reducer actions `geometriesAccepted` and `geometriesRejected`
  (bulk, keyed by the new key). The pending geometry table, in an analysis with `Actualizar geometrías` on, has the counter `N aceptadas de M
  pendientes (listadas)` (M: the listed rows that can be decided), `Aceptar todos` (the listed rows still pending, stopped at the
  5000 limit with a Spanish note), `Rechazar todos` (every acceptance), `Volver a analizar con la selección`, a `Decisión` column and per-row
  `Aceptar` / `Rechazar`. Decision states: `Aceptada` (the key is in the current acceptances), `Pendiente` (pending in the shown run and not
  accepted), `Rechazada` (applied in the shown run because it was accepted, acceptance removed since) and `Aplicada (bajo el umbral)` (nothing to
  decide). With `Actualizar geometrías` off the modal says that geometries cannot be accepted; a real-run result is read-only. The review lists
  `N geometrías aceptadas incluidas`. The pending CSV of AP-95 and its button are unchanged.
- AP-101: Removal status (UI, read-only; the write is AP-102 to AP-108). There is no marking step: a missing padrón (AP-96) is deleted by a real
  run automatically when nothing references it and no pair decision is open (AP-103). In an analysis, a missing padrón opened in the map modal, and
  the `Eliminación` column of the missing padrones table, show the status the server computed for it (`removalReason` of AP-96, never decided in the
  browser): `Se eliminará` (no references, no live pair), `No se elimina: tiene N direcciones asociadas (<tabla>: <n>, ...)` (the `refs.byTable`
  breakdown), `No se elimina: tiene un par sin resolver` or `No se elimina: no se pudieron verificar sus referencias` (the reference scan was
  blocked, AP-102). There are no buttons, no wizard state, no request field and no marks CSV; the missing padrones section keeps its own CSV
  (AP-96) and the note about faltantes waiting on a pair decision. The persist panel summary (AP-91) reads "Se aplicarán: N padrones nuevos, M
  pares actualizados, K geometrías actualizadas, R padrones eliminados." and the result shows the removal section of AP-108.

## Deletion of unpaired padrones (real; AP-102 to AP-108)

A destination row the staging table no longer carries, that no pair decision is waiting on and that nothing references, is deleted in a real
run, with no marking step. This is the one exception to "nothing is deleted" (Out of scope): every other destination row is left exactly as the
rest of this spec says. Because this is a mass destructive action it fails closed (AP-102) and its count is always shown (AP-108).

- AP-102: Reference scan (`pg_catalog`, not a hardcoded table list). A preflight query, in dry run and real run alike, lists every
  table of `cartoSchema` other than the destination table that carries a column named `id_padron`:
  `SELECT n.nspname, c.relname, has_column_privilege(c.oid, a.attnum, 'SELECT') AS readable FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid =
  c.relnamespace JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid WHERE n.nspname = $1 AND c.relkind IN ('r','p') AND NOT (c.relname =
  ANY($2::text[])) AND a.attname = 'id_padron' AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid IN ('int2'::regtype, 'int4'::regtype,
  'int8'::regtype, 'numeric'::regtype)`, `$1` bound to `cartoSchema` (never the literal `'carto'`) and `$2` to the destination table name. The
  type filter is required, not optional: without it, a table that happens to carry an `id_padron` column of a non-numeric type would be
  scanned and its count query would throw a type-mismatch error against the integer id set. This is the same technique as `address-dedup`'s
  `MASTER_REFERENCED` blocker (`src/modules/address-dedup/services/queries/resolveRemovalPlan.ts`), adapted: scoped to the user's
  `cartoSchema` instead of a literal schema, and matching `id_padron` (this stage's own foreign-key-less reference column, MJ-13) instead of
  the address-master columns that module scans for. The readable tables feed one grouped `count(*) ... GROUP BY id_padron` per table over the
  set of missing ids (never one query per row); this is `refs` of AP-96 and the deletion gate of AP-103, the same scan and the same counts for
  both. **Fail closed**: the scan blocks every deletion of the run when it finds no table at all ("No se encontraron tablas que referencien
  padrones: no se eliminan padrones faltantes.") or when the role lacks SELECT on any found table (a warning naming the table(s): "No se pueden leer las
  tablas que referencian padrones (<schema.tabla>, ...): no se eliminan padrones faltantes."). A table that cannot be read is never read as zero
  references. A blocked scan deletes nothing, reports `removalBlockedReason` (the same Spanish text, also a run warning) and marks every
  padrón that is not held back by a pair or by a reference as `UNVERIFIED`; the run still does everything else. A count query that errors
  anyway (a table dropped between the catalog read and the count) fails the whole transaction, which rolls back: nothing is deleted.
- AP-103: Delete-eligibility. A destination row is delete-eligible, read fresh at classify time (both dry run and real run), only when all of:
  (a) it has no staging candidate and no applied pair claims it (`missing_old` of AP-96, unchanged); (b) it is not the old side of a
  `NOT_APPLIED_PENDING` or `NOT_APPLIED_AMBIGUOUS` pair candidate of the same run (a live pairing decision must be resolved, accepted or
  rejected, before the row becomes eligible — a candidate pruned by a choice, AP-86, no longer blocks); (c) its `refs.total` (AP-102) is zero and
  the scan is not blocked. The first condition a missing padrón fails after (a) names its reason, in this order: `STILL_PAIRABLE` (b),
  `NOW_REFERENCED` (c), `UNVERIFIED` (blocked scan); no reason means the padrón is deleted. Eligibility is not a write by itself: AP-105 and
  AP-106 count and apply it.
- AP-104: Request. The request carries nothing about removals: there is no `options.removalMarks`. The set of padrones to delete is computed by
  the server (AP-103) and is covered by the plan digest (AP-105), so `paramsFingerprint` (AP-89) is unchanged by it.
- AP-105: Classification counts. The classify statement (`buildPadronClassifySql`) adds `removed` (the delete-eligible count over every missing
  padrón, not only the listed ones) and `removalsSkipped` (the missing padrones that are not deleted, grouped by reason: `STILL_PAIRABLE`,
  `NOW_REFERENCED`, `UNVERIFIED`), mapped to `target.removed` and `target.removalsSkipped` of the report. `removed` is a planned write. The
  report also carries `removedList` (the first `DETAIL_LIST_LIMIT` delete-eligible padrones: id, tipo, provincia, localidad, número). The digest
  of AP-89 gets one entry for the whole deletable set (tag `"D"`, its size and an md5 over its sorted ids), so a real run's plan-changed guard
  (AP-90) also covers the deletable set without a row per padrón. A warning says how many padrones are deleted ("N padrones sin fila de origen se
  eliminarán / eliminados de <tabla> (sin direcciones asociadas o con direcciones reasignadas a sus partes)."), one how many are not and why, and the "sin fila de origen: se listan, no se
  modifican" warning counts only the missing padrones that are kept.
- AP-106: Apply. A real run only, and its own statement, after `Aplicar cambios de padrones` (never a CTE inside that statement's WITH chain):
  by the time it runs, the inserts, geometry updates and applied pairs have already happened in the same transaction, so a row an applied pair
  just consumed already carries its new key and is correctly no longer a delete candidate. **Scale**: the delete-eligible ids are never an inline
  VALUES list nor a JSON column. The real run creates a session temp table (`CREATE TEMP TABLE padron_delete_ids (id integer PRIMARY KEY) ON COMMIT
  DROP`) before its classify, and that classify statement (the one AP-90 already runs for the plan-changed guard) fills it set-based through a
  data-modifying CTE (`INSERT INTO padron_delete_ids SELECT ... FROM removal_verdicts WHERE reason IS NULL`), while returning only the counts, the
  capped `removedList` and the digest. The analysis never creates the table: it computes the same set in its READ ONLY transaction as a CTE and
  returns counts and the capped list. The delete statement reads the candidates from the temp table and only re-checks condition (c) of AP-103
  (the reference scan over those ids) for staleness — conditions (a) and (b) are already covered by that classification matching the plan's
  digest, so they are not re-derived here. `DELETE FROM <destination> WHERE id IN (<temp ids whose refs.total is still zero>) RETURNING *`. An id
  whose refs.total is no longer zero is **skipped**, not a run failure: it is not deleted, it is counted in the real run's own
  `removalsSkipped` (reason `NOW_REFERENCED`), and every other write of the run (inserts, geometry updates, pairs, and the rest of the deletes)
  commits normally. The count check (as AP-48): deleted rows equal the surviving delete-eligible count, or the whole transaction rolls back. The
  `addresses_master` rows of the deleted padrones are deleted by AP-114; no other column or table is touched by this statement.
  Revert: `REVERT_KIND.DELETED = "D"`. Because a deleted row's revert is a full `INSERT`, not a partial restore like `U`/`P`, the `padron_revert`
  temp table (`revertCapture.ts`) gets two more nullable columns, `id_province` and `id_address_master`, populated only for kind `D` rows; the
  `DELETE ... RETURNING` captures the whole row into them before COMMIT, inside the same capture pass as AP-69. The revert script (AP-70) gets one
  more block, after the `P`/`U` restores: one `INSERT INTO <destination> (id, type_padron, id_cadastral_locality, id_province, number, geometry,
  id_address_master) VALUES (...)` per kind-`D` row, `format('%L')`-escaped, geometry as `ST_AsEWKB` hex, the `id` explicit (ids are not
  reverted, as the rest of AP-70 already notes). The verification of AP-72 is extended: the `D` lines written equal the deleted count.
- AP-107: Planned step. A real run's planned steps (AP-23) add `Eliminar padrones faltantes sin referencias`, after the pair apply step and before
  `Analizar tabla de destino`. An analysis has no delete step: it only computes `removed`, `removalsSkipped` and `removedList` for preview, writing
  nothing (consistent with AP-88, which already reads no sequence-repair, apply, backup or address-master step).
- AP-108: Report and UI. The target report carries `removed`, `removalsSkipped` (`{ total, byReason }`, the reasons of AP-103), `removedList` and,
  when the scan was blocked, `removalBlockedReason`. The review of an analysis and the result of a real run show a removal section, prominent
  before the other lists of the destination: "Padrones que se eliminarán: R (sin direcciones asociadas o con direcciones reasignadas a sus partes)" (a real run: "Padrones eliminados: R
  (sin direcciones asociadas o con direcciones reasignadas a sus partes)"), the `removalBlockedReason` when set, the not-deleted breakdown by reason ("No se elimina: tiene direcciones
  asociadas", "... tiene un par sin resolver", "... no se pudieron verificar sus referencias"; a real run: "No eliminada: <motivo>") and a
  collapsible list of the removed padrones, "primeras N de M" when cut at `DETAIL_LIST_LIMIT`, with a state column (`Se eliminará` in an
  analysis, `Eliminada` in a real run). `ActualizarTargetSection` also adds the count row `Eliminadas` and the KPI card `Eliminadas`.
  `ActualizarPersistPanel`'s one-line summary (AP-91) always ends with "R padrones eliminados" ("1 padrón eliminado"). `ActualizarBackupSection`
  (AP-79) adds `Padrones eliminados` to its displayed counts when the backup carries any kind-`D` rows. The CSV of AP-49 adds one `Eliminada` row
  per deleted padrón (the `removedList`; old key columns filled, `Id` the deleted destination id); a cut list gets the marker row of AP-49 like
  every other kind.

## Reassignment of a subdivided padrón's addresses (real; AP-109 to AP-115)

A destination padrón that two or more new padrones cover (`SUBDIVIDED`, AP-96) cannot be paired one to one (AP-64). Its referencing rows are moved to the
new part nearest to each of them, then the old padrón and its `addresses_master` entry are deleted, all in the real run's transaction. Fail closed,
like AP-102: whatever cannot be moved with certainty keeps the old padrón and everything that points to it.

- AP-109: Scope. A missing padrón is reassignable when it is `SUBDIVIDED` (AP-96, computed in the analysis and in the persist classify alike, so the
  set is identical), it is not held back by a pair (`STILL_PAIRABLE`, AP-103 b), the reference scan is not blocked (AP-102), it has at least one
  reference (refs.total > 0) and every found referencing table is reassignable (AP-110). `REPLACED_ONE` (one part covers 90 % or more: the pair of
  AP-64 updates it), `PARTIAL` and `ORPHAN` are never reassigned. The receivers of a padrón are its `parts` of AP-96 (new padrones of the same
  province covering at least `REPLACEMENT_PART_MIN_PCT` of its area), after the apply: the rows this run's insert added.
- AP-110: Reassignable table and where the point comes from. A table found by AP-102 is reassignable when the catalog (`pg_index.indisprimary`) gives
  it a primary key of exactly one column and a point source exists, in this order: (1) the table has exactly one `geometry` or `geography` column of
  its own; (2) otherwise a fixed entry of `REFERENCE_POINT_SOURCES` in `constants.ts` names a companion table in the same schema and the join
  (`access_point` takes its point from `address.geometry`, joined `address.id = access_point.id`: the schema has no foreign key between them);
  the companion must itself have exactly one geometry column and a one-column primary key, read from the catalog like (1). A table with neither source,
  a composite or missing primary key, or several own geometry columns and no entry makes only the padrones it references `NOT_REASSIGNABLE`
  (kept, listed, the table named); it never blocks the other padrones. The point of a row is its geometry when it is a point, otherwise
  `ST_PointOnSurface`, transformed to the destination geometry's SRID when the SRIDs differ. A referencing row whose point is missing (no
  companion row, or a NULL or empty geometry) does not block its padrón: it is assigned by the fallback of AP-111.
- AP-112: Classification and digest. The classify statement adds `reassigned` (the referencing rows the real run will move, over every table) and
  `subdividedDeleted` (the padrones it will then delete), the new removal reason `NOT_REASSIGNABLE` (precedence in AP-103: `STILL_PAIRABLE`, then,
  for a padrón with references, `NOT_REASSIGNABLE` when it is `SUBDIVIDED` but not reassignable, else `NOW_REFERENCED`, then `UNVERIFIED`), and one
  digest entry (tag `"S"`, count and md5 of the sorted padrón ids and of the reference counts per table), so AP-90's plan-changed guard covers the
  reassignment set. The analysis computes the same numbers against the staging candidates that the insert would add; it writes nothing.
- AP-113: Apply. A real run only, two statements after `Aplicar cambios de padrones` (the parts exist by then) and before the delete statement of
  AP-106. The apply statement keeps the ids it inserted in a session temp table so the receivers are exactly this run's inserts. The reassign
  statement updates `id_padron` of every referencing row of every found table to its nearest receiver, captures each old value for the revert
  (kind `R`: table, primary key value, old `id_padron`), and adds the padrón ids whose references reached zero to `padron_delete_ids` (AP-106). Its
  count check, as AP-48: rows moved equal the rows counted by the classification, or the whole transaction rolls back.
- AP-114: Master entry. When a padrón is deleted (AP-106; the subdivided ones of this section and the unreferenced ones alike), the
  `addresses_master` row its `id_address_master` points to is deleted in the same step, unless another destination row still carries that
  `id_address_master`. The address master table is assumed to be defined (the stage's address master option); when it is not, a subdivided padrón
  is `NOT_REASSIGNABLE` and an unreferenced padrón is deleted without any master change. A foreign-key violation on that delete fails the
  transaction. Revert, kind `M`: the master row is captured as `to_jsonb(row)` and the script restores it with `jsonb_populate_record` before the
  `D` inserts; kind `R` is restored after them.
- AP-115: Planned steps and report. A real run adds the step `Reasignar direcciones de padrones subdivididos` right after the pair apply step and
  before `Eliminar padrones faltantes sin referencias`. The target report adds `reassigned` and, per table, how many; the removal section of AP-108
  says "Se eliminará (N direcciones pasan a sus partes)" for a subdivided padrón, and "No se elimina: no se pueden reasignar sus direcciones
  (<tabla>: <motivo>)" for `NOT_REASSIGNABLE`. The persist panel summary (AP-91) adds ", D direcciones reasignadas" when D is greater than 0.
  AP-79's backup counts add `Direcciones reasignadas` and `Entradas de direcciones maestras eliminadas`; AP-72's verification checks that the
  `R` and `M` lines written equal the moved and deleted counts. The revert script restores in this order: `M`, then `D`, then `R`.
- AP-111: Assignment. Each referencing row with a point goes to the receiver nearest to it (`ST_Distance`, zero when contained; a tie goes to the
  lowest part id). Nearest wins also when the point is in no part or on a boundary shared by two. A row without a point (AP-110) goes to the receiver
  covering the largest share of the old padrón (AP-96 `parts` order), a tie to the lowest id; the count of such rows is reported
  (`reassignedWithoutPoint`). The padrón's references become zero, so AP-103 (c) holds for it afterwards.
- AP-112: Classification and digest. The classify statement adds `reassigned` (the referencing rows the real run will move, over every table) and
  `subdividedDeleted` (the padrones it will then delete), the new removal reason `NOT_REASSIGNABLE` (precedence in AP-103: `STILL_PAIRABLE`, then,
  for a padrón with references, `NOT_REASSIGNABLE` when it is `SUBDIVIDED` but not reassignable, else `NOW_REFERENCED`, then `UNVERIFIED`), and one
  digest entry (tag `"S"`, count and md5 of the sorted padrón ids and of the reference counts per table), so AP-90's plan-changed guard covers the
  reassignment set. The analysis computes the same numbers against the staging candidates that the insert would add; it writes nothing.
- AP-113: Apply. A real run only, two statements after `Aplicar cambios de padrones` (the parts exist by then) and before the delete statement of
  AP-106. The apply statement keeps the ids it inserted in a session temp table so the receivers are exactly this run's inserts. The reassign
  statement updates `id_padron` of every referencing row of every found table to its nearest receiver, captures each old value for the revert
  (kind `R`: table, primary key value, old `id_padron`), and adds the padrón ids whose references reached zero to `padron_delete_ids` (AP-106). Its
  count check, as AP-48: rows moved equal the rows counted by the classification, or the whole transaction rolls back.
- AP-114: Master entry. When a padrón is deleted (AP-106; the subdivided ones of this section and the unreferenced ones alike), the
  `addresses_master` row its `id_address_master` points to is deleted in the same step, unless another destination row still carries that
  `id_address_master`. The address master table is assumed to be defined (the stage's address master option); when it is not, a subdivided padrón
  is `NOT_REASSIGNABLE` and an unreferenced padrón is deleted without any master change. A foreign-key violation on that delete fails the
  transaction. Revert, kind `M`: the master row is captured as `to_jsonb(row)` and the script restores it with `jsonb_populate_record` before the
  `D` inserts; kind `R` is restored after them.
- AP-115: Planned steps and report. A real run adds the step `Reasignar direcciones de padrones subdivididos` right after the pair apply step and
  before `Eliminar padrones faltantes sin referencias`. The target report adds `reassigned` and, per table, how many; the removal section of AP-108
  says "Se eliminará (N direcciones pasan a sus partes)" for a subdivided padrón, and "No se elimina: no se pueden reasignar sus direcciones
  (<tabla>: <motivo>)" for `NOT_REASSIGNABLE`. The persist panel summary (AP-91) adds ", D direcciones reasignadas" when D is greater than 0.
  AP-79's backup counts add `Direcciones reasignadas` and `Entradas de direcciones maestras eliminadas`; AP-72's verification checks that the
  `R` and `M` lines written equal the moved and deleted counts. The revert script restores in this order: `M`, then `D`, then `R`.


## Accept every pending geometry (AP-116 to AP-118)

`Aceptar todos` (AP-100) only reaches the listed rows (`DETAIL_LIST_LIMIT`) and the accepted list is capped (`PAIR_LIST_LIMIT`), so a run with tens of
thousands of pending geometries cannot be accepted. This section adds an acceptance that never depends on the list.

- AP-116: Request. `options.acceptAllGeometries` (boolean, default false; any other type is rejected like the other options). When true, every
  geometry change that AP-100 would leave pending (the matched key whose geometry differs by more than the threshold, with `Actualizar geometrías`
  on) is accepted, in the analysis and in the real run alike, whatever the list shows. `acceptedGeometries` is still read and its keys are
  accepted as before; with the flag on there is no per-row rejection. The flag is part of `paramsFingerprint` (AP-89), so the plan-changed guard
  and the persist re-analysis (AP-91) cover it. Without `Actualizar geometrías` the flag has no effect and the UI does not offer it.
- AP-117: Classification. The accepted count and the pending count of the classify statement include the geometries accepted by the flag: with it
  on, `geometryPending` is 0 and the updates count (AP-48's count check) grows by the formerly pending ones. The digest of AP-89 stays complete
  (no per-row entry is added; the flag is in the fingerprint). The CSV of pending geometries (AP-95) is empty with the flag on.
- AP-118: UI. The geometry changes section shows the button `Aceptar todas (N)` (Lucide `Check`), N being the total pending count of the analysis
  (`geometryPending`), in place of the listed-rows `Aceptar todos` for geometry changes. Pressing it only sets the flag in the wizard state; no
  analysis starts. The section then reads `Todas las geometrías pendientes aceptadas (N)` (N from the last analysis) and offers `Rechazar todas`,
  which only clears the flag, again without analyzing. If the last analysis was made with the flag on (empty list), clearing it shows `Volver a
  analizar con la selección` to reload the list. Re-analysis happens at Persist, where the guard (AP-91) detects the flag differs from the simulated one. The persist
  panel summary (AP-91) already reports the geometry count. The note says the acceptance applies to every pending geometry, not only the listed ones.

## Localities not found: where they exist (AP-119 to AP-120)

The list of localities not found (AP-16, AP-32b) tells the people who make the shapefiles that a locality name was rejected, not why. A name rejected for its department is very often a name that exists in another department (a wrong department code in the file).

- AP-119: Other departments. Each row of `skipped.byLocalityAndReason` whose reason is `LOCALIDAD_NO_ENCONTRADA` gets `otherDepartments: string[]`: the names of the departments, other than the row's, that have a locality with the same name, compared exactly as the stage matches localities (upper-case equality of the names, no accent folding), in the same locality reference the stage resolves against. The names are sorted, at most 5. It is read in the analysis and in the real run alike, in the same query as the aggregation or one more bounded query over the (at most 20) distinct names, never one query per padrón, read-only, and it is not part of the plan digest (AP-89). The field is optional in the type, so older results still load. Ambiguous localities (`LOCALIDAD_AMBIGUA`) do not get it.
- AP-120: CSV. The section `Localidades no encontradas` has the button `Descargar localidades no encontradas (CSV)` (Lucide `Download`), built in the browser from the listed rows (same family as AP-96's CSV, file name by the same convention, UTF-8 with BOM like the other CSVs). Columns: `Departamento`, `Localidad`, `Padrones afectados`, `Motivo`. One row per listed locality. `Motivo` is `No existe en <departamento>; existe en <D1>[, <D2>...]. Revise el código de departamento.` when `otherDepartments` is not empty, and `La localidad no existe en el departamento.` otherwise. A list that reaches the 20 cap gets a marker row "Lista incompleta: se muestran las primeras 20 localidades no encontradas" (the report keeps no total). The button is hidden when the list is empty. The padrón numbers are not listed (only a capped sample exists).

## Addresses of padrones whose shape changed (AP-121 to AP-124)

When a padrón the run keeps changes its geometry (AP-47 geometry update) or its key (an applied pair, AP-64), some of its addresses can end up outside it and inside another padrón: the address row still carries the old `id_padron`. An address is never moved: only its `id_padron` is reassigned. The coordinates of the address and every other column stay as they are.

- AP-121: Scope and rule. The candidate padrones are the destination rows the run changes and keeps: those whose geometry the apply updates (applied geometry changes, accepted or under the threshold) and those whose key an applied pair updates. A padrón the run deletes is not a candidate (AP-109 to AP-111 cover it), and neither is a padrón the run does not touch. A referencing row (a row of a table found by AP-102 whose point source is defined by AP-110) is reassigned when all of these hold, read after the apply: its `id_padron` is a candidate; its point is not contained (`ST_Contains`) in the geometry its padrón has after the apply; and its point is contained in at least one other padrón of the same province, which then becomes its `id_padron`. When several padrones contain the point, the lowest id wins and the row is counted as ambiguous. A row whose point is missing (AP-110), contained in no padrón, or still contained in its own padrón is never changed: a point outside every padrón is not reassigned to the nearest one, because the padrón is not deleted. Tables that AP-110 marks as not reassignable, and the padrones they reference, are skipped for this rule (counted, never blocking anything else). The rule needs the same privileges and the same primary key and point checks as AP-110; a table that fails them is skipped with the blocker text of AP-110.
- AP-122: Execution. A real run only, its own statement and planned step `Reasignar direcciones de padrones modificados`, after the pair and geometry apply and after the reassignment of AP-113, before the delete step of AP-106. It reads the geometries as they are after the apply (so a new padrón that the same run inserted can be the receiver), updates `id_padron` of the referencing rows by primary key, captures each old value for the revert with the kind `R` of AP-113 (no new kind), and counts the rows it moved and the ambiguous ones. Its own count check, as AP-48: the rows updated equal the rows the statement selected, or the whole transaction rolls back. It is set-based, uses the destination's geometry index, and does not send ids.
- AP-123: Analysis. The analysis reports the planned count (`reassignedChanged`, `reassignedChangedAmbiguous`, and per table) read-only, computed against the geometry each changed padrón will have (the staging geometry for an updated or paired padrón) and against the padrones the insert would add, without writing. If a part of that cannot be reproduced exactly before the apply, the analysis says the count is an estimate. The count is not part of the plan digest (the geometry digest of AP-89 already covers the inputs); the real run's own check (AP-122) is the guard.
- AP-124: Report and UI. The target report adds `reassignedChanged` and `reassignedChangedAmbiguous`. The removal and reassignment section of AP-108 and AP-115 shows "N direcciones cambian de padrón porque su padrón cambió de forma" (analysis: "cambiarán"), and the ambiguous count when above 0. The persist panel summary (AP-91) adds these rows to the reassigned count. The revert backup of AP-79 counts them in `Direcciones reasignadas`. The wording always says that the address's padrón is reassigned (`id_padron`), never that the address moves. The wiki and the refresh suggestion of AP-83 are updated.
