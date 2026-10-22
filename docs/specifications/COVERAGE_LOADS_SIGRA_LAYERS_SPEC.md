# Coverage Loads - SIGRA layers (WFS refresh): acceptance criteria

Migration of the Pentaho jobs in `C:\Alekos\Tasks\CGEO-2223\MIGRACION_PDI_WFS\<Layer>\` (`Principal.kjb`, `0_iniciar_auditoria.ktr`,
`2_extraccion_wfs.ktr`, `3_validacion.ktr`, `04_final_insertion.ktr`, `config.ini`) to gis-tools. Those jobs are the behavioural
oracle (outside the repo; do NOT open credential keys of `config.ini`, the URLs/tables/page sizes are safe). Prod-side notes:
`!!!NOTAS IMPLMENTACION IMPORTANTE.txt`, `Script_ejecutar_PRD*.sql`.

Why: the Avance FTTH rebuild joins to `public.area_zonas_ftth_f` and the `fuera_central` report reads `public.limite_central_ftth`,
and nothing in the workflow refreshed them. The other layers feed downstream consumers not migrated yet (the KML exports of the
Experto FTTH); they are loaded "just in case" and are optional.

Scope: module `src/modules/coverage-loads/`, a NEW part `sigra-layers/` (sibling of `indicators/`, `shp/`, `avance-ftth/`); it
imports only `shared/`, the module-root `constants.ts`/`types.ts` and its own files, and nobody imports it except the handler assembly, the manifest and the workflow stage list (`coverageStages.ts`). Target DB: the one chosen in
the shared connection step (HGDesa for real runs). This spec covers step 1 only (the load). KML export is a later step.

## How the legacy job works (per layer, identical pattern)
1. `etl_auditoria` row `INICIADO` (committed at once). 2. TRUNCATE the persistent `incoming_sgra_*` table. 3. WFS GeoJSON read in pages
(`<WFS_URL>&sortBy=..&count=<page>&startIndex=<n>`), loop until a page returns fewer than `page` features; each feature becomes one
staging row with `ST_SetSRID(ST_GeomFromGeoJSON(geometry), 31981)` (no reprojection), `ON CONFLICT (<key>) DO NOTHING`, `fechaact = now()`.
4. Validation: pass iff final table empty OR `count(staging)/count(final) >= 0.97` (the SQL comment says 80%, the code is 0.97: keep 0.97).
5. One transaction: TRUNCATE final, `INSERT .. SELECT` the final columns from staging, audit row `EXITO` with counts, COMMIT.
Errors write `ERROR` (+ step, message) to the audit row and abort.

## Differences (deliberate)
- D1 No persistent staging table. The staging is a session `TEMP` table built in the same transaction (`ON COMMIT DROP`), so the
  app needs no CREATE/DROP/TRUNCATE rights and never touches the `incoming_sgra_*` tables. Pages are inserted as they arrive
  (memory stays flat: tfo_divisores has ~289k features).
- D2 `DELETE FROM` instead of `TRUNCATE` for the final table (the app's DB role has no TRUNCATE; same decision as the rest of the
  module), under `LOCK TABLE <final> IN SHARE ROW EXCLUSIVE MODE`, taken only at swap time.
- D3 Stable paging: every page request carries `sortBy=<sort property>` (legacy omitted it for AreaCableCobre, AreaCableFTTH,
  AreaCajitasCobre, ZonasInseguridad, which can skip/duplicate features between pages). The sort property per layer is in the registry.
- D4 No `numberMatched` completeness check (user decision: keep the legacy 97% rule only).
- D5 A dry run ("Probar sin guardar") per layer: downloads, stages and validates exactly like a real load, then ROLLBACK. It does NOT
  take the lock nor run the DELETE/INSERT swap (a rolled-back swap would burn the final table's `gid` sequence and leave dead tuples on
  tables of up to ~289k rows, and the swap adds no verification: the TEMP table already copies the final column types; swap privileges
  are checked by the plan). It returns the same counts and the validation verdict, and writes no audit row.
- D6 No Pentaho variables/loop plumbing, no folders/mail.

## Layer registry (configuration, not literals)
One `sigra-layers/constants.ts` (+ registry file) holds every layer; nothing else names a table, typeName or property. Identifiers are
quoted from the registry only; nothing from a request reaches an identifier (a request carries only layer ids from the registry).
Base URL (constant): `http://vmlx-sgrabal-prod/geoserver/ows?service=WFS&version=2.0.0&request=GetFeature&outputFormat=application/json`.
Per layer: `id`, `label`, `required` (true only for the two Avance layers), `etlName` (audit), `typeName`, optional `cql`, `pageSize`,
`sortBy`, `finalTable`, `keyColumn` (conflict key of the staging), `geomColumn` (`geom` or `geometry`), `columns[]`
(target column <- WFS property | derived expression), optional `extraStagingColumns[]`.
All geometry arrives as GeoJSON in SRID 31981. Every staging row also gets `fechaact = now()` (column type of the target) and
`fuente = 'SIGRA/WFS'` where the target has `fuente` (see per-layer notes). Target columns not listed stay NULL/default.
Final table columns not mentioned here (x, y, status, direccion, id_site_holder, txt_geometria, gid...) are NOT written (gid default).

| id | etlName | final table | typeName (cql) | page / sortBy | key |
|---|---|---|---|---|---|
| zonas-ftth* | Area_Zonas_FTTH | public.area_zonas_ftth_f | WFS_SI:AREA_ZONA_FTTH_F | 2000 / ID_AREA | id_distrito |
| limite-central-ftth* | Area_Centrales_FTTH | public.limite_central_ftth | WFS_SI:LIMITES_CENTRALES_F (`CR_SITE_TYPE_ID=9 AND CENTRAL_NOMBRE LIKE '%FTTH'`) | 2000 / ID_AREA | id_area |
| area-cd-sr | Area_CDSR | public.area_cd_sr | AREA_CD_SR_F | 2000 / ID | id_area_sgra |
| area-cable-cobre | Area_Cable_Cobre | public.area_cable_cobre_f | AREA_CABLE_COBRE_F | 1000 / ID_AREA_SGRA | id |
| area-cable-ftth | Area_Cable_FTTH | public.area_cable_ftth_f | AREA_CABLE_FTTH_F | 1000 / ID_AREA | id_area |
| area-cajitas-cobre | Area_Cajitas_Cobre | public.area_cajitas_f | AREA_CAJITAS_F | 5000 / ID_AREA | id_area |
| area-tfo | Area_Cajitas_FTTH | public.area_tfo_f | AREA_NAPS_F | 5000 / ID | id_area_tfo |
| limite-central-cobre | Area_Centrales_Cobre | public.limite_central_cobre | WFS_SI:LIMITES_CENTRALES_F (`CR_SITE_TYPE_ID=5`) | 2000 / ID_AREA | id_area |
| limite-economico-cobre | Area_Limite_Eco_Cobre | public.limite_economico_cobre | WFS_SI:AREAS_ADMINISTRATIVAS_F (`AREA_TIPO='LIMITE_ECONOMICO_COBRE'`) | 2000 / ID_AREA | id_area |
| limite-mixto-cobre | Area_Limite_Mixto_Cobre | public.limite_mixto_cobre | WFS_SI:AREAS_ADMINISTRATIVAS_F (`AREA_TIPO='LIMTE_MIXTO'`, sic: verified 263 features) | 2000 / ID_AREA | id_area |
| caja-distribucion | Cajas_Distribucion | public.caja_distribucion_f | WFS_SI:CAJA_DISTRIBUCION_F | 2000 / ID | id |
| cajitas-cobre | Cajas_Cobre | public.cajitas_f | WFS_SI:CAJITAS_LOGICAS_F | 5000 / CAJITA_ID | cajita_id |
| tfo-divisores | Cajas_FTTH | public.tfo_divisores | WFS_SI:DO_ACCESO | 5000 / SPID | spid (staging only) |
| camaras | Camaras | public.camaras_f | WFS_SI:CAMARAS_F | 5000 / ID_SGRA | id_sgra |
| centrales-cobre | Centrales_Cobre | public.centrales_cobre | WFS_SI:CENTRALES_F (`TIPO_DE_CENTRAL='CENTRAL COBRE'`) | 5000 / ID | id_sitio |
| centrales-ftth | Centrales_FTTH | public.centrales_ftth | WFS_SI:CENTRALES_F (`TIPO_DE_CENTRAL='CENTRAL FTTH' AND NOMBRE LIKE '%FTTH'`) | 5000 / ID | id_sitio |
| postes | Postes | public.postes | WFS_SI:POSTES_F | 5000 / ID | id_sgra |
| zonas-inseguridad | Zonas_Inseguridad | public.limite_de_inseguridad | AREAS_ADMINISTRATIVAS_F (`AREA_TIPO='ZONA_DE_INSEGURIDAD'`) | 1000 / ID_AREA | id_area |

`*` required layers. typeNames with and without the `WFS_SI:` prefix are as in the legacy configs (both resolve; verified live).
CQL values are URL-encoded when sent. NOT in the registry: `infra-canalizada` (see Dropped). 18 layers in total.

### Column mappings (target column <- WFS property)
- zonas-ftth: `id_distrito <- ID_AREA`; `edificio <- left(EDIFICIO,10)`; `identificacion_de_la_central <- EDIFICIO`;
  `codigo_distrito <- CODIGO_AREA`; `nombre_central <- CENTRAL_NOMBRE`; `cable <- substring(CODIGO_AREA, chars 2..4)` (0-based [1,4));
  `zona <- substring(CODIGO_AREA, chars 6..7)` (0-based [5,7)); `conca <- CENTRAL_NOMBRE.replace(" FTTH","C") + cable.substr(1,2) +
  "ZONA " + zona` (JS: only the FIRST " FTTH" replaced, NULL treated as ""; e.g. `C009Z04`/`AGUADA FTTH` -> cable `009`, zona `04`,
  conca `AGUADAC09ZONA 04`); `situacion_distrito <- SITUACION`; `id_terminalfibraoptica <- ID_EMPALME`;
  `codigo_terminalfibraoptica <- CODIGO_EMPALME`; `situacion_geom <- SITUACION_GEOM`; `fuente`. (The legacy also reads OT_* properties
  into staging but the final table never receives them: not loaded. Legacy reads `OT_ACTUAL_COD`, the WFS property is `OT_ACTUAL_CODIGO`.)
- limite-central-ftth / limite-central-cobre: `id_area <- ID_AREA`; `edificio <- EDIFICIO`; `id_sitio <- ID_SITIO`;
  `codigo_sitio <- EDIFICIO`; `nombre_central_ftth|nombre_central_cobre <- CENTRAL_NOMBRE`; `cr_site_ty <- CR_SITE_TYPE_ID`;
  `area_m2 <- ST_Area(geom)`; `fuente`.
- area-cd-sr: `id_area_sgra <- ID`; `codigo <- CODIGO`; `edificio <- EDIFICIO`; `situacion <- SITUACION`; geom col `geom`; NO `fuente`.
- area-cable-cobre: `edificio, codigo, tipo_area <- TIPO_AREA, id <- ID_AREA_SGRA, situacion`; geom col `geometry`; NO `fuente`.
- area-cable-ftth: `id_area <- ID_AREA; edificio; identificacion_central <- IDENTIFICACION_CENTRAL; nombre_central <- NOMBRE_CENTRAL;
  codigo; situacion; tipo_area`; `area_m2 <- ROUND(ST_Area(geom)::numeric, 3)`; `fuente`.
- area-cajitas-cobre: `id_area <- ID_AREA; codigo_area <- CODIGO_AREA; central_nombre <- CENTRAL_NOMBRE; edificio; situacion;
  id_cajita <- ID_CAJITA; codigo_cajita <- CODIGO_CAJITA; caja_de_distribucion <- CAJA_DE_DISTRIBUCION`; geom col `geometry`; NO `fuente`.
- area-tfo: `id_area_tfo <- ID; edificio; cable <- CABLE; zona <- ZONA; codigo_area <- CODIGO; situacion_area <- SITUACION`; `fuente`.
- limite-economico-cobre / limite-mixto-cobre: `id_area, codigo, edificio, area_tipo <- AREA_TIPO, clasificacion, observacion`;
  `area_m2 <- ST_Area(geom)`; `fuente`.
- zonas-inseguridad: same columns as limite-economico-cobre (`area_m2 <- ST_Area(geom)` too); `fuente`.
- caja-distribucion: `id <- ID; central <- CENTRAL; code <- CODE; status <- STATUS`; NO `fuente`.
- cajitas-cobre: `cd <- CD; activa <- ACTIVA; cajita_id <- CAJITA_ID; edificio; nro <- NRO`; geom col `geometry`; NO `fuente`.
- tfo-divisores: `id_terminalfibra <- TFOID; edificio_terminalfibra <- TFOEDIFICIO; cable_terminalfibra <- TFOCABLE;
  zona_terminalfibra <- TFOZONA; codigo_terminalfibra <- TFOCODIGO; situacion_terminalfibra <- TFOSTATUS; observacion <- TFOOBS;
  codigo_divisoroptico <- DIVISOR; situacion_divisoroptico <- DIVISORSTATUS`; `fechacarga = now()::date` (this table has `fechacarga`
  instead of `fechaact`); `fuente`. `spid <- SPID` is an extra staging column (the final table has none): it is the dedup key only.
- camaras: `id_sgra <- ID_SGRA; edificio; codigo; tipo; situacion`; geom col `geometry`; NO `fuente`.
- centrales-cobre / centrales-ftth: `id_sitio <- ID; codigo_sitio <- EDIFICIO; nombre_central_cobre|nombre_central_ftth <- NOMBRE;
  rotation <- ROTATION; tipo_de_central <- TIPO_DE_CENTRAL`; `fuente`; `edificio` stays NULL (as legacy).
- postes: `id_sgra <- ID; tipo; codigo_sga <- CODIGO_SGA; altura; material; situacion; perforada; base_hormigonada <- BASE_HORMIGONADA;
  rotation`; `latitud <- ST_Y(ST_Transform(geom,4326))`, `longitud <- ST_X(ST_Transform(geom,4326))`; `fuente`.
Property names are the UPPERCASE WFS names (`$.features[*].properties.<NAME>`); a missing property is NULL (legacy
`defaultPathLeafToNull`). Properties are read by exact name from each feature.

## Dropped: infra-canalizada
The legacy job is broken (inserts centrales columns into a table that does not exist; never reached `EXITO`) and
`public.canalizacion_antel` has no real columns. User decision: forget it; it is NOT in the registry and not in scope.

## Plan (read only)
- AC-1: `POST sigra-layers/plan` (JSON: `connection`, optional `layerIds`) reads, in `BEGIN READ ONLY`, for each registry layer: final
  table row count, `max(fechaact|fechacarga)`, privilege shortfalls (SELECT/INSERT/DELETE on the final table, `USAGE` on its serial
  sequences, `TEMP` on the database), and whether `public.etl_auditoria` exists with SELECT, INSERT and UPDATE (the audit `RETURNING`/`WHERE id_auditoria` need SELECT). A
  layer whose final table is not readable reports `rowCount`/`lastUpdated` null plus the missing privileges; it never throws. It also probes the WFS (one request,
  `count=1`, per layer, with the layer's own typeName/cql) returning `numberMatched` for information. Writes nothing. A layer whose WFS
  probe fails is reported with the error text and cannot be loaded.
- AC-2: Blockers: connection failure; for a selected layer a privilege shortfall or a missing final table or an unreachable WFS.
  Warnings: audit table missing/unwritable (the load still runs, no audit rows).

## Load
- AC-3: `POST sigra-layers/load` (JSON: `connection`, `layerIds[]`, `dryRun`, `confirm`). `layerIds` must be registry ids (unknown -> 400); empty or null -> 400;
  `dryRun`/`confirm` must be booleans when present (else 400); a real load (`dryRun` false) requires `confirm: true` (400 otherwise, same pattern as Avance); any
  selected layer with a blocker -> 409 with the plan and nothing is loaded.
  Layers load sequentially, each in its OWN transaction (one failing layer does not undo the others); the response lists a per-layer
  result. The two required layers are always allowed individually.
- AC-4: Per layer, in one transaction: `CREATE TEMP TABLE` staging as the final table's columns that the registry lists plus
  `extraStagingColumns`, `ON COMMIT DROP`, without defaults/sequences (no `gid` burn), with a unique index on `keyColumn`; fetch pages
  (D3) sequentially; insert each page with the mapping above using `INSERT .. SELECT .. FROM unnest(..)` batches and
  `ON CONFLICT (keyColumn) DO NOTHING`; stop at the first page with fewer features than `pageSize`; the page request has a timeout
  (named constant) and a bounded retry count (named constant, default 2) before the layer fails.
- AC-5: Validation (D4): `ok` iff `count(final) = 0` OR `count(staging)::float / count(final) >= 0.97` (named constant). Not ok -> the
  layer is ROLLED BACK untouched with a Spanish message that names both counts.
- AC-6: Swap (not dry run): `LOCK TABLE <final> IN SHARE ROW EXCLUSIVE MODE`, `DELETE FROM <final>`, `INSERT INTO <final> (<columns>)
  SELECT <columns> FROM staging`, verify inserted = staging count, COMMIT. Dry run (D5): everything up to and including the validation,
  then ROLLBACK (the verdict and counts are returned, the final table and its sequence are untouched).
- AC-7: Audit (when the table exists and is writable): before the transaction, in its own autocommitted statement, insert
  `(etl_nombre = etlName, estado = 'INICIADO')` and keep the id; after the outcome, in a separate statement,
  `UPDATE .. SET estado='EXITO'|'ERROR', fecha_fin=now()`, `registros_extraidos` = staging count, `registros_insertados` = rows swapped,
  and on error `paso_error` (`wfs` | `insert` | `validacion` | `swap`), `mensaje_error`, `transform_error` (= failing step). A dry run writes
  no audit rows. An audit failure never fails the load (it becomes a warning in the result).
  Audit rows follow the legacy convention: on success `registros_extraidos` = `registros_insertados` = staged count; on error no counts
  (both null) and the failing step is in `transform_error`. A layer whose WFS returns 0 rows into an empty final table is accepted as
  `loaded` (legacy rule, deliberate).
- AC-8: Failure of any step rolls the layer back (final table unchanged), marks the audit `ERROR`, and the result for that layer says
  which step failed. Secrets (connection credentials) never appear in results, logs or errors.
- AC-9: Result per layer: `layerId`, `status` (`loaded` | `dry-run-ok` | `rejected-validation` | `failed`), `downloaded` (features
  received), `staged` (distinct keys inserted), `duplicatesIgnored`, `previousCount`, `finalCount`, `elapsedMs`, `step`, `message`.

## Workflow and UI
- AC-10: In the FTTH load type the workflow gets a new stage "Capas SIGRA" between Conexion and the Avance stage. It lists the two
  required layers (pre-selected, cannot be unchecked) and the optional layers in five groups (Necesarias, Áreas, Centrales y límites, Cajas y
  divisores, Red y seguridad), unchecked by default, plus "Seleccionar todas" and "Solo obligatorias". It shows per layer: current rows, last
  `fechaact`, WFS count, and the result after a run. "Probar sin guardar" is available. "Cargar y reemplazar" asks for an inline confirmation that states how many tables will be replaced
  (and that optional layers are included, with no undo). The client loads ONE layer per request, sequentially, so progress is shown, partial
  results are kept and the gate reflects what really committed; a real load is followed by a new plan to refresh the counts.
- AC-11: The Avance stage stays disabled until both required layers were loaded (status `loaded`) in this session; a dry run does not
  unlock it. Optional layers never gate anything. The stage cannot be omitted. Confirming a DIFFERENT connection puts the stage back to
  pending (and so relocks Avance): the zones were refreshed on another database. UI strings are Spanish.
- AC-12: The stage belongs to the FTTH load type only (the Cobertura type does not show it); extending it later is a separate decision.

## Non-functional
- AC-13: Memory stays bounded by one page (largest page 5000 features); no response body is buffered beyond one page.
- AC-14: Endpoints are POST, declared in `module.routes.json` (`sigra-layers/plan`, `sigra-layers/load`) with the generated routes
  kept in sync (`npm run modules:routes:check`).
- AC-15: Pure domain code (registry validation, page URL builder, row mappers incl. `conca`, validation verdict, result shapes) is
  unit-tested without a DB; SQL paths run on the PGlite harness with PostGIS stubs (as in avance-ftth) and a mocked `fetch`.
  Spatial SQL (`ST_Area`, `ST_Transform`, `ST_SetSRID`, `ST_GeomFromGeoJSON`) can only be verified on HGDesa (dry run).

## Additions beyond the original draft (decided during implementation)
`confirm` flag; mandatory stage; per-layer requests from the client; the inline confirmation; a plan warning when the WFS count is below the 97% of
the table; `auditWarning` in each result; a guard that fails a layer (step `wfs`) when a FULL page stages no new row (a WFS that ignores `startIndex`);
the staging table is built from the catalog so that the final table takes no lock during the download; `lock_timeout` 30 s and `statement_timeout` 10 min on
the load transaction; `sequentially.ts` moved to `shared/`.

## Open points
- O2 Whether the two required layers should refresh automatically when a stale-days threshold is crossed (not in scope).
- O3 The app server must reach `vmlx-sgrabal-prod` (verified reachable from the developer machine only).
