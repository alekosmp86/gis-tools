# Address Dedup — Module

Finds duplicate addresses in `carto.v_address_build` across ANTEL, IDE and TLK, decides KEEP or
REMOVE per row, and exports the result to CSV or GeoJSON for QGIS.

**Postgres does the work.** The module runs one validated, read-only SQL query (the CGEO-2192 v3
`find_removal_candidates.sql`, ported with the changes below) and presents the result. There is no
TypeScript re-implementation of the match key or the decision.

**Investigation only.** No endpoint, service or UI path writes to any database. Deletes, if they
ever come, belong behind a separate confirmed step.

It is a **module**: `src/modules/address-dedup/`. Its deletion set is that folder, its line in
`src/app/modules.registry.ts`, `tests/unit/modules/address-dedup/`, the Playwright spec `tests/e2e/flows/address-dedup.spec.ts` with its fixture `tests/e2e/fixtures/dedupFixtures.ts`, and the generated
`src/app/api/m/address-dedup/**` and `src/app/tools/m/address-dedup/` (regenerated, never edited).

## 1. The query

`services/queries/duplicateAnalysisQuery.ts` exports the SQL as one constant plus `toQueryValues`,
the only place the parameter order is defined. The match key is written once, in the `keyed` CTE.
All values are bound parameters; the only literals interpolated are module constants.

| Param | Type | Default | Meaning |
|---|---|---|---|
| `$1` | `text[]` | `{ANTEL,TLK,IDE}` | detection fuentes (`name_font`), derived from removable + protected |
| `$2` | `int` | request | province id (UI default 7, FLORES) |
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

The lowest-urn rank is computed among removable (ANTEL/TLK) members only, ordered by the numeric
`id:<n>` suffix of the urn. Protected rows are not ranked. (The v3 header comment said "across the
whole group (any source)"; the code, which produced the delivered numbers, ranks ANTEL/TLK only.
The comment was corrected, not the behaviour.)

### The `$7` toggle

v3 only outputs groups that contain a REMOVE. A lone ANTEL/TLK that is the lowest-urn removable
member of a group that also holds an IDE row is KEEP, so its group is never exported. With `$7`
true that row becomes REMOVE (`REDUNDANT_WITH_PROTECTED`). A matched row beside an IDE row stays
`INFRA_MATCHED`.

### Output scope

- `REMOVAL_GROUPS`: every group with at least one REMOVE (v3 behaviour).
- `ALL_DUPLICATE_GROUPS`: every group with more than one member, which adds the
  `KEPT_ALONGSIDE_PROTECTED` groups and the all-KEEP groups, for visual review.

Singletons never appear in either scope, so `NO_DUPLICATE` is defined for completeness but cannot
occur in the output.

## 3. Endpoints

Both are `POST`, `nodejs`, `force-dynamic`. Credentials travel in the body only, never in a query
string, and are never stored, logged or echoed (the password is scrubbed from error text).

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

## 6. Not done

- Any delete or other write path.
- The infrastructure-matches stacked view (`find_infrastructure_matches.sql`).
- FLAGGED group state (v2, superseded).
- A map view (the GeoJSON export covers QGIS).
- Streaming, cursors, row caps, snapshots, caching, job queues or persisted results.
- UI to edit fuente lists or decimals.
- The ANC source.

## 7. Known limitations

CSV cells are not neutralised against spreadsheet formula injection (a blanket prefix would corrupt the legitimately negative `lat`/`lng` columns); the data is internal.
