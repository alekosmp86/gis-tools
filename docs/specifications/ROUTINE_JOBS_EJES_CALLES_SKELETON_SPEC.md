# Routine jobs: "Carga de ejes de calles" (EJ-1 to EJ-24)

## Context

The street axes (ejes de vía de circulación) arrive in the staging table `bdj_carto.ide_ejesviacirculacion`, filled with the csv-db tool (Comparar, key `reftramo + localidad + departamento`; geometry in `geom` as MultiLineString/LineString 32721 from the CSV EWKB). This job moves them into the final `carto` tables incrementally. The table `bdj_carto.ide_ejevisualizador` is not used any more.

Facts read from preprod (not rules):
- `carto.road_section` key is `reftramo_ideuy` (also what `access_point.id_road_section` stores: 899,501 of 968,402 access points match by `reftramo`, 549 by `id`); `id_circulation_way` stores the IDE `idcalle` (= `circulation_way.id_calle`); `id_road_section_type` maps 1:1 from `tipo_vialidad` (CALLE 4, CALLE INTERNA 20, PASAJE 10, PASAJE INTERNO 21, PEATONAL 11, Ruta 1, SENDERO 15, VIRTUAL 19); `id_font` maps from `fuente` with the fixed table of `bdj_carto.bdj_ejes` (ANC 8, CARGA_MASIVA 35, DESDE_TSUBASA 34, Google 33, IDE 1, INE 3, INTENDENCIA_DE_CANELONES 13, INTENDENCIA_DE_CERRO_LARGO 14, INTENDENCIA_DE_DURAZNO 16, INTENDENCIA_DE_FLORES 17, INTENDENCIA_DE_FLORIDA 18, INTENDENCIA_DE_MALDONADO 20, INTENDENCIA_DE_MONTEVIDEO 21, INTENDENCIA_DE_RIVERA 24, INTENDENCIA_DE_ROCHA 25, INTENDENCIA_DE_SALTO 26, INTENDENCIA_DE_SAN_JOSE 27, INTENDENCIA_DE_SORIANO 28, INTENDENCIA_DE_TACUAREMBÓ 29, MTOP 7, OSM 32, UTE 31).
- Every section has an `addresses_master` row with URN `cgeo:road_section:id:<road_section.id>`, `latitud` 0 and `longitud` 0. Nothing has a foreign key to `road_section`.
- `cloc_iso` (used by `mv_road_section` and `mv_road_section2`) is a 7-character locality code or a 4-character department code for rural sections. Taking the INE locality polygon (`bdj_carto.ine_localidades_pg`, SRID 32721) with the longest intersection, and the department code otherwise, equals the visualizador's value in 98.0% of a 19,861-row sample.
- pgRouting 3.3.0 in preprod: `pgr_createTopology` accepts `rows_where` and reuses existing vertices.
- The views `bdj_ejes`, `mv_road_section`, `mv_road_section2` still read the visualizador; an admin must redefine them. Outside this job.

## Job and endpoints

- EJ-1: A job `ejes-calles`, title "Carga de ejes de calles", is its own card in Trabajos de rutina (after "Carga de padrones"), with a one-sentence description and its own wizard (same "Volver a la lista" behaviour as the other jobs).
- EJ-2: Endpoints `POST ejes-calles/start` and `GET ejes-calles/status` (in `module.routes.json`), following the other jobs: connection in the body, table roles, polled `jobId`, one running job per target, Spanish errors, the password never logged or returned.
- EJ-3: The request carries `dryRun`. `dryRun: true` runs the analysis (EJ-8 to EJ-12) and writes nothing. `dryRun: false` is refused with 400 and "La carga real de ejes de calles todavía no está disponible." until EJ-13 to EJ-21 are delivered and enabled by the user.

## Tables

- EJ-4: Table roles (schema and table editable, default, access, required logical columns):

| Role | Default | Access | Required columns |
|---|---|---|---|
| Ejes de vía de circulación (staging) | `bdj_carto.ide_ejesviacirculacion` | read | `reftramo`, `idcalle`, `nombre`, `tipo_vialidad`, `fuente`, `localidad`, `departamento`, `geom` |
| Tramos de calle | `carto.road_section` | write | `id`, `reftramo_ideuy`, `id_circulation_way`, `id_road_section_type`, `id_font`, `id_address_master`, `source`, `target`, `distance`, `geometry` |
| Vías de circulación | `carto.circulation_way` | write | `id`, `name`, `short_name`, `id_road_type`, `id_font`, `id_calle` |
| Direcciones maestras | `carto.addresses_master` | write | `addresses_master_id`, `urn`, `latitud`, `longitud` |
| Vértices de ruteo | `carto.road_section_vertices_pgr` | write | `id`, `the_geom` |
| Puntos de acceso | `carto.access_point` | write | `id`, `id_road_section` |
| Localidades INE | `bdj_carto.ine_localidades_pg` | read | `cloc_iso`, `geom` |
| Departamentos | `carto.mv_country_province` | read | `iso_code_dpto`, `name_dpto` |

- EJ-5: Table, column and SRID resolution and privileges follow the shared helpers of `jobs/shared`. The preflight requires `SELECT` on read roles and `SELECT`, `INSERT`, `UPDATE`, `DELETE` (and sequence usage) on write roles. In a dry run missing write privileges are reported as information, in a real run as blockers. No two roles may be the same table.

## Mappings

- EJ-6: `tipo_vialidad` maps to `id_road_section_type` with the table above (constant in the job). A value outside the table is a blocker, listed with its row count.
- EJ-7: `fuente` maps to `id_font` with the table above. A value outside the table is a blocker (never `0`).

## Analysis (read-only, one transaction)

- EJ-8: Staging checks: rows, distinct `reftramo`, `reftramo` that repeat (groups and rows), `reftramo` that is not an integer, rows with NULL or empty geometry, rows with an unknown `tipo_vialidad` or `fuente`, rows with an empty `idcalle`, rows whose `nombre`, `localidad` or `departamento` contain U+FFFD (`chr(65533)`, damaged encoding). The last one blocks with "Hay N filas con caracteres dañados (�) en nombre, localidad o departamento. Corrija la codificación y vuelva a cargar." Any of these except the counts is a blocker for the apply.
- EJ-9: Each staging section is matched to `road_section.reftramo_ideuy` and classified: NEW (not in `road_section`), UNCHANGED, ATTR (`nombre`, `idcalle`, type or font changed), GEOM (geometry differs beyond 4 decimals in degrees, as Comparar; two geometries whose Hausdorff distance is below `GEOMETRY_TOLERANCE_M`, 0.001 m, are the same: a coordinate rounded to the other side of the snap grid is not a change. On dev this removes the 54 false GEOM left once the invalid file geometries are skipped; the other 557 of the 611 were those invalid geometries compared with the real line) and both when both change.- EJ-10: A `road_section` row that is not in staging is REMOVED. A REMOVED section whose length is covered at least 95% (within 1 m) by NEW sections of the same `idcalle` is a SPLIT (one old, many new); NEW sections that together cover at least 95% of the length of several REMOVED sections of the same `idcalle` are a MERGE (many old, one new); the remaining REMOVED are plain removals.
- EJ-11: `cloc_iso` of every NEW and GEOM section is computed: the INE locality polygon with the longest intersection with the section, the department code (from `departamento`, via `mv_country_province.iso_code_dpto`) when none intersects. The report shows how many got a locality and how many only a department.
- EJ-12: The report shows the counts of EJ-8 to EJ-11 as cards, the lists (SPLIT, MERGE, plain removals, new streets, ATTR) as expandable tables with the `reftramo` involved, the number of `access_point` rows that each REMOVED section holds, the privilege information, and the banner "Análisis: no se modificó ninguna tabla."

## Apply (real run)

- EJ-13: The real run needs the password, the Revisar summary and the acceptance of the review lists of EJ-12 (SPLIT, MERGE, plain removals), each with "Aceptar" per row and "Aceptar todos", as the partial-match pairs of padrones. Only accepted removals, splits and merges are applied; the rest are skipped and reported.
- EJ-14: The apply is one transaction that locks the destination tables, and ends with `ANALYZE` on the changed tables. A failed COMMIT is reported as outcome unknown, as in the other jobs. Before the first write the job writes a gzip revert SQL file like actualizar-padron, registered and shown in the result.
- EJ-15: `circulation_way`: new `(id_calle, name)` pairs are inserted with the type and font of the first section and a `short_name` built with the abbreviation rules (EJ-23). Existing rows are not changed.
- EJ-16: `road_section` NEW: inserted with `reftramo_ideuy`, `id_circulation_way` = `idcalle`, the mapped type and font, `geometry` as one `LineString` (`ST_LineMerge`; if it stays multi-part the row is a blocker), `distance` = `ST_Length` with two decimals as text, and `id_address_master` of the row created by EJ-17.
- EJ-17: For each NEW section an `addresses_master` row is inserted (`urn` = `cgeo:road_section:id:<road_section.id>`, `latitud` 0, `longitud` 0) and linked to it.
- EJ-18: ATTR and GEOM sections update only the changed columns; a GEOM change recomputes `distance` and clears `source` and `target` so the topology step (EJ-20) reassigns them.
- EJ-19: Accepted SPLIT and MERGE: the new sections are inserted as NEW; the `access_point` rows of each old section are reassigned (`id_road_section` = `reftramo` of the new section) to the new section nearest to the point (`ST_Distance`, tie broken by the lower `reftramo`); then the old sections and their address masters are deleted. The result lists every reassigned point (old and new `reftramo`, distance). No row is deleted before its points are reassigned.
- EJ-20: Topology: for sections with a NULL `source` or `target`, `pgr_createTopology` with `rows_where` over the new and changed rows (tolerance 0.1 m), reusing existing vertices; afterwards vertices that no section uses are deleted. The job checks `pgr_version()` first; a version without `pgr_createTopology` is a blocker.
- EJ-21: Plain removals (a section with no replacement): an accepted section with no `access_point` rows is deleted together with its address master. A section that holds access points is never deleted: it is skipped and reported with its `reftramo`, `idcalle` and number of access points, as padrones reports what it cannot change.
- EJ-22: After the apply the result shows "Siguiente paso sugerido": an administrator must refresh `bdj_ejes` (while it exists), `mv_road_section`, `mv_road_section2` and `mv_addresses_2_0`, with the command text like padrones.
- EJ-23: The `short_name` abbreviation rules (taken from `CirculationWay22.sql`) are one constant list in the job, applied only to the new `circulation_way` rows.

## Wizard

- EJ-24: Steps Conexión, Tablas, Revisar and Resultado on the shared orchestrator. Revisar has "Analizar"; "Cargar ahora" is enabled only after an analysis of the same staging data and when EJ-8 has no blocker. Resultado shows progress, the report, the review lists of EJ-13 and "Nueva carga". State, steps and run store live beside the other jobs' (`ui/ejesCallesWizardState.ts`, `ui/ejesCallesWizardSteps.ts`, `ui/ejesCallesRunStore.ts`).

## Documentation and tests

- Wiki page `ejes-calles.md` and a line in its index. Unit tests per the project's testing standards (mapping tables, classification, split/merge detection, access point reassignment, request parsing, wizard state); real SQL behaviour tested on PGlite where PostGIS is not needed, and the geometry-dependent queries tested with the SQL builders. The wiki content test keeps passing.

## Out of scope

- Redefining `bdj_ejes`, `mv_road_section`, `mv_road_section2` (admin).
- Dropping `ide_ejevisualizador` (the user does it).
- CSV download of the report.

## Acceptance criteria count

EJ-1 to EJ-24 (24 criteria).
