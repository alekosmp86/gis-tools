# Progress Log & Architectural Decisions — GIS Tools

This document documents major milestone updates, architectural decisions, and progress logs for the **GIS Tools** platform.

---

## 📈 Platform Progress Summary

| Feature / Milestone | Status | Description |
| :--- | :---: | :--- |
| **High-Capacity 1M+ Shapefile Engine** | ✅ Active | Zero-allocation binary dBase III/IV and ESRI Shapefile reader processing 1M+ records in RAM with string interning. |
| **50k Map Preview Sampling** | ✅ Active | Smooth, non-blocking 50,000 feature sample preview on initial load with high-contrast alert notices. |
| **Modular Comparison Engine Sub-Modules** | ✅ Active | Decomposed `comparisonCore.ts` into atomic sub-modules (`suidKeyUtils`, `sqlBuilder`, `nullRecordHandler`, `fileDatasetIndexer`). |
| **PostGIS Geometry Auto-INSERT** | ✅ Active | Automatic spatial column introspection and `ST_SetSRID` / `ST_Transform` SQL expression generation for missing records. |
| **Shared `FileDropzone` Component** | ✅ Active | Unified drag-and-drop file upload zone reused across Shapefile and CSV sync tools. |
| **DB vs. Shapefile Sync Tool** | ✅ Active | Full PostgreSQL/PostGIS correlation against Shapefile `.zip` and GeoJSON files. |
| **DB vs. CSV Sync Tool** | ✅ Active | PostGIS correlation against CSV files with EWKB Hex, WKT, and Lat/Lng parsing. |
| **DB vs. DB Sync Tool (Replicas)** | ✅ Active | Direct PostGIS DB 1 vs PostGIS DB 2 replica table correlation. |
| **Spatial File Viewer Tool** | ✅ Active | In-memory spatial file inspection with interactive Leaflet map preview. |
| **PostGIS Table Viewer Tool** | ✅ Active | Direct PostGIS table viewer with real-time vector streaming. |
| **Dynamic Symbology Popover** | ✅ Active | Live 60fps layer styling (colors, stroke weight, opacity, point radius, stroke patterns). |
| **Sub-Hook Map Architecture** | ✅ Active | Decoupled Leaflet integration into 5 single-responsibility hooks. |
| **Direct PostGIS SQL Execution** | ✅ Active | Transactional SQL batch execution modal (`BEGIN; ... COMMIT;`). |
| **Codebase Rules & Compliance** | ✅ Active | 100/100 React Doctor score, co-located props, zero inline styles, Lucide icons only. |

---

## 🏛️ Recent Architectural Decisions

### 1. Zero-Allocation Binary Shapefile Readers for 1M+ Datasets
- **Decision**: Implemented [`BinaryDbfReader.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/binaryDbfReader.ts) and [`BinaryShpReader.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/binaryShpReader.ts) directly on `Uint8Array` views with string interning via [`StringInternPool.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/stringInternPool.ts) and parallel zip extraction using `but-unzip`.
- **Benefits**: Completely eliminated V8 heap exhaustion (>2.5 GB heap down to <150 MB) when loading cadastral layers with over 1,050,000 polygons.

### 2. 50,000-Feature Representative Preview Sampling
- **Decision**: For datasets with $>50{,}000$ features, [`ShapefileParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/ShapefileParser.ts) generates a 50,000-feature sample for the initial map step while retaining the full binary buffers (`dbfBuffer`, `shpBuffer`) for 1M comparison.
- **Benefits**: Guarantees a rich, dense spatial preview on standard Leaflet Canvas without freezing the main thread or dropping browser frames.

### 3. Comparison Core Modular Decomposition
- **Decision**: Decomposed the monolithic 1,000+ line `comparisonCore.ts` into 4 dedicated modules under `src/workers/comparison/`:
  - `suidKeyUtils.ts`: SUID string cleaning and composite key generation.
  - `sqlBuilder.ts`: PostGIS `ST_SetSRID`/`ST_Transform` SQL expressions and statement formatting.
  - `nullRecordHandler.ts`: NULL SUID diagnostic extraction.
  - `fileDatasetIndexer.ts`: Binary DBF and GeoJSON indexing routines.
- **Benefits**: Greatly improved code readability, maintainability, and single-responsibility isolation.

### 4. PostGIS Geometry Inclusion in `INSERT` Statements
- **Decision**: Implemented automatic geometry column introspection in [`sqlBuilder.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/sqlBuilder.ts) to detect table geometry columns and generate PostGIS `ST_SetSRID(ST_GeomFromGeoJSON(...), srid)` expressions when generating `INSERT INTO` queries for missing features.
- **Benefits**: Ensures that all records found only in the Shapefile are inserted into PostGIS with full spatial geometries intact.

### 5. Universal Shared `FileDropzone` Component
- **Decision**: Extracted file drag-and-drop presentation and keyboard handling into [`FileDropzone.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/FileDropzone.tsx) in `src/components/shared/`, reusing it across `ShapefileUploader.tsx` and `CsvUploader.tsx`.
- **Benefits**: Reduced duplicated CSS/JSX by over 150 lines and established consistent UX across all file upload workflows.
