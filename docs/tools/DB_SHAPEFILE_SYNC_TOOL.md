# DB vs. Shapefile Sync Tool

> **Location**: `src/app/tools/db-shapefile-sync/`  
> **Route**: `/tools/db-shapefile-sync`  
> **Status**: Implemented & Production Active

---

## 1. Overview

The **DB vs. Shapefile Sync Tool** correlates PostGIS spatial tables against ESRI Shapefiles (`.zip` containing `.shp`, `.dbf`, `.shx`, `.prj`, `.cpg`) and GeoJSON datasets.

Engineered with zero-allocation binary readers and string interning, it supports enterprise-scale cadastral layers containing over **1,000,000+ polygons** in the browser without memory exhaustion or UI thread freezes.

---

## 2. Wizard Workflow (Compare or Replace)

1. **Step 1: Database Connection & Table Introspection**
   - Connect to PostgreSQL/PostGIS (`DbConnectionForm`).
   - Introspects table columns, data types, primary keys, and spatial geometries.
2. **Step 2: Shapefile / GeoJSON Upload & Spatial Preview**
   - Upload compressed ESRI Shapefile archive (`.zip`) or raw GeoJSON (`.geojson`, `.json`).
   - Fast concurrent in-memory unzipping via `ZipShapefileExtractor`.
   - Low-level zero-allocation DBF/SHP inspection (`BinaryDbfReader`, `BinaryShpReader`) with string interning.
   - Dynamic projection conversion from metric/projected coordinates (e.g. UTM, Gauss-Krüger) to WGS84 (`EPSG:4326`) via `ProjectionEngine`.
   - **Sample Map Preview**: Previews up to `MAX_MAP_PREVIEW_FEATURES` (25,000 features) in Step 2 with an informative warning banner for large datasets, while retaining the full binary buffers in memory for 1M+ comparison.
3. **Step 3: Mode (Comparar / Reemplazo completo)** (`SyncModeStep`)
   - Compare runs the steps below. Replace is available only when the loaded file is a `.zip` Shapefile and the original `File` is still in memory; otherwise the option is disabled with an explanatory message and the wizard stays in compare mode.
   - Replace skips SUID mapping: Step 4 maps each target column to a DBF field, the geometry (`Geometría del archivo`) or a fixed default, then Step 5 shows a destructive confirmation (the qualified table label, the DB password, the SRID of the source with `.prj` prefill, and "Reiniciar secuencias del destino" on by default) and runs the server replace (`ShpReplaceRunPanel` takes over the page with upload, phase and result).
4. **Step 4: Composite SUID Mapping & Attribute Selection** (compare only)
   - Select single or multi-column composite SUID keys (`SuidMappingStep`).
   - Map DBF attributes to database columns and configure default values for required `NOT NULL` fields.
5. **Step 5: Sync Parameters** (compare only)
6. **Step 6: Comparison Audit, Full Discrepancy Map & SQL Patches** (compare only)
   - **Uncapped Discrepancies Map**: Renders 100% of discrepancy features and matches without truncation.
   - **Heap-Optimized Worker Execution**: Omitted non-actionable `ONLY_IN_DB` difference allocations, saving 30M+ heap objects.
   - **Instant SQL Preview**: Preview up to 25 UPDATE and 25 INSERT queries in `< 1ms`.
   - **Optimized Primary Key Updates**: Auto-detected database primary keys optimize `UPDATE` queries (`WHERE "id" = '123'`).
   - **Direct Transactional Execution**: Immediate modal opening on "Ejecutar en BD" with chunked execution and progress tracking.

---

## 3. Key Components & Architecture

- **[`ShapefileParser.ts`](src/services/parsers/ShapefileParser.ts)**: Fast ZIP extraction, binary DBF/SHP reading, projection transformation, and 25k sample preview generation.
- **[`LoadedShapefileCard.tsx`](src/components/tools/db-shapefile-sync/LoadedShapefileCard.tsx)**: Displays metadata, column lists, and sample preview map.
- **[`SpatialComparisonEngine.ts`](src/workers/comparison/SpatialComparisonEngine.ts)**: High-performance two-pass comparison engine running in a dedicated Web Worker.
- **[`SqlPatchGenerator.ts`](src/workers/comparison/SqlPatchGenerator.ts)**: SOLID-compliant SQL generator with primary key optimization and binary SHP geometry reconstruction.

## 4. Non-Unique Keys (Key Group Pairing)

- A SUID that appears more than once on either side (DB or file) forms a *collision group*. Keys with one row per side are compared exactly as before.
- Inside a group, byte-identical rows (same SUID, compared fields and rounded geometry) collapse into one representative per side: extra DB twins are reported as `DUPLICATE_SUID`, extra file twins are only counted in `duplicateFileRowsSkipped`.
- Remaining rows are paired 1:1: first by identical content, then greedily by geometry distance (ties broken by attribute differences and row order). A single leftover row on each side is paired by elimination. Paired rows are compared like any other row, so `ATTRIBUTE_MISMATCH` / `GEOMETRY_MISMATCH` stay visible; the item carries `pairing` (method, counts, distance).
- Leftover rows with no counterpart become `ONLY_IN_DB` / `ONLY_IN_SHP` (the latter become INSERTs). `DUPLICATE_SUID` now means: repeated identical DB rows, or rows that cannot be paired (geometry missing on a side, or the group exceeds the 40,000-candidate cap, counted in `pairingCappedGroups`).
- UPDATE guard: a paired row inside a group never generates an UPDATE unless a primary key column with a value identifies it (a composite-SUID `WHERE` would update the whole group). Skipped rows are counted in `unkeyedUpdatesSkippedCount` and a warning is shown.
- Attribute-only exact pass: after the full-content pass, leftover representatives are also paired 1:1 by attributes alone (SUID + compared fields, lowest row first) when at least one side has no usable geometry in the leftovers (e.g. CSV, or DB-to-DB without a geometry column). Otherwise geometry pairing decides.
- The 40,000-candidate cap applies to the geometry-row product (DB geometry rows x file geometry rows) after the exact pass, not to the raw group size.
- Unkeyed paired rows never produce an UPDATE (counted in `unkeyedUpdatesSkippedCount`). INSERTs generated from collision groups may repeat an existing key; a unique constraint would reject them.
- Counts reconcile: DB rows = match + attribute + geometry + onlyInDb + duplicate (DB side); file rows = match + attribute + geometry + onlyInShp + duplicate (file side) + skipped.

## 5. Selección de registros
La tabla de discrepancias incluye una casilla por registro (no por fila de campo). Solo los registros seleccionados alimentan el generador SQL, las vistas previas, los contadores y las acciones Copiar, Descargar y Ejecutar en BD.

- Seleccionables: `ATTRIBUTE_MISMATCH`, `GEOMETRY_MISMATCH` y `ONLY_IN_SHP`. Sin casilla: `ONLY_IN_DB`, `DUPLICATE_SUID`, `NULL_SUID`, `MATCH`.
- Registros emparejados sin clave primaria (`isUnkeyedPairedItem`): casilla deshabilitada ("Sin clave primaria: no se puede actualizar de forma segura").
- Por defecto se seleccionan todos los registros seleccionables y habilitados (constante `DEFAULT_SELECT_ALL = true` en `src/core/selection/selectionDefaults.ts`); el usuario puede usar "Limpiar selección". Sin selección no se invoca al worker y las acciones quedan deshabilitadas.
- La selección persiste entre paginación, filtros y pestañas; se reinicia al cambiar la comparación y se depura tras la re-analización posterior a una ejecución.
- Tras ejecutar un script, el estado "ejecutado" se reinicia cuando cambia la selección. Si la selección cambia mientras se genera el script completo, se descarta el resultado y se muestra "La selección cambió durante la generación del script. Vuelva a intentarlo."
- Barra de selección: "Seleccionar página", "Seleccionar todos (filtro actual)", "Deseleccionar página", "Limpiar selección".
- Las tarjetas KPI y el aviso de actualizaciones omitidas conservan los valores completos del motor.

## 6. Replace mode (server side)

Server-side replace of a PostGIS table from an uploaded Shapefile `.zip`. The wizard UI is in the Mode step (Step 3, "Reemplazo completo"): `ShpReplaceStep` (confirmation, SRID, password), `ShpReplaceRunPanel` (upload percentage, phase and result, with `ShpReplaceSummary`) and the client `src/core/services/shpReplaceRunStore.ts`, which survives in-app navigation and polls `status`. The endpoints are under `src/app/api/db/shp-replace/`, implemented in `src/core/services/server/shpReplace/`; the browser client is `src/core/services/shpReplaceClient.ts`.

- **`POST /api/db/shp-replace/upload`**: streams the raw `.zip` body (`request.body`, not buffered) to a temporary file. The file name goes in the `x-file-name` header and must end in `.zip`. Responds `{ success, uploadId, size }`. Errors: 400 (not a zip or no body), 413 (over the limit).
- **`POST /api/db/shp-replace/start`**: JSON body with `host`, `port`, `db_name`, `user`, `password`, `schema_name`, `table_name`, `uploadId`, `mapping` (`sourceByTarget`, `defaults`), `sourceSrid` (1 to 998999), `resetSequences` and `confirm: true`. Validates the body, takes a per-table lock (`host:port|db|schema|table`) and answers `200 { success, jobId }` at once. The replace runs in the background; the upload is deleted when the job ends, success or failure. Errors: 400 (invalid body or missing `confirm`), 404 (unknown upload), 409 (a job is already RUNNING for that table on that server).
- **`GET /api/db/shp-replace/status?jobId=...`**: returns the job snapshot (`state` RUNNING, DONE or FAILED, `phase`, `current`/`total`, `result` or `error`, and `outcomeUnknown` when the run failed with an unknown outcome). Passwords are scrubbed from error texts. Errors: 400 (missing `jobId`), 404 (unknown job).

Transaction (one `BEGIN` ... `COMMIT`, `pg` client with `statement_timeout = 4h` and `lock_timeout = 30s`):

1. Read the target catalog (columns, geometry SRID and type, source SRID in `spatial_ref_sys`) and validate the mapping before any write.
2. Stage every record in a `CREATE TEMP TABLE ... ON COMMIT DROP` via `COPY FROM STDIN`, then check the staged count equals the copied count.
3. `LOCK TABLE ... IN SHARE ROW EXCLUSIVE MODE`, count the previous rows, `DELETE FROM` the target (never `TRUNCATE`), then `INSERT ... SELECT` from the stage, reprojecting to the catalog SRID when it differs.
4. Sequences: derived from the catalog `nextval` defaults when not given. Unmapped sequences are reset when `resetSequences` is true; mapped ones are repaired with `setval`.
5. `COMMIT`, then `ANALYZE` on the target as its own statement. An `ANALYZE` failure is reported in `result.analyze` and does not roll back the replace.

Any failure before `COMMIT` rolls back and leaves the target unchanged. If `COMMIT` itself throws, the outcome is unknown: the job fails with `outcomeUnknown: true`, the UI shows an "Estado desconocido" warning with the job id and asks to verify the target before retrying, and no `ANALYZE` runs.

- Source CRS: the SRID input is prefilled from the `.prj` (`src/core/services/shpSrid.ts`). The EPSG authority wins; otherwise the ESRI name is matched, including SIRGAS-ROU98 (5381, and UTM 21S/22S as 5382/5383), generic `WGS_1984_UTM_Zone_NN[NS]` (32601 to 32760) and `SIRGAS_2000_UTM_Zone_18S` to `25S` (31978 to 31985). Under the input the step shows the file CRS name and EPSG code, or only the name when the code is unknown, or that no `.prj` is present.
- Dataset date: the quick-fill offered for an unmapped `date` or `timestamp` column in Step 4 is the newest modification date of the zip's `.shp` and `.dbf` entries, read from the zip central directory (`readZipEntryDates`). When there is no such entry, or the file is GeoJSON, it uses the file's `lastModified`.
- Geometry: at most one target column may map to the shapefile geometry. Only 2D geometries are accepted (`coord_dimension` above 2 is refused before any DELETE). A target SRID of 0 (unconstrained geometry) skips `ST_Transform`.
- Text cells: NUL characters are stripped before COPY; an all-NUL cell is stored as an empty string. Sessions use `client_encoding = 'UTF8'`.
- The run store polls `status` and gives up only after consecutive fetch failures span 60 s (`pollFailureGraceMs`); that failure is reported as an unknown outcome with the job id.

Limits: the upload is capped at **1 GiB** (`MAX_UPLOAD_BYTES`). Uploads are stored under `os.tmpdir()/gis-tools-shp-replace`; leftover uploads older than 2 h and finished jobs older than 1 h are swept opportunistically on the next upload or start. Jobs live in process memory (a `globalThis` singleton), so they do not survive a server restart.
