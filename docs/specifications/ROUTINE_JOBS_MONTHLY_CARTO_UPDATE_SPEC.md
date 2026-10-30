# Routine jobs: Actualización mensual de carto (staged job)

Replaces the separate dashboard jobs "Cargar padrones" and "Actualizar padrones" with ONE job made of ordered stages. Stage logic, SQL and reports stay as specified in:
- `ROUTINE_JOBS_CARGAR_PADRONES_SPEC.md` (stage 1)
- `ROUTINE_JOBS_CARGAR_LOCALIDADES_SPEC.md` (stage 2)
- `ROUTINE_JOBS_ACTUALIZAR_PADRON_SPEC.md` (stage 4; in place: inserts new padrones, updates changed geometries, never deletes or renumbers)

Stage 3 also carries the address master link of the units (UT-11 to UT-25). The former stage "Completar unidades territoriales" is gone: its rules are folded into UT-19 to UT-25.

Out of the job: the `pais*` shapefile load (done with the shp-db tool, which also unifies duplicate keys by columns).

## Stages

| # | Id | What it does | Writes to |
|---|----|--------------|-----------|
| 1 | `cargar-padrones` | paisrural + paisurbano -> padron staging table | padron staging table |
| 2 | `cargar-localidades` | insert new localities, update changed geometry | chosen `cadastral_locality` table(s) |
| 3 | `unidad-territorial` | insert new and update changed `territorial_unit` rows from `cadastral_locality`; with its address master option on (default), also create and link the `addresses_master` record of each unit without one | chosen `territorial_unit` table and, with the option, `addresses_master` |
| 4 | `actualizar-padron` | insert new padrones, update changed geometries in place, never delete or renumber ids; with its option on, also create and link the `addresses_master` record of each padron without one | chosen padron destination table (a test table, or `carto.padron`) and, with the option, `addresses_master` |

Manual comparison happens before stage 4 is run against `carto.padron`. Stages never auto-chain. Stages 3 and 4 link the units and
padrones they insert themselves (UT-11 to UT-25 and AP-51 to AP-60, each behind its own option "Enlazar direcciones maestras de las
unidades" / "Enlazar direcciones maestras de los padrones"), so no address master link ever needs a separate run.

## Requirements

- MJ-1: One dashboard entry "Actualización mensual de carto"; the two old entries and wizards are removed.
- MJ-2: One wizard. Step "Conexión" asks host, port, database, user, password once (saved-connection profile selector); the connection is shared by every stage.
- MJ-3: After the connection, a stage hub lists the stages in order with status (pending, done this session, failed). Any stage can be opened; a stage whose precondition is unmet shows why it is blocked.
- MJ-4: Each stage asks for its own schema(s) and tables when opened, never up front.
- MJ-5: Tables chosen in one stage prefill the same logical table in later stages (staging table, locality table(s), work table). The user can change them.
- MJ-6: Each stage keeps its own dry run, options, run, report, planned-step checklist and per-target lock exactly as in its stage spec. Re-running a stage is allowed.
- MJ-7: Each stage keeps its own endpoints and shared job store namespace; the stage id is the namespace. Catalog endpoints are shared.
- MJ-8: Stage 3 is specified in the section below and built after stage 2. Stage 4 is specified in `ROUTINE_JOBS_ACTUALIZAR_PADRON_SPEC.md`.
- MJ-9 (decision): There is no separate "Aplicar padrones" stage. Stage 4 inserts new padrones and updates changed geometries in place in the chosen destination table, so a separate apply stage is redundant. The job has four stages. The former stage "Completar unidades territoriales" was removed too (decision): its address master link is the option of stage 3, under the same shared link rules.
- MJ-10: Duplicate keys are not merged by the job: stage 4 keeps skipping and reporting them (`CLAVE_DUPLICADA`).
- MJ-11: Schemas are per stage: stage 1 uses one schema (bdj_carto); stage 2 uses a source schema plus a schema per target table; stage 4 uses a staging schema and a carto schema (the destination table lives in carto).
- MJ-13 (INVARIANT): no stage may replace, delete-and-reinsert or renumber ids in `carto.padron`, `territorial_unit` or `cadastral_locality`. Updates never put `id` in SET; inserts take ids from the table sequence; no DELETE or TRUNCATE on those tables; rows missing from the source are only reported. Reviewers check this on every diff.
- MJ-13 note (stage 4 pairs, AP-64 to AP-67): a padron that was reclassified (type, locality) or renumbered, with the same footprint, is updated in place: its `type_padron`, `id_cadastral_locality` and `number` change, its geometry too when Actualizar geometrías is on. The id, `id_address_master` and `id_province` never change, and the number changes only in a strict one-to-one pair.
- MJ-14: Every stage report CSV (stages 2, 3 and 4) lists only the rows the report lists (capped at `DETAIL_LIST_LIMIT`). When a list is cut (real count greater than the list length) the CSV ends with one marker row per cut list: Tabla = target table, Cambio = `Lista incompleta: se muestran las primeras 500 de N <items>`, other cells empty. The helper is shared (`reportCsvRows.ts`).
- MJ-12: No inline styles; reuse the shared step checklist, report table, connection profile selector and table selector.
- MJ-15: Table pickers of stages 1-4 prefill fixed defaults from `src/modules/routine-jobs/config/monthlyTables.ts`. A value seeded by an earlier stage always wins over the default. The picker clears a value that is not in the schema listing (no error, no loop); it never clears while the listing loads or fails.

## Stage 3: Actualizar unidades territoriales

User query (insert only) is extended to insert-or-update. Source rows: every row of the chosen `cadastral_locality` table. Target: the chosen `territorial_unit` table.

- UT-1: User picks source locality table, target territorial_unit table and the unit type table; locality type name is an option, default `LOCALIDAD CATASTRAL`. Preflight: the type name must exist exactly once in the type table.
- UT-2: Match key is (id_province, name, id_territorial_unit_type = resolved type id). Matching without the type is wrong (other unit types share names).
- UT-3: Source rows with a null name or null province are skipped and reported. Rows whose key repeats in the source or in the target are skipped and reported (no guess).
- UT-4: Unmatched source row -> INSERT (name, id_territorial_unit_type, id_font = source id_font_type, id_province, geometry). `id` comes from the target sequence, `id_address_master` and `iso_code` stay null (with the link option on, UT-13 links `id_address_master` in the same transaction).
- UT-5: Matched row -> UPDATE geometry and id_font in place only when they changed (geometry compared with the same Hausdorff tolerance as stage 4, tolerance 1 m). `id`, `id_address_master`, name, province and type are never changed: ids feed padron.id_cadastral_locality and URNs.
- UT-6: Target rows of that type with no source row are only reported, never deleted.
- UT-7: Geometry follows the target column SRID/type; sources are transformed and made valid as in stage 4.
- UT-8: Dry run reports inserted, updated, unchanged, skipped and missing counts with samples. Real run is one transaction, then sequence repair and ANALYZE.
- UT-9: Preflight refuses when required target columns (name, id_territorial_unit_type, id_font, id_province, geometry) are missing or the source lacks name, id_font_type, id_province, geometry.
- UT-10: The pickers prefill the locality table from the stage 2 CARTO target (else `carto.cadastral_locality`), the type table `carto.territorial_unit_type` and the unit table `carto.territorial_unit`. The user can change them; the type name default is kept.
- UT-11: Option "Enlazar direcciones maestras de las unidades" (`options.linkAddressMaster`, a boolean, default off; an absent field in the request means off). With the option on, the request carries the address master table as `addressMasterTable: { schema, table }`, both texts required. With the option off, the stage ignores any address master table in the request. A direct call whose option and table disagree is refused before any write, with the Spanish message of AP-51 (`ADDRESS_MASTER_TOGGLE_MISMATCH_MESSAGE`).
- UT-12: Preflight, before BEGIN, when the option is on: the unit table also needs `id_address_master` (the UT-9 columns plus `id_address_master`), and the address master table must pass the shared address master checks (structure, INSERT and SELECT, UPDATE on its id sequence). The unit and address master tables must be different tables; a clash is refused in Spanish.
- UT-13: Link pass in the same transaction. With the option on, after the upsert of UT-4 and UT-5 and its count check, the stage repairs the address master sequence, runs the shared link pass with the unit subject (candidates are the units with `id_address_master IS NULL` after the upsert, rows inserted by this run included), then runs ANALYZE on the unit table and on the address master table. A dry run rolls back both tables; a real run commits both or neither. The per-target lock covers both tables.
- UT-14 (INVARIANT, MJ-13): the link pass never changes ids. It writes `id_address_master` only on units where it is NULL, inserts address master rows only, and never issues DELETE, TRUNCATE or an `id` SET. The UT-5 rule that `id_address_master` is never changed still holds for units that already have one.
- UT-15: Planned steps. With the option on, the checklist adds, after "Aplicar cambios de unidades territoriales" and before "Analizar tabla de destino": "Ajustar secuencia de direcciones maestras", "Clasificar unidades sin dirección maestra", "Crear y enlazar direcciones maestras de unidades", "Verificar unidades pendientes". With the option off the list is the UT-8 list unchanged. The progress total equals the planned list length.
- UT-16: Result and report. The result carries `addressMaster` only when the option is on: the table, counts (sin dirección maestra, registros por crear, registros creados, unidades enlazadas, ya tenían registro, ambiguas, por crear, restantes), the linked list (capped at `DETAIL_LIST_LIMIT`) and the ambiguous samples. The count checks of the pass (created equals the planned creations, linked equals the candidates minus the ambiguous, remaining equals the ambiguous) roll back the whole transaction on mismatch with a Spanish message. Warnings in Spanish, worded from the unit subject texts: ambiguous units (neither created nor linked) and the cut of the linked list. The dry-run warning and the commit-unknown warning are unchanged.
- UT-17 (UI, wizard): the "Tablas" step shows the checkbox "Enlazar direcciones maestras de las unidades" (`options.linkAddressMaster`), on by default: the monthly flow always ran the address master stage before, and UT-11 stays the request default. With it on, a fourth card "Tabla de direcciones maestras" prefills `carto.addresses_master` (`MONTHLY_TABLES.actualizarUnidades.addressMaster`). The picker is required and must be valid, and its name must differ from the other three tables of its schema. Turning the checkbox on prefills the table; turning it off clears the table, hides the card and sends nothing. The Review step lists the address master table only when the option is on. With the option on, the unit table card checks its columns with the linked role (`UNIT_TABLE_ROLE.TARGET_LINKED`, the target columns plus `id_address_master`), so the picker refuses a table without that column up front; the UT-12 preflight stays as the safety net. The typed confirmation asks only for the unit table name (as stage 4 does for the padron table): changing the unit table's schema or name clears it.
- UT-18 (UI, report and CSV): the report shows the address master section (counts, linked units, ambiguous units; the same look as stage 4) only when the result carries `addressMaster`. The refresh suggestion for `mv_territorial_unit_full` in the run's unit schema shows only after a real run, or one whose commit outcome is unknown, that changed anything: units inserted, units updated (source or geometry), or address masters created or linked (each greater than zero, any of them is enough). A dry run never shows it. The changes CSV gains the column "Id dirección maestra" (empty on change rows); with the option on it appends one row per created address master (in the address master table) and one per linked unit (in the unit table), with the MJ-14 cut markers.

- UT-19 (link candidates and URN): the link pass takes as candidates ALL units with `id_address_master IS NULL`, whatever their unit type. The URN of a unit is the constant prefix `cgeo:territorial_unit:id:` followed by its id, matched by exact string equality (never parsed with `SPLIT_PART` and a cast).
- UT-20 (per-unit rule): a candidate with no address master row with its URN gets `INSERT ... (urn, latitud, longitud) VALUES (urn, 0, 0)`, ordered by unit id, with `addresses_master_id` from the table sequence. A candidate with exactly one address master row with its URN is linked to that row and gets no second row. A candidate with two or more such rows is AMBIGUOUS: neither inserted nor linked, only counted and sampled (up to `SAMPLE_LIMIT`). The pass never guesses.
- UT-21 (idempotence): linking is `UPDATE ... SET id_address_master = <address master id> ... WHERE id_address_master IS NULL`, for the linkable candidates only (new and existing). A second run finds no candidates left except the ambiguous ones. Candidates are grouped by (unit id, urn), so a duplicated unit id counts once and fails the linked-count check of UT-16.
- UT-22 (INVARIANT, MJ-13): the link pass never issues DELETE or TRUNCATE, never sets `addresses_master_id`, never changes `id`, the geometry or any column other than `id_address_master`, and never overwrites a non-null `id_address_master`.
- UT-23 (transaction and operational notes): the whole run is one transaction (`BEGIN ISOLATION LEVEL REPEATABLE READ`, UT-13), PostgreSQL 11 compatible, no `MATERIALIZED` hints. Notes: (a) a dry run still consumes `addresses_master_id` sequence values (`nextval` is not transactional), so real ids show gaps; (b) the stage assumes no other session inserts into the address master table during the run (no `LOCK TABLE`, the application role may lack the privilege). A concurrent run on the same tables is refused by the per-target lock of UT-13, and a concurrent write to the same rows fails with a serialization error that rolls back.
- UT-24 (preflight): with the option on, both tables pass the shared target checks (regular or partitioned, no inheritance, no triggers or rules, no NOT NULL column without default outside the columns the stage writes, an id sequence). The user needs UPDATE on the unit table, SELECT and INSERT on the address master table and UPDATE on its sequence. These checks run before BEGIN, as UT-12 says.
- UT-25 (oracle and refresh boundary): the INSERT and the UPDATE of the link pass reproduce the `UNIDAD TERRITORIAL` block of the one-time script `addressMaster.sql` (outside the repo, read-only), with the rules above. The tool NEVER refreshes `mv_territorial_unit_full`: the view name is the constant `TERRITORIAL_UNIT_VIEW_NAME`, and the refresh suggestion shows the `REFRESH MATERIALIZED VIEW "<schema>"."mv_territorial_unit_full";` statement as selectable text only (identifiers quoted, no copy button: `ui-kit` has no clipboard component and a module cannot import another module).

## Build order

1. Hub shell: shared connection step, stage hub, dashboard entry, removal of old entries, prefill store.
2. Stage 2 backend + endpoints + stage panel.
3. Adapt stages 1 and 5 panels into the hub (no behaviour change).
4. Stage 3 (UT-1..UT-25, with the address master link and the former stage 4 rules).
