# Routine jobs: Actualización mensual de carto (staged job)

Replaces the separate dashboard jobs "Cargar padrones" and "Actualizar padrones" with ONE job made of ordered stages. Stage logic, SQL and reports stay as specified in:
- `ROUTINE_JOBS_CARGAR_PADRONES_SPEC.md` (stage 1)
- `ROUTINE_JOBS_CARGAR_LOCALIDADES_SPEC.md` (stage 2)
- `ROUTINE_JOBS_COMPLETAR_UNIDAD_TERRITORIAL_SPEC.md` (stage 4)
- `ROUTINE_JOBS_ACTUALIZAR_PADRON_SPEC.md` (stage 5; in place: inserts new padrones, updates changed geometries, never deletes or renumbers)

Out of the job: the `pais*` shapefile load (done with the shp-db tool, which also unifies duplicate keys by columns).

## Stages

| # | Id | What it does | Writes to |
|---|----|--------------|-----------|
| 1 | `cargar-padrones` | paisrural + paisurbano -> padron staging table | padron staging table |
| 2 | `cargar-localidades` | insert new localities, update changed geometry | chosen `cadastral_locality` table(s) |
| 3 | `unidad-territorial` | insert new and update changed `territorial_unit` rows from `cadastral_locality` | chosen `territorial_unit` table |
| 4 | `completar-unidad-territorial` | create the `addresses_master` record of each unit without one and link it (`id_address_master`) | chosen `territorial_unit` and `addresses_master` tables |
| 5 | `actualizar-padron` | insert new padrones, update changed geometries in place, never delete or renumber ids; with its option on, also create and link the `addresses_master` record of each padron without one | chosen padron destination table (a test table, or `carto.padron`) and, with the option, `addresses_master` |

Manual comparison happens before stage 5 is run against `carto.padron`. Stages never auto-chain. Stage 5 links the padrones it inserts
itself (AP-51 to AP-60, behind the option "Enlazar direcciones maestras de los padrones"), so stage 4 never needs a re-run after stage 5.

## Requirements

- MJ-1: One dashboard entry "Actualización mensual de carto"; the two old entries and wizards are removed.
- MJ-2: One wizard. Step "Conexión" asks host, port, database, user, password once (saved-connection profile selector); the connection is shared by every stage.
- MJ-3: After the connection, a stage hub lists the stages in order with status (pending, done this session, failed). Any stage can be opened; a stage whose precondition is unmet shows why it is blocked.
- MJ-4: Each stage asks for its own schema(s) and tables when opened, never up front.
- MJ-5: Tables chosen in one stage prefill the same logical table in later stages (staging table, locality table(s), work table). The user can change them.
- MJ-6: Each stage keeps its own dry run, options, run, report, planned-step checklist and per-target lock exactly as in its stage spec. Re-running a stage is allowed.
- MJ-7: Each stage keeps its own endpoints and shared job store namespace; the stage id is the namespace. Catalog endpoints are shared.
- MJ-8: Stage 3 is specified in the section below and built after stage 2. Stage 4 is specified in `ROUTINE_JOBS_COMPLETAR_UNIDAD_TERRITORIAL_SPEC.md` and built after stage 3.
- MJ-9 (decision): There is no stage 6 "Aplicar padrones". Stage 5 inserts new padrones and updates changed geometries in place in the chosen destination table, so a separate apply stage is redundant. The job has five stages.
- MJ-10: Duplicate keys are not merged by the job: stage 5 keeps skipping and reporting them (`CLAVE_DUPLICADA`).
- MJ-11: Schemas are per stage: stage 1 uses one schema (bdj_carto); stage 2 uses a source schema plus a schema per target table; stage 5 uses a staging schema and a carto schema (the destination table lives in carto).
- MJ-13 (INVARIANT): no stage may replace, delete-and-reinsert or renumber ids in `carto.padron`, `territorial_unit` or `cadastral_locality`. Updates never put `id` in SET; inserts take ids from the table sequence; no DELETE or TRUNCATE on those tables; rows missing from the source are only reported. Reviewers check this on every diff.
- MJ-13 note (stage 5 pairs, AP-64 to AP-67): a padron that was reclassified (type, locality) or renumbered, with the same footprint, is updated in place: its `type_padron`, `id_cadastral_locality` and `number` change, its geometry too when Actualizar geometrías is on. The id, `id_address_master` and `id_province` never change, and the number changes only in a strict one-to-one pair.
- MJ-14: Every stage report CSV (stages 2, 3, 4 and 5) lists only the rows the report lists (capped at `DETAIL_LIST_LIMIT`). When a list is cut (real count greater than the list length) the CSV ends with one marker row per cut list: Tabla = target table, Cambio = `Lista incompleta: se muestran las primeras 500 de N <items>`, other cells empty. The helper is shared (`reportCsvRows.ts`).
- MJ-12: No inline styles; reuse the shared step checklist, report table, connection profile selector and table selector.
- MJ-15: Table pickers of stages 1-5 prefill fixed defaults from `src/modules/routine-jobs/config/monthlyTables.ts`. A value seeded by an earlier stage always wins over the default. The picker clears a value that is not in the schema listing (no error, no loop); it never clears while the listing loads or fails.

## Stage 3: Actualizar unidades territoriales

User query (insert only) is extended to insert-or-update. Source rows: every row of the chosen `cadastral_locality` table. Target: the chosen `territorial_unit` table.

- UT-1: User picks source locality table, target territorial_unit table and the unit type table; locality type name is an option, default `LOCALIDAD CATASTRAL`. Preflight: the type name must exist exactly once in the type table.
- UT-2: Match key is (id_province, name, id_territorial_unit_type = resolved type id). Matching without the type is wrong (other unit types share names).
- UT-3: Source rows with a null name or null province are skipped and reported. Rows whose key repeats in the source or in the target are skipped and reported (no guess).
- UT-4: Unmatched source row -> INSERT (name, id_territorial_unit_type, id_font = source id_font_type, id_province, geometry). `id` comes from the target sequence, `id_address_master` and `iso_code` stay null.
- UT-5: Matched row -> UPDATE geometry and id_font in place only when they changed (geometry compared with the same Hausdorff tolerance as stage 5, tolerance 1 m). `id`, `id_address_master`, name, province and type are never changed: ids feed padron.id_cadastral_locality and URNs.
- UT-6: Target rows of that type with no source row are only reported, never deleted.
- UT-7: Geometry follows the target column SRID/type; sources are transformed and made valid as in stage 5.
- UT-8: Dry run reports inserted, updated, unchanged, skipped and missing counts with samples. Real run is one transaction, then sequence repair and ANALYZE.
- UT-9: Preflight refuses when required target columns (name, id_territorial_unit_type, id_font, id_province, geometry) are missing or the source lacks name, id_font_type, id_province, geometry.
- UT-10: The pickers prefill the locality table from the stage 2 CARTO target (else `carto.cadastral_locality`), the type table `carto.territorial_unit_type` and the unit table `carto.territorial_unit`. The user can change them; the type name default is kept.

## Build order

1. Hub shell: shared connection step, stage hub, dashboard entry, removal of old entries, prefill store.
2. Stage 2 backend + endpoints + stage panel.
3. Adapt stages 1 and 5 panels into the hub (no behaviour change).
4. Stage 3 (UT-1..UT-9).
5. Stage 4 (CU-1..CU-17).
