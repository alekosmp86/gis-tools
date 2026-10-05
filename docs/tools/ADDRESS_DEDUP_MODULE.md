# Address Dedup — Module

Finds duplicate addresses in `carto.v_address_build` across ANTEL, IDE and TLK, decides KEEP or
REMOVE per row, and exports the result to CSV or GeoJSON for QGIS.

**Postgres does the work.** The module runs one validated, read-only SQL query (the CGEO-2192 v3
`find_removal_candidates.sql`, ported with the changes below) and presents the result. There is no
TypeScript re-implementation of the match key or the decision.

**Analysis is read-only; removal is a separate, confirmed write path.** `analyze` and `export` never
write (the query runs in `BEGIN READ ONLY`). The module's one write path, section 6, deletes confirmed
REMOVE candidates only, behind a simulation and a fingerprint check.

It is a **module**: `src/modules/address-dedup/`. Its deletion set is that folder, its line in
`src/app/modules.registry.ts`, `tests/unit/modules/address-dedup/`, the Playwright specs `tests/e2e/flows/address-dedup*.spec.ts` with their fixtures `tests/e2e/fixtures/dedup*Fixtures.ts` and `tests/e2e/support/dedupProvince.ts`, and the generated
`src/app/api/m/address-dedup/**` and `src/app/tools/m/address-dedup/` (regenerated, never edited).

## 1. The query

`services/queries/duplicateAnalysisQuery.ts` exports the SQL as one constant plus `toQueryValues`,
the only place the parameter order is defined. The match key is written once, in the `keyed` CTE.
All values are bound parameters; the only literals interpolated are module constants.

| Param | Type | Default | Meaning |
|---|---|---|---|
| `$1` | `text[]` | `{ANTEL,TLK,IDE}` | detection fuentes (`name_font`), derived from removable + protected |
| `$2` | `int` | request | province id (`carto.province.id`, picked in the UI) |
| `$3` | `text[]` | `{ANTEL,TLK}` | removable fuentes |
| `$4` | `text[]` | `{IDE}` | protected fuentes |
| `$5` | `int` | `2` | geo decimals when a padron is present |
| `$6` | `int` | `3` | geo decimals when there is no padron |
| `$7` | `boolean` | `false` | `protectedSiblingRemovesLone` |
| `$8` | `text` | `REMOVAL_GROUPS` | output scope |

`document_type = 'PARENT'` stays a literal. Defaults live in `constants.ts` as `DedupRules`.

The effective padron-locality-or-geo segment is computed once, in a `LATERAL` subquery of `keyed`
(`padron_locality_or_geo`), and `match_key` reuses it, so the displayed value and the key cannot
drift. The output also carries `province_code`, `padron_locality`, `padron_locality_or_geo` and
`match_key`, appended after the v3 columns; none of them is exported.

## 2. Decision table

Evaluated top to bottom, first match wins. `decision_reason` is a column on every output row.

| Decision | `decision_reason` | When |
|---|---|---|
| KEEP | `PROTECTED_SOURCE` | `fuente` is in the protected list |
| KEEP | `INFRA_MATCHED` | matched in `match_tlk.direcciones_tlk_serv_cto_cgeo` or `integrador.nap_physical_device` |
| KEEP | `NO_DUPLICATE` | group size 1 (never reaches the output, see below) |
| REMOVE | `REDUNDANT_WITH_PROTECTED` | only when `$7` is true: unmatched removable member of a group that has a protected member |
| KEEP | `LOWEST_URN_KEPT` | nothing matched; lowest-urn removable member; group has no protected member |
| KEEP | `KEPT_ALONGSIDE_PROTECTED` | same branch, but the group does contain a protected member (the case to review) |
| REMOVE | `REDUNDANT_WITH_MATCHED` | another removable member matched |
| REMOVE | `REDUNDANT_NOT_LOWEST_URN` | nothing matched, rank above 1 |
| KEEP | `HAS_INTERNAL_UNITS` | override: a removable-fuente row that would be one of the three REMOVE reasons but has at least one internal/apartment unit attached (needs review) |

The lowest-urn rank is computed among removable (ANTEL/TLK) members only, ordered by the numeric
`id:<n>` suffix of the urn. Protected rows are not ranked. (The v3 header comment said "across the
whole group (any source)"; the code, which produced the delivered numbers, ranks ANTEL/TLK only.
The comment was corrected, not the behaviour.)

### Internal units override (`HAS_INTERNAL_UNITS`)

Found while preparing the deletion script for CGEO-2192: `carto.baja_direccion` (dev DB only) refuses to
delete a door that has internal/apartment sub-units attached, because that orphans them. v3 never checked
this; against Flores prod, 250 of ~1,670 removal candidates (248 TLK, 2 ANTEL) had internal units.

A removable-fuente row that would be `REDUNDANT_WITH_MATCHED`, `REDUNDANT_NOT_LOWEST_URN` or
`REDUNDANT_WITH_PROTECTED` and has at least one internal unit is reclassified to KEEP /
`HAS_INTERNAL_UNITS`. Rows already KEEP for another reason keep that reason. The internal units are not
themselves evaluated for duplication (out of scope). Resolution path:
`carto.addresses_master.urn` -> `addresses_master_id` -> `carto.address.id_address_master` -> `address.id`
-> `carto.internal_address_access_point.id_access_point`.

The query returns a boolean `has_internal_units` on every row (type `AnalysisRow`). It is deliberately not in
the CSV/GeoJSON columns, so the exported header stays identical to v3. `HAS_INTERNAL_UNITS` counts as a
review reason together with `KEPT_ALONGSIDE_PROTECTED` (`REVIEW_REASONS`): the "Para revisar" KPI, the
"Solo para revisar" toggle and the amber "Revisar" badge all include it. Bound parameters `$1`..`$8` are unchanged.

### The `$7` toggle

v3 only outputs groups that contain a REMOVE. A lone ANTEL/TLK that is the lowest-urn removable
member of a group that also holds an IDE row is KEEP (`KEPT_ALONGSIDE_PROTECTED`). With `$7`
true that row becomes REMOVE (`REDUNDANT_WITH_PROTECTED`). A matched row beside an IDE row stays
`INFRA_MATCHED`.

### Output scope

- `REMOVAL_GROUPS`: every group with at least one REMOVE (v3 behaviour), plus every group holding a
  review-worthy row (`REVIEW_REASONS`: `KEPT_ALONGSIDE_PROTECTED`, `HAS_INTERNAL_UNITS`), so a group
  whose removals were all deferred to review does not vanish.
- `ALL_DUPLICATE_GROUPS`: every group with more than one member, which also adds the all-KEEP
  groups, for visual review.

Singletons never appear in either scope, so `NO_DUPLICATE` is defined for completeness but cannot
occur in the output.

## 3. Endpoints

All endpoints are `POST`, `nodejs`, `force-dynamic` (the two removal endpoints are in section 6). Credentials travel in the body only, never in a query
string, and are never stored, logged or echoed (the password is scrubbed from error text).

- `POST /api/m/address-dedup/provinces`
  `{ connection: { host, port, db_name, user, password } }` returns `{ success, provinces: [{ id, name }] }`
  from `SELECT id, name FROM carto.province ORDER BY name`, in the same read-only transaction as the analysis.
  The UI fills the "Departamento" select from it: the user fills the connection, presses "Cargar departamentos"
  (it needs the password, so there is no load on mount) and picks one; the option value is the province id the
  analysis binds. Any change to the connection fields or the profile clears the list and the selection.
- `POST /api/m/address-dedup/analyze`
  `{ connection: { host, port, db_name, user, password }, provinceId, protectedSiblingRemovesLone?, scope? }`
  returns `{ success, summary, groups, skippedWithoutCoordinates }`.
- `POST /api/m/address-dedup/export` same body plus `format: "csv" | "geojson" | "links"`, returns an
  attachment. Stateless: it re-runs the query.

The query runs in `BEGIN READ ONLY` with `SET LOCAL statement_timeout = 180000` (the query is heavy
and runs on production), always rolled back and the connection always closed. A write attempt fails
in the database itself.

### Groups table

One column per field of `match_key`, in key order (`MATCH_KEY_COLUMNS` in `data/dedupLabels.ts`, the
single source of the Spanish labels and the column count): Fuente, URN, Provincia, Cód. provincia,
Cód. localidad, Localidad, Cód. postal, Localidad padrón / geo, Calle, Número, Letra, Manzana,
Solar, Km, Padrón, Tipo de padrón, Ref. tramo, Decisión, Motivo. Values are raw; null or blank
renders as an em dash (`formatCell`). The group header row carries the full `match_key` as its
`title`. `DedupScrollFrame` puts a synchronised horizontal scrollbar above and below the table
(`useSyncedHorizontalScroll`); the top one is hidden when nothing overflows.

### KPI drill-down

Each Resumen KPI card is a button that jumps to the Grupos tab with a preset that fully replaces the
current filter (`applyPreset` in `useDedupGroupFilters`, not the merging `updateCriteria`): `Grupos` and
`Filas` clear every filter, `A eliminar` sets Decisión = Eliminar, `A conservar` sets Decisión = Conservar,
`Para revisar` turns on "Solo para revisar". `DedupResultsView.handleKpiSelect` applies the preset and
switches the tab. `DedupKpiCard` renders a plain `div` when no `onClick` is given. The decision matrix
and reason table are not clickable.

## 4. Exports

- CSV: RFC 4180, `\r\n`, UTF-8, header includes `decision` and `decision_reason`. The column list
  (`EXPORT_COLUMNS`) is the v3 header and is pinned by a test; display-only fields are not added.
- GeoJSON points: `[lng, lat]`, every `EXPORT_COLUMNS` field in `properties` (style by `decision_reason` in QGIS).
  Rows without coordinates are skipped and counted.
- GeoJSON links: one LineString per group joining its members, properties `{ groupId, size }`;
  groups with fewer than two locatable members are skipped.

## 5. Changing a rule

Edit the SQL in `duplicateAnalysisQuery.ts` (and `DecisionReason` in `constants.ts` if a reason is
added), then extend `tests/unit/modules/address-dedup/duplicateAnalysisQuery.test.ts`. Those tests
run the exact exported SQL against an in-process Postgres (`@electric-sql/pglite`, a devDependency
used only by tests) with synthetic rows. Defaults (fuente lists, decimals) are typed
constants in `constants.ts`; the UI does not edit them.

## 6. Removal (the write path)

Brings the `carto.baja_direccion` mechanism (simulate, fingerprint, explicit confirm, audit) into the app. The reference
definitions are the `carto.baja_direccion` and `baja_direccion_base_v1` functions in the dev database.

### Scope: REMOVE only, enforced in SQL

Only `decision = REMOVE` rows from a **freshly recomputed** analysis are ever eligible. The target set
is derived in one statement (`REMOVAL_PLAN_SQL`, `services/queries/removalPlanQuery.ts`) that embeds the
exact analysis query as a CTE: a urn is a target only if every analysis row carrying it is `REMOVE` on a
removable fuente. `HAS_INTERNAL_UNITS` and `KEPT_ALONGSIDE_PROTECTED` rows ("Para revisar") are KEEP in
the analysis, so they never enter the set. This is not a UI option or a flag: no request field names an
address. Both endpoints accept only the connection, province, the protected-sibling toggle (it changes
which rows are REMOVE, exactly as in `analyze`), the confirmation and the fingerprint; the handlers
build the orchestrator request from those fields and ignore everything else, so a hand-crafted `urns`
or `ids` list never reaches the repository. A second, in-query check (`has_foreign_reason`) counts targets
whose reason is outside the three REMOVE reasons (`REMOVE_REASONS`); a non-zero count throws.

### Per-target integrity guards (blockers)

Ported from `baja_direccion_base_v1`, applied to the whole target set by simulate and execute alike.
`simulateRemoval` returns them as `blockers` (urn plus reasons); `executeRemoval` refuses, writing nothing,
while any exists. Blocked rows are never skipped and the unblocked remainder is never deleted.

| Reason | Fires when |
|---|---|
| `URN_BLANK` | the urn is empty |
| `URN_NOT_FOUND` | the urn resolves to no master or no address |
| `URN_AMBIGUOUS` | more than one master or address carries the urn |
| `MASTER_SHARED` | another address row points at the master |
| `NOT_A_DOOR` | no `access_point` row for the address |
| `IS_INTERNAL` | an `internal_address` row exists for it too |
| `HAS_INTERNAL_UNITS` | `internal_address_access_point.id_access_point` = the door (out of scope: blocked, never cascaded) |
| `LINKED_AS_INTERNAL` | `internal_address_access_point.id_internal_address` = the door |
| `MASTER_REFERENCED` | any other `carto` table with `id_address_master` / `address_master_id` / `addresses_master_id` holds the master (found by a `pg_catalog` scan, so a table added later is covered) |

### Snapshot and fingerprint

The plan query builds, in SQL, the snapshot of every row it would touch: `direcciones` (address, master,
puerta, interna per id), `relaciones_internas`, `territorios`, `compactas`, plus `version` and
`incluir_internas: false`. `fingerprint = md5(snapshot::text)`, computed in SQL like the reference ("a change
fingerprint, not a credential"). The snapshot is neither stored nor sent to the browser: the fingerprint
plus the urn list in the audit row's `resultado` are the record.

### Endpoints

- `POST /api/m/address-dedup/removal/simulate`: `{ connection, provinceId, protectedSiblingRemovesLone? }`
  returns `{ success, fingerprint, counts: { total, byFuente, rowsByTable }, blockers, targets }`, where
  `targets` is `[{ urn, fuente }]` sorted by urn (see "URN list" below). Runs in `BEGIN READ ONLY`, always
  rolled back, takes no locks.
- `POST /api/m/address-dedup/removal/execute`: same plus `operationId?` (a UUID; generated by the server
  when absent), `responsable`, `motivo` and `expectedFingerprint`. Returns the `RemovalResult`. A deliberate
  refusal (data moved, blockers, replayed id with other parameters, global guard, audit table with another
  shape) answers 409 and wrote nothing; validation answers 400. `responsable` is capped at 120 characters and
  `motivo` at 1000 (400 beyond; the dialog inputs carry the same `maxLength`). The body never carries an
  address list, and `targets` is not accepted back.

### Execute transaction (`PgRemovalRepository.executeRemoval`)

A new connection, never the read-only one, in one transaction:

1. `BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE`, `SET LOCAL lock_timeout = '5s'`, `SET LOCAL statement_timeout`.
2. `pg_advisory_xact_lock(hashtext('carto.address-dedup.removal'), hashtext(operationId))`.
3. Preconditions (see "Audit table"): the audit table exists with its columns and the role holds the needed
   privileges, else a 409 refusal before any lock or delete.
4. Idempotency: if the operation id is in the audit table, identical `referencia`, `incluir_internas`, `huella`,
   `responsable` and `motivo` return the stored result (`recovered: true`, nothing deleted, no table locked);
   anything different is refused (`El UUID ya fue utilizado con otros parametros.`).
5. `LOCK TABLE` the nine tables `baja_direccion_base_v1` locks, `SHARE ROW EXCLUSIVE`.
6. Abort if `carto.comments_address` or `carto.plural_entity_access_point` has any row.
7. Lock every other table the catalog scan finds referencing a master.
8. Recompute the plan with the same function simulate uses (`resolveRemovalPlan`), then refuse unless it has
   no blockers, at least one target, and a fingerprint equal to `expectedFingerprint`.
9. Delete, scoped to the ids and urns that fresh plan resolved, in this order: `internal_address_access_point`,
   `territorial_unit_access_point`, `compact_address`, `internal_address`, `access_point`, `address`,
   `addresses_master`. Each table's deleted count must equal the plan's count, or the transaction rolls back.
10. Insert the audit row, `COMMIT`.

The only code path that issues a DELETE is behind step 8, so the write is unreachable without a fingerprint
equal to a freshly recomputed one. The read path (`PgAddressRepository.runDuplicateAnalysis`) is unchanged.

### URN list

The plan response lists the urns the removal would delete with their fuente. The list comes from the same
`targets` CTE of `REMOVAL_PLAN_SQL` that `counts.total` counts (sorted `ORDER BY urn COLLATE "C"`), not a second
query, so it is exactly the set behind the fingerprint; `HAS_INTERNAL_UNITS`, `KEPT_ALONGSIDE_PROTECTED` and
protected-source urns are never in it. It is review material only: execute re-derives its targets and ignores
the list. In the review step the dialog renders it in one read-only `<textarea>` (not a node per urn) under a
count header, with "Copiar URN" (newline-separated, clipboard) and "Descargar CSV" (`urn,fuente`, RFC 4180,
file `address-dedup-removal-plan-<provinceId>-<first 8 of fingerprint>.csv`, blob URL revoked after the click).
The builders are pure functions in `domain/removalPlanExport.ts`.

### Ids as strings

The plan query emits `address_ids` and `master_ids` as `text[]` (`to_jsonb(...::text[])`), so a bigint beyond
2^53 reaches JS exact and is bound back with `::bigint[]`. The snapshot is no longer stored, so only the
fingerprint (computed in SQL) covers those ids.

### Audit table

The removal logs to `carto.baja_direccion_operacion`, the audit table of `carto.baja_direccion`. The app never
creates it and never issues DDL: the app has no write or DDL permission in prod.

**Prerequisite.** The table exists today only in the dev database. An administrator must create it in
prod, with this shape, before the first real run there:

```sql
CREATE TABLE carto.baja_direccion_operacion (
  operacion        uuid        NOT NULL PRIMARY KEY,
  referencia       text        NOT NULL,
  incluir_internas boolean     NOT NULL,
  huella           text        NOT NULL,
  responsable      text        NOT NULL,
  motivo           text        NOT NULL,
  ejecutor_bd      text        NOT NULL,
  creado_en        timestamptz NOT NULL DEFAULT clock_timestamp(),
  resultado        jsonb       NOT NULL
)
```

**Preconditions.** Simulate (before it resolves the plan) and execute (before any lock or delete) refuse with
HTTP 409 and zero writes unless: the table exists (`La tabla de auditoria carto.baja_direccion_operacion no
existe en esta base. Debe crearla un administrador antes de ejecutar bajas.`); it has all nine columns (`...
existe con otra estructura; faltan columnas: ...`); the connected role holds `SELECT` and `INSERT` on it
(`has_table_privilege(current_user, ...)`, message names the missing privilege); and holds `DELETE` on the
seven deletion tables (message lists the tables lacking it).

**Row written.** The same eight columns `carto.baja_direccion` inserts (`creado_en` takes its default):
`operacion` = the operation id; `referencia` = `address-dedup:province=<id>;protectedSiblingRemovesLone=<bool>`
(built by `buildRemovalReference`, never free text); `incluir_internas` = `false`; `huella` = the fingerprint;
`responsable`, `motivo`; `ejecutor_bd` = `current_user`; `resultado` = jsonb with `operationId`, `fingerprint`,
`state`, `counts` (total, byFuente, rowsByTable), `deletedByTable`, `pending` (the Solr / materialized-view
reminder), `provinceId`, `protectedSiblingRemovesLone` and `targets` (the sorted urn list with fuente).
Replaying an operation id compares `referencia`, `incluir_internas`, `huella`, `responsable` and `motivo`.

### UI

The "Confirmar y eliminar" button lives in a panel under the KPI cards on the Resumen tab (not the Grupos
toolbar: the removal acts on the whole fresh REMOVE set, never on the current filter). It opens a dialog:
responsable and motivo, then "Simular baja", then the plan (counts by fuente and table, fingerprint,
blockers), then a separate "Ejecutar eliminación" that is disabled while blockers exist. The outcome always
carries the reminder that Solr and the materialized views are manual follow-ups. The two-step rule lives in
a pure reducer (`domain/removalFlow.ts`): execute is only reachable from a reviewed plan.

### What the tests cannot show

The tests run against PGlite (a single-session Postgres in WASM). They exercise the real SQL, the delete
order, rollback, the audit table and the privilege checks (against a real limited role), but not concurrency: `LOCK TABLE ... SHARE ROW EXCLUSIVE`,
`lock_timeout`, the advisory lock and `READ COMMITTED` interleaving are issued and asserted as statements,
never contended. The catalog scan runs, but against a toy schema.

### Known limits

- The infra-match tables the analysis reads (`match_tlk.direcciones_tlk_serv_cto_cgeo`,
  `integrador.nap_physical_device`) are not locked: a row matched there between the plan recomputation and
  the commit is a window the removal accepts. The fingerprint covers the carto rows, not those tables.
- PGlite cannot model locks, `lock_timeout`, the advisory lock or `READ COMMITTED` interleaving (see above).
- Solr removal and the materialized-view refresh are not performed; they stay manual steps.

## 7. Not done

- Solr index removal and the materialized-view refresh (manual follow-ups, reminded in the UI).
- Partial or selective execution (one group or one filtered subset at a time); the removal always targets the
  full, freshly computed REMOVE set. An idea for later.
- Touching `HAS_INTERNAL_UNITS` or `KEPT_ALONGSIDE_PROTECTED` rows, now or behind a flag.
- The infrastructure-matches stacked view (`find_infrastructure_matches.sql`).
- FLAGGED group state (v2, superseded).
- A map view (the GeoJSON export covers QGIS).
- Streaming, cursors, row caps, snapshots, caching, job queues or persisted results.
- UI to edit fuente lists or decimals.
- The ANC source.

## 8. Known limitations

CSV cells are not neutralised against spreadsheet formula injection (a blanket prefix would corrupt the legitimately negative `lat`/`lng` columns); the data is internal.
