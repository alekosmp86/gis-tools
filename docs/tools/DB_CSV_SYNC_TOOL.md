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
   - In-memory parsing via `CsvParser` with automatic delimiter detection (`,`, `;`, `\t`) and UTF-8 BOM removal.
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
