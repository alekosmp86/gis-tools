# DB vs. CSV Sync Tool

> **Location**: `src/app/tools/db-csv-sync/`  
> **Route**: `/tools/db-csv-sync`  
> **Status**: Implemented & Production Active

---

## 1. Overview

The **DB vs. CSV Sync Tool** provides high-speed correlation, schema introspection, and spatial/attribute discrepancy auditing between a PostgreSQL/PostGIS database table and a delimited CSV file (`.csv`, `.txt`).

It natively supports PostGIS geometry representations encoded in tabular data, including:
- Extended Well-Known Binary (**EWKB Hex**) strings (e.g. `0101000020E77E0000...`)
- Well-Known Text (**WKT**) strings (e.g. `POINT(-56.12 34.56)`, `POLYGON(...)`)
- Separate Latitude/Longitude coordinate columns (`lat`/`latitude`, `lng`/`lon`/`longitude`)

---

## 2. 4-Step Wizard Workflow

1. **Step 1: Database Connection & Table Introspection**
   - Connects to PostgreSQL/PostGIS (`DbConnectionForm`).
   - Introspects table columns, data types, primary keys, and spatial geometries.
2. **Step 2: CSV File Upload & Spatial Preview**
   - File upload zone with drag-and-drop support (`FileDropzone`).
   - In-memory parsing via `CsvParser` with automatic delimiter detection (`,`, `;`, `\t`) UTF-8 BOM removal and automatic UTF-8 / Windows-1252 decoding (`core/common/csvTextDecoding.ts`).
   - **Interactive Map Preview with Feature Capping**: Initial spatial preview in Step 2 is capped at `MAX_MAP_PREVIEW_FEATURES` (25,000 features) to ensure instant rendering and 60fps UI responsiveness, displaying a warning banner if the file exceeds this threshold.
   - The complete, uncapped dataset is retained in memory for subsequent steps.
3. **Step 3: SUID Mapping & Attribute Configuration**
   - Configure single or multi-column composite SUID keys (`SuidMappingStep`).
   - Select attributes to compare, toggle geometry comparison, and configure default values for database `NOT NULL` columns.
4. **Step 4: Audit Results, Discrepancies Map & SQL Patches**
   - **Full Discrepancy Map**: Displays 100% of spatial discrepancies and matching features without any capping or truncation.
   - **Instant SQL Preview**: Generates instant SQL previews (`< 1ms`) for up to 25 UPDATE and 25 INSERT queries, while accurately reporting the total discrepancy counts.
   - **Primary Key WHERE Optimization**: Generates optimized `UPDATE` statements using detected primary keys (`WHERE "id" = '123'`), bypassing slow composite multi-column sequential scans.
   - **Direct Execution Modal**: Immediately opens the transactional PostGIS SQL execution modal on "Ejecutar en BD", offloading full script generation and batch execution to background workers.

---

## 3. Key Components & Architecture

- **[`CsvParser.ts`](src/services/parsers/CsvParser.ts)**: High-speed delimiter detection, line splitting, BOM handling, and EWKB/WKT/LatLng spatial parsing.
- **[`CsvUploader.tsx`](src/components/tools/db-csv-sync/CsvUploader.tsx)**: Manages Step 2 upload state, column tags, and capped preview map.
- **[`SqlPatchGenerator.ts`](src/workers/comparison/SqlPatchGenerator.ts)**: Generates PostGIS `UPDATE` and `INSERT` statements with geometry support for both binary Shapefile and CSV sources.
- **[`SpatialMapPreview.tsx`](src/components/shared/SpatialMapPreview.tsx)**: High-performance Leaflet Canvas renderer streaming vector features via Web Worker chunks.

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

Server-side replace of a table from an uploaded CSV, same pipeline and UX as the Shapefile replace (`DB_SHAPEFILE_SYNC_TOOL.md` section 6; spec `docs/specifications/DB_CSV_REPLACE_TARGET_SPEC.md`, CR-1 to CR-14). The tool page has a Mode step (Step 3, `SyncModeStep`): *Comparar* keeps the SUID flow (Steps 4 to 6); *Reemplazo completo* goes to the column mapping (Step 4, `ColumnMappingStep`) and the confirmation (Step 5, `ShpReplaceStep`), then to the run panel (`ShpReplaceRunPanel`). The rows parsed in the browser are not sent: the raw file is uploaded and parsed on the server.

- Client: `src/components/tools/db-csv-sync/csvReplaceWizardSteps.tsx`; `src/core/services/csvReplaceRunStore.ts` (its own run store, built with `ReplaceRunStore` from `replaceRunStoreFactory.ts`, so a CSV run and a Shapefile run never share state; it survives in-app navigation and polls `status` with the 60 s poll grace); the shared mapping hook `useFileReplaceMapping`; and the route-parametrised helpers of `shpReplaceClient.ts` (`uploadReplaceFile`, `startReplaceJob`, `fetchReplaceJobStatus`).
- Endpoints (`src/app/api/db/csv-replace/`, handlers in `src/core/services/server/csvReplace/csvReplaceHandlers.ts`):
  - `POST /api/db/csv-replace/upload`: raw streamed body, `x-file-name` header ending in `.csv` or `.txt`, stored as `os.tmpdir()/gis-tools-csv-replace/<uuid>.csv` (`CSV_UPLOAD_PROFILE`), 1 GiB cap named in the 413 message, leftovers older than 2 h swept.
  - `POST /api/db/csv-replace/start`: same JSON body as the Shapefile `start` (`confirm: true`, connection, table, `uploadId`, `mapping`, `sourceSrid`, `resetSequences`); `geometryProcessing` and `dryRun` are ignored (no analysis mode). Takes the per-table lock shared with the Shapefile replace, answers `200 { jobId }` and runs in the background. 400 / 404 / 409 as in the Shapefile routes.
  - `GET /api/db/csv-replace/status?jobId=`: the Shapefile `handleStatus` (same job store, so there is one job per target table across both modes).
- Server pipeline: the generic replace runner `runShpReplace` takes a `ReplaceRecordSource` (`replaceRecordSource.ts`: `fieldNames`, `recordCount`, `records()`, optional `hasGeometry`, `geometryFormat`, `wording`). `OpenShapefile` and `openCsvFile` (`csvRecordSource.ts`) both implement it. The phases, `DELETE` (never `TRUNCATE`) in one transaction, `COPY` into a temp stage, `LOCK ... SHARE ROW EXCLUSIVE`, sequence reset, `ANALYZE` after `COMMIT`, `outcomeUnknown` and the scrubbed errors are the Shapefile ones.
- CSV parsing (`csvRecordReader.ts`, `utf8FileChunks.ts`): the file is read in 64 KiB chunks and decoded as UTF-8 when the whole file is valid UTF-8 (streaming pre-scan), otherwise as Windows-1252 (BOM stripped; `readTextChunks`, no full-file buffer). Delimiter by `detectCsvDelimiter` (`,`, `;`, tab; shared with the browser `CsvParser` through `parsers/csvDialect.ts`). Quoted fields with embedded delimiters, doubled quotes and line breaks are supported; blank lines are skipped. `openCsvFile` scans the whole file once, before any database work: header uniqueness, a field count equal to the header on every row (the error names the line) and at least one data row. `sourceRows` counts data rows; row numbers in errors (`rec`) are 1-based data rows.
- Mapping: each target column maps to a CSV header (text cast to the target type in the database: `NULLIF(cell,'')::type` for non-text types, as-is for text), to the geometry (`__geometry__`, only when the CSV has one) or to a fixed default. At most one target column maps to the geometry (the message names the columns).
- Geometry source: a column named `geom`, `geometry`, `wkt`, `wkb_geometry`, `the_geom`, `geom_wkt` or `geom_wkb` (EWKB hex, optionally prefixed `\x` or `0x`, or WKT/EWKT), else a latitude/longitude pair (`resolveSpatialColumnHeaders`; comma decimals accepted) turned into `POINT(lng lat)`. The cell goes to the stage as text and `buildTextGeometryParse` decodes it in the database (`ST_GeomFromEWKB(decode(...,'hex'))` for hex, `ST_GeomFromEWKT` otherwise). EWKB/EWKT keep their own SRID; SRID 0 and WKT/lat-lng use `sourceSrid` (default 4326, must exist in `spatial_ref_sys`). Then `ST_Transform` to the target SRID (skipped when the target SRID is 0) and `ST_Multi` for Multi targets. Only 2D targets. Before the swap, `geometryTextCheck.ts` runs a `pg_temp` plpgsql check over the stage and fails the run with the failing row number if a geometry cannot be parsed (no `DELETE` has run yet).
- Not offered for CSV: geometry processing (repair, unify, overlaps) and the analysis dry run.
