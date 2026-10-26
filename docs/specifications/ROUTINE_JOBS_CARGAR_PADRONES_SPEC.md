# Routine Jobs — "Cargar padrones": acceptance criteria

New module `src/modules/routine-jobs/` (id `routine-jobs`): a shell for recurring database jobs, one wizard per job. First job: **Cargar
padrones**, the monthly population of the padron staging table (`catastro_paispadron` in dev) from the rural and urban cadastre staging
tables. Legacy oracle: the one-time script `Cargando carto.padron.sql`, the two `INSERT INTO bdj_carto.catastro_paispadron` statements
(read-only; outside the repo). The later update of `carto.padron`, the URN step and the diff are NOT part of this spec.

Precondition: the user already loaded `paisrural`, `paisurbano` (and `paislocalidades`, `paisseccion`) with db-shapefile-sync (Replace).

Nothing in the module names a schema, table or column as a literal in SQL or API defaults. Table and schema names come from the user's
selection; column names come from the job's declared logical columns (below) and are resolved against the catalog. String VALUES that
are domain data (`RURAL`, `URBANO`) are not identifiers and are allowed.

## Layering (module_authoring.md)
- `src/core/`: `TableCatalogService` (list tables of a schema, resolve columns) and its types. No React, no `next/*`.
- `src/ui-kit/`: `TableSelector` component and hook (dropdown filled from the service, shows missing columns).
- `src/modules/routine-jobs/`: manifest, `module.routes.json` (+ generated routes), job registry, the "Cargar padrones" job (domain SQL
  builders, runner, handlers) and its wizard UI. Imports `core`, `ui-kit` and its own folder only; nothing in `core`/`ui-kit` imports it.

## Table selector (core + ui-kit)
- AC-1: Given a connection and a schema, the service lists its tables and views (name, kind), ordered by name. A schema that does not exist
  returns an empty list and a Spanish message. Identifiers in the request are validated against the catalog and quoted; nothing else is
  interpolated.
- AC-2: Given a table and a list of required logical columns, the service returns for each: the resolved column name (exact match, then
  case-insensitive, then normalized ignoring case/underscores/accents, as the shp-replace auto-mapping tiers) and its type, or "missing".
  A column resolves only when it is the single candidate; ambiguous names stay unresolved and are reported.
  Exception: a missing logical `geom` resolves to the table's only geometry-typed column (never when several exist).
- AC-3: `TableSelector` shows the tables of the chosen schema, and after a table is chosen lists the missing/ambiguous required columns
  in Spanish. A selection with unresolved required columns is marked invalid and blocks "Siguiente".
- AC-4: The selector never keeps the password; the shared `DbConnectionForm` provides the connection.

## Job: Cargar padrones
Required logical columns (resolved per AC-2, names may differ slightly):
- RURAL source: `gid`, `nomdepto`, `coddepto`, `nomofidel`, `padron`, `seccat`, `lamina`, `caudricula`, `areaha`, `areamc`, `valreal`, `geom`.
- URBANO source: `gid`, `nomdepto`, `coddepto`, `nomofidel`, `nomloccat`, `codloccat`, `padron`, `numcarcat`, `nummancat`, `valaream2`,
  `tiporegime`, `geom`.
- Target: `unidadcat`, `nomdepto`, `coddepto`, `nomofidel`, `nomloccat`, `codloccat`, `padron`, `numcarcat`, `nummancat`, `valaream2`,
  `tiporegime`, `seccat`, `lamina`, `caudricula`, `areaha`, `areamc`, `valreal`, `archivo`, `geom`.

Wizard: connection (shared) -> schema -> rural source -> urban source -> target -> options -> review -> run. Strings in Spanish, code
in English, no inline styles, modular CSS.

### Load rules
- AC-5: One transaction. Rows read per source are counted first. A source that is empty, or whose geometry column is not a polygon type,
  refuses the run before any write.
- AC-6: Option "Reparar geometrías inválidas", ON by default (same wording and meaning as the db-shapefile-sync repair card).
  - ON: `ST_MakeValid` on rows where `ST_IsValid(geom)` is false, keeping only the polygonal part (`ST_CollectionExtract(..., 3)`),
    before grouping. Valid geometries are left untouched. A row with a NULL geometry or an empty result after repair has no usable
    geometry: it is excluded and counted (`noGeometry`, Spanish warning), never inserted with a NULL geometry.
  - OFF: no repair step. A single-row group keeps its geometry as it is, even if invalid, and is counted (`insertedInvalid`, Spanish warning
    that the target holds invalid geometries). A group of several rows is unified with `ST_MakeValid` applied only inside the union (the
    original script did the same for repeated padrones); those are counted (`repairedInUnion`). A NULL geometry is excluded and counted
    (`noGeometry`).
  - Both modes report `repaired` per source (ON) or `insertedInvalid` / `repairedInUnion` (OFF).
- AC-7: Unification is mandatory. Rural rows are grouped by `(nomdepto, padron)`, urban rows by `(nomdepto, nomloccat, padron)`; the
  target gets exactly one row per group. Groups are never keyed by `coddepto` / `codloccat` (verified on dev: one `codloccat` code is
  shared by two localities in one department).
- AC-8: Group geometry is `ST_Multi(ST_Union(geom))` over the (repaired, when AC-6 is ON) rows for every group, single-row groups included; with repair OFF see AC-6. It is reprojected with
  `ST_Transform` to the SRID of the target geometry column (read from the catalog; 0 skips the transform).
- AC-9: Group attributes are those of the group's first row ordered by the source `gid` ascending (deterministic). `unidadcat` is `RURAL` /
  `URBANO`; `archivo` is the name of the source table the rows came from. Columns that a source does not have (rural has no `nomloccat`,
  urban has no `seccat`) are NULL.
- AC-10: A row with a NULL `nomdepto` or `padron`, or (urban) a NULL `nomloccat`, cannot be grouped: it is excluded and counted
  (`nullKeyRows`, with a Spanish warning).
- AC-11: Attribute conflicts: groups of the rows that are actually loaded (usable key and geometry) whose rows disagree on any carried
  attribute, `coddepto` / `codloccat` included, a NULL against a value counting as a disagreement, are counted (`attributeConflicts`) with the first 20
  samples (key, column, differing values, up to 5). The load is not blocked.
- AC-12: Locality code guard: every `(coddepto, codloccat)` pair that carries more than one `nomloccat` in the urban source is listed
  (`ambiguousLocalityCodes`, cap 20) with a warning. It does not block.
- AC-13: The report has, per type: rows read, repaired / insertedInvalid / repairedInUnion, no geometry, null keys, groups, rows merged (`rowsMerged` = rows read - null-key rows - no-geometry rows - groups), conflicts and rows
  inserted; totals; and elapsed ms per step.
- AC-14b: After the inserts the runner checks that the rows inserted per type equal the reported `groups`; a mismatch rolls back with a
  Spanish error. The rural, urban and target tables must be three different tables (checked before any write).
  `repaired` counts only rows that end up usable (a row that is empty after repair counts as `noGeometry`, not as repaired).
- AC-14: A target `padron` is stored as read from the source (numeric), no formatting.

### Clearing the target
- AC-15: Option "Vaciar tabla destino": `DELETE` (default) or `TRUNCATE`. Both inside the transaction; neither is ever a `CASCADE`.
- AC-16: `TRUNCATE` needs the privilege: it is checked with `has_table_privilege` before the transaction; a missing privilege is a Spanish
  error naming the table, with no write attempted. `TRUNCATE` is also refused when another table has a foreign key to the target.
- AC-17: "Reiniciar secuencias del destino" (on by default): right after the clear and before the inserts, the sequences behind unmapped target
  columns are reset to 1; after the inserts and before COMMIT every such sequence is repaired to max(column)+1 (same rule as shp-replace,
  `buildResetSequenceStatement` then `buildRepairSequenceStatement`). Both modes. A dry run runs NO `setval` at all (sequences are not
  transactional); its inserts still consume `nextval` values, so a dry run can leave gaps in the target ids (documented, harmless for
  uniqueness). When a real run fails AFTER the reset, the runner rolls back and then repairs the same sequences (outside the
  transaction, errors ignored) so they are never left below max(column)+1 of the restored rows. The same repair runs when `COMMIT` itself throws and the sequences were touched (rollback quietly, repair; the outcome stays unknown).

### Run control
- AC-18: `dryRun` performs the clearing, the inserts and the counts, then `ROLLBACK` (no `setval`, see AC-17); it reports `targetModified: false` and never runs
  `ANALYZE`.
- AC-19: A real run needs `confirm: true` and the password again. A per-target lock (`host:port|db|schema|table`) answers 409 to a second
  run; the job runs in the background with phase and progress, polled like shp-replace.
- AC-20: `ANALYZE` on the target runs after `COMMIT` as its own statement; its failure is reported and does not roll back.
- AC-21: Any failure before `COMMIT` leaves the target as it was. A `COMMIT` that throws gives `outcomeUnknown: true`, and the UI asks to
  verify the target before retrying.
- AC-22: The job's setup (connection without password, schema, the three tables, options) is saved and restored as a named profile in the
  browser, so the monthly run only needs the password.

## Server wiring (round 2, backend)
HTTP surface of the module (`module.routes.json`, moduleId `routine-jobs`; route files generated by `npm run modules:routes`, never hand-edited;
all `nodejs`, `force-dynamic`; handlers take and return Web `Request`/`Response`; every secret travels in a POST body, never in a URL):
- AC-23: `POST catalog/tables` body `{ connection, schema }` -> `200 { success, schemaExists, tables }` (the `listTables` result); `POST catalog/columns`
  body `{ connection, schema, table, role }` with `role` in `rural | urbano | target` -> `200 { success, columns }` (the `resolveColumns` result for that
  role's required logical columns, taken from constants, never from the request). `connection` = `{ host, port, db_name, user, password }`. A missing
  or non-string field, a non-numeric port, an unknown role, or an invalid JSON body -> `400 { success:false, error }` in Spanish. A database error ->
  `500` with a generic Spanish message; the password never appears in any response.
- AC-24: `POST cargar-padrones/start` body = `CargarPadronesParams` (connection, schema, ruralTable, urbanoTable, targetTable, options, dryRun, confirm).
  Validates the body (same rules as AC-23, plus `options` shape and booleans), takes the per-target lock (`host:port|db|schema|table`, AC-19; host trimmed and lowercased, port normalised; aliases such as `localhost` and `127.0.0.1` are not detected) and answers
  `200 { success, jobId }` at once; the run continues in the background. Errors: 400 invalid body, including a rural/urban/target table that repeats another (lock not taken), 409 `Ya hay una carga en curso
  para esta tabla.` when a job is RUNNING for that target.
- AC-25: `GET cargar-padrones/status?jobId=...` -> `200 { success, job }` with `{ jobId, state: RUNNING | DONE | FAILED, step (Spanish label or null),
  current, total, dryRun, startedAt, finishedAt, result?, error?, outcomeUnknown? }`; `400` without `jobId`, `404` for an unknown id. Passwords are
  scrubbed from every field. A failed run keeps the run's Spanish error; a result with `outcomeUnknown` is DONE with that flag, not FAILED.
- AC-26: The job store lives in the module (`jobs/cargar-padrones/services/jobStore.ts`), modelled on `shpReplaceJobStore`: a `globalThis` singleton,
  `tryStart(tableKey, dryRun)` returns null while a RUNNING job exists for that key (this replaces `cargarPadronesLock`, which is removed together with
  its tests, whose cases move to the store's tests), `progress`, `finish`, `fail`, `get`, `sweep(maxAgeMs)` (finished jobs older than 1 h are swept on
  the next start/status). The lock is always released: a run that throws inside the background task marks the job FAILED.
- AC-27: `runCargarPadrones` calls its optional `onProgress({ label, current, total })` once as each step starts, in the order of the steps, with a
  1-based `current` and the real step count as `total`; a dry run reports only the steps it executes. A throwing `onProgress` never fails the run.
- AC-28: The real session (`services/openPgSession.ts`) implements `RunSession` with `pg`, with the same session settings as shp-replace
  (`statement_timeout`, `lock_timeout`, `client_encoding = 'UTF8'`, memory settings; reuse the exported constants/helpers of
  `src/core/services/server/shpReplace/pgShpSession.ts` where they fit), `connect` errors scrubbed of the password, and a `close()` that never throws.
  Handlers receive their dependencies by injection (store, openSession, run) so they are testable without a database.

## Client (round 3, UI)
Everything user-facing is Spanish; code is English; modular CSS (`*.module.css`), no inline styles. There is no DOM testing library in the repo: behaviour lives in
pure, tested modules (client, stores, reducer, view-models, storage); components stay thin and are covered by static-markup tests (see the SIGRA components tests).
Types shared by server and client (`TableListing`, `ResolvedColumn`, `ColumnStatus`, `TableKind`) move to `src/core/types/tableCatalog.ts` (no `server/` import from `ui-kit`); the
server file re-exports them. Part A (client side logic and `TableSelector`) and part B (wizard, page, wiki) are delivered as two rounds.

Part A
- AC-3b: `TableSelector` (`src/ui-kit/components/TableSelector.tsx` + module CSS) is headless about the backend. Props: `label`, `schema`, `value`, `onChange(table)`,
  `loadTables(schema) -> TableListing`, `checkColumns(table) -> ResolvedColumn[]`, `disabled?`, `excludedTables?`, `onValidityChange?(valid, columns)`. It lists the
  schema's tables (name, with the kind of views shown), reloads when the schema changes, shows a Spanish message when the schema does not exist or has no tables, shows
  a loading and an error state, and after a table is chosen shows each required column as resolved (with the real name found) or missing / ambiguous (with the
  suggestion). Valid = every required column resolved. A table that is in `excludedTables` cannot be chosen. The pure decision logic (`selectorStatus`, `columnRows`) is
  exported and unit tested; the component is covered by static markup.
- AC-4b: `src/modules/routine-jobs/ui/routineJobsClient.ts` wraps the four endpoints (`listTables`, `listColumns`, `startCargarPadrones`, `readStatus`): POST JSON for the first three,
  GET with `jobId` for status; throws a typed `RoutineJobsApiError { status, message }` carrying the Spanish server message; never logs the password; a network failure becomes a
  Spanish message.
- AC-29: run store `ui/cargarPadronesRunStore.ts` (the shp `shpReplaceRunStore` pattern): holds the active job id, polls status every 2 s (timer injected), stops on DONE/FAILED,
  survives in-app navigation (module-level store, subscribe/getSnapshot), gives up only after consecutive poll failures span 60 s and then reports an unknown outcome with the job id,
  exposes `start(params)`, `reset()`, and never keeps the password in its snapshot.
- AC-22: setup profiles (`ui/jobProfileStorage.ts`): save / list / delete named profiles of `{ host, port, db_name, user, schema, ruralTable, urbanoTable, targetTable, options }`
  in `localStorage`; the password is never stored; every read and write is wrapped in try/catch and the UI works without storage; corrupt JSON is ignored; the stored shape is versioned.
- AC-30: wizard state is a pure reducer (`ui/cargarPadronesWizardState.ts`): steps `connection -> tables -> options -> review -> result`, `canContinue(state)` rules (connection
  fields valid; schema chosen and the three tables chosen, distinct and all valid; options valid; confirmation matches), reset of dependent fields when the schema or connection changes.
- AC-31: report view-model (`ui/cargarPadronesReportView.ts`): turns `CargarPadronesResult` into display rows (per type: rows read, repaired / inserted invalid / repaired in union,
  no geometry, null keys, groups, rows merged, conflicts, inserted), warnings, up to 20 conflict samples, ambiguous locality codes, step timings, the analyze status and the
  `outcomeUnknown` banner text; pure and unit tested.

Part B
- AC-32: the wizard (`ui/CargarPadronesWizard.tsx`) uses `WizardOrchestrator`: (1) Conexión (host, port, database, user, password, test by listing the tables of the schema typed in step 2 is NOT
  needed: it validates fields and keeps the connection in memory), (2) Tablas (schema field + three `TableSelector`: rural, urbano, destino; destination excludes the two sources), (3) Opciones
  (repair on by default, clear mode DELETE / TRUNCATE with the privilege note, sequence reset on by default), (4) Revisar (summary; "Analizar sin cargar" = dry run; "Cargar ahora" needs the password and the
  destination table label typed again and a destructive-style warning), (5) Resultado (progress from the run store: step label, `current / total` and elapsed time while running; the report afterwards).
  A saved profile can be loaded and saved from step 1/2.
- AC-33: page contribution at `/tools/m/routine-jobs` (title "Trabajos de rutina") with the job list (today only "Cargar padrones") that opens the wizard; a home card and a navigation entry in the
  module manifest; `module.routes.json` declares the page; `npm run modules:routes:check` passes.
- AC-34: the module wiki (`src/modules/routine-jobs/wiki/`: index + "Cargar padrones", Spanish, user-facing: what it does, the four steps, the options, how to read the report, the warnings, FAQ) is
  registered through `manifest.wiki`; wiki tests pass. No screenshots.

## Out of scope
Updating `carto.padron`; the incoming/diff tables; URN provisioning; MISSING/NEW/CHANGED classification; `ST_Equals`-based geometry
comparison (belongs to that later job); other routine jobs (the shell only has to make adding one cheap); preprod/prod runs.
