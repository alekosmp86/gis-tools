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
