# System Architecture & Technical Specifications: GIS Tools

This document provides a comprehensive overview of the system architecture, design decisions, multithreading strategies (Web Workers), solved engineering challenges, and future development roadmaps for **GIS Tools**.

---

## 📋 1. Executive Summary

**GIS Tools** is a high-speed, modular web platform designed for auditing, correlating, analyzing discrepancies, and synchronizing spatial and alphanumeric records between **PostgreSQL/PostGIS databases** and external data sources (Shapefiles `.zip`, GeoJSON `.geojson`, CSV files, and database replicas).

### Architectural Principles
1. **100% In-Memory Processing**: File uploads (`.zip`, `.shp`, `.csv`) are inspected directly in browser RAM without server disk persistence or temporary database staging tables.
2. **Multithreaded Execution (Web Workers)**: CPU-intensive correlation operations ($O(1)$ hash indexing, attribute comparisons across millions of records) execute in background Web Worker threads to keep the main UI thread responsive at 60fps.
3. **Zero-Allocation Binary Shapefile Engine**: Low-level binary dBase III/IV and ESRI Shapefile parsers with string interning, zero ArrayBuffer copies, and row-index hashing capable of handling **1,000,000+ records**.
4. **Decoupled Component Architecture**: Strict separation between UI components, custom state hooks, domain models, worker sub-modules, and parsers.
5. **Strategy Pattern**: Extensible `ISpatialFileParser` and `IComparisonEngine` interfaces allow adding new file parsers or comparison engines without modifying existing business logic.
6. **Zero Data Loss Audit**: Explicit auditing and reporting for records with Null/Empty SUIDs and Duplicate SUIDs.
7. **Composite SUID Keys**: Supports composite primary keys formed by multiple database columns (e.g., `coddepto` + `codloccat` + `padron` + `numcarcat`).
8. **Automatic PostGIS Geometry Synchronization**: Discovers geometry columns in PostgreSQL and automatically generates `ST_SetSRID` / `ST_Transform` expressions in both `UPDATE` and `INSERT` SQL scripts.
9. **Decoupled Sub-Hook Map Architecture**: Leaflet map functionality is composed of 5 single-responsibility sub-hooks (`useMapInstance`, `useBasemapTileLayer`, `useVectorChunkStream`, `useFeatureHighlight`, `useLayerSymbology`).

---

## 🏛️ 2. Key Architectural Patterns

### A. Strategy Pattern
The platform uses strategy abstractions to decouple file loading, comparison algorithms, and UI presentation:

1. **`ISpatialFileParser` Interface** ([`src/types/parsers.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/parsers.ts)):
   - Unifies parsing across different formats into a standardized `ParsedFileDataset`.
   - **`ShapefileParser`**: High-capacity parser with binary dBase/Shapefile readers, zip package extraction (`but-unzip`), and 50k initial map preview sampling.
   - **`CsvParser`**: Parses delimited `.csv` tabular files with automatic EWKB Hex, WKT, and Lat/Lng coordinate parsing.

2. **`IComparisonEngine` Interface** ([`src/types/comparison.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/comparison.ts)):
   - Defines dataset comparison contracts.
   - **`DbVsFileComparisonEngine`**: Orchestrates database vs file comparison via background Web Workers.
   - **`DbVsDbComparisonEngine`**: Compares two live PostgreSQL database instances (primary vs replica).

---

### B. Async Multithreading with Web Workers & Binary Streaming

```
  [Main UI Thread (React 19)]
            │
            ├─ 1. fetch("/api/db/records")   ──▶ PostgreSQL Database (Network I/O)
            │
            ├─ 2. serializeFileDataset()     ──▶ Transfers binary Uint8Array buffers (Zero Object Clone)
            │
            └─ 3. postMessage() ────────────▶ [Background Thread: Web Worker]
                                                  ├─ Phase 1: DB Composite SUID Indexing
                                                  ├─ Phase 2: Binary DBF Pointer Indexing (suid -> number[])
                                                  ├─ Phase 3: NULL SUID Diagnostics Extraction
                                                  ├─ Phase 4: Attribute & Geometry Comparison (UPDATE)
                                                  │           └─ Atomic exact-match counter (exactMatchesCount++)
                                                  ├─ Phase 5: Missing Record Inserter (INSERT) + ST_Geom + Defaults
                                                  └─ postMessage({ type: 'DONE', payload })
                                                                │
                                                                ▼
                                                      [Promise Resolution / UI Render]
```

- **`src/types/workerMessages.ts`**: Strongly typed message protocol carrying transferable binary buffers (`dbfBuffer`, `shpBuffer`).
- **`src/workers/comparison/` Domain Services**:
  - [`SpatialComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/SpatialComparisonEngine.ts): Main comparison domain orchestrator implementing atomic exact-match counting and discrepancy-only memory retention.
  - [`SuidKeyResolver.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/SuidKeyResolver.ts): String interning, cleaning, and composite SUID key resolution with partial non-null support.
  - [`SqlScriptBuilder.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/SqlScriptBuilder.ts): PostGIS geometry expression generator, compact 6-decimal GeoJSON serializer, and SQL patch builder.
  - [`NullRecordHandler.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/NullRecordHandler.ts): Diagnostic summaries for null and duplicate SUID records.
  - [`FileDatasetIndexer.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/FileDatasetIndexer.ts): Zero-copy binary DBF and object dataset indexers.
- **[`workerBridge.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/workerBridge.ts)**: Promise-based adapter providing automatic fallback and dataset serialization.

---

### C. Zero-Allocation Binary File Readers (1M+ Scale)

See [`BINARY_SHAPEFILE_1M_OPTIMIZATION.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/BINARY_SHAPEFILE_1M_OPTIMIZATION.md) for full deep-dive.

1. **[`StringInternPool.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/stringInternPool.ts)**: Canonical string pool deduplicating repetitive categorical strings across millions of records.
2. **[`BinaryDbfReader.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/binaryDbfReader.ts)**: Low-level dBase III/IV parser operating directly on `Uint8Array.subarray` views without copying memory.
3. **[`BinaryShpReader.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/binaryShpReader.ts)**: Scans record byte offsets and lazily decodes geometries only when required for comparison or viewport rendering.
4. **[`zipArchiveExtractor.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/zipArchiveExtractor.ts)**: Concurrent in-memory zip archive extractor using `but-unzip`.

---

### D. Decoupled Map Sub-Hook Architecture

The Leaflet map engine inside [`useLeafletMap.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/useLeafletMap.ts) is decomposed into 5 modular sub-hooks located in `src/hooks/map/`:

1. [`useMapInstance.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/map/useMapInstance.ts): Map mounting, `L.canvas` HTML5 renderer initialization, and `isMapReady` state signal.
2. [`useBasemapTileLayer.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/map/useBasemapTileLayer.ts): Tile layer switching between OpenStreetMap, Satellite, and Dark basemaps.
3. [`useVectorChunkStream.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/map/useVectorChunkStream.ts): Web Worker chunk streaming and micro-batch state management for progressive feature rendering.
4. [`useFeatureHighlight.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/map/useFeatureHighlight.ts): Dynamic glowing target feature highlight and smooth camera panning.
5. [`useLayerSymbology.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/map/useLayerSymbology.ts): 60fps dynamic symbology updates (stroke color, fill color, line weight, stroke opacity, fill opacity, point radius, and stroke pattern).

---

### E. Dual SQL Script Generation (UPDATE & INSERT)

The comparison engine generates two distinct PostGIS SQL patch scripts:

1. **Update Script (`sqlUpdateScript`)**:
   - For records present in both sources but containing disparate attribute values or geometries.
   - Syntax: `UPDATE "schema"."table" SET "col" = 'val', "geom" = ST_SetSRID(...) WHERE "suid_col1" = 'v1' AND "suid_col2" = 'v2';`
2. **Insertion Script (`sqlInsertScript`)**:
   - For records present in the file source that are missing from the database.
   - Automatically injects decoded PostGIS geometry expressions (`ST_SetSRID` / `ST_Transform`) and user-defined defaults for required `NOT NULL` columns.
   - Syntax: `INSERT INTO "schema"."table" ("suid1", "suid2", "nomdepto", "geom", "ultima_actualizacion") VALUES ('A', 'DA', 'CANELONES', ST_SetSRID(ST_GeomFromGeoJSON('...'), 4326), now());`

---

## 📂 3. Directory & File Map

### Domain Models & Types (`src/types/`)
- [`db.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/db.ts): Database connection models (`DbConfig`, `DbColumnMetadata`, `SavedDbProfile`, `ExecuteBatchResult`).
- [`parsers.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/parsers.ts): `ParsedFileDataset` (carrying binary buffers `dbfBuffer`, `shpBuffer`) and `ISpatialFileParser`.
- [`comparison.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/comparison.ts): Discrepancy models (`ComparisonSummary`, `DiscrepancyItem`, `DiscrepancyType`, `DiscrepancyFilter`) and mapping configurations (`ColumnMappingConfig`, `InsertFieldDefault`).
- [`workerMessages.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/workerMessages.ts): Web Worker message definitions and `SerializableFileDataset`.
- [`ui.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/ui.ts): UI badges, alerts, button variants, and tool catalog definitions (`ToolCategory`, `ToolCardData`, `WizardStepDef`).

### Engines & Parsers (`src/services/`)
- [`DbVsFileComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsFileComparisonEngine.ts): PostGIS vs File comparison engine.
- [`DbVsDbComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsDbComparisonEngine.ts): PostGIS DB vs DB replica engine.
- [`workerBridge.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/workerBridge.ts): Worker communication bridge with automatic fallback and binary buffer serialization.
- [`ShapefileParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/ShapefileParser.ts): High-capacity parser with 50,000-feature preview sampling.
- [`CsvParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/CsvParser.ts): Delimited CSV parser with EWKB/WKT/LatLng support.

### Web Workers & Comparison Engine (`src/workers/`)
- [`comparisonCore.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparisonCore.ts): Clean orchestrator for dataset correlation and discrepancy analysis.
- [`comparison/suidKeyUtils.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/suidKeyUtils.ts): Key construction and string cleaning.
- [`comparison/sqlBuilder.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/sqlBuilder.ts): PostGIS geometry SQL generator and statement builders.
- [`comparison/nullRecordHandler.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/nullRecordHandler.ts): Diagnostic summaries for null SUIDs.
- [`comparison/fileDatasetIndexer.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparison/fileDatasetIndexer.ts): Fast zero-copy binary indexing routines.
- [`comparisonWorker.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparisonWorker.ts): Background comparison Web Worker.
- [`mapChunkWorker.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/mapChunkWorker.ts): GeoJSON feature chunking worker for progressive map streaming.

### Shared UI Components (`src/components/shared/`)
- [`FileDropzone.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/FileDropzone.tsx): Universal drag-and-drop file upload zone with keyboard accessibility and format badges.
- [`SpatialMapPreview.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/SpatialMapPreview.tsx): Full-featured interactive Leaflet Canvas map preview with layer symbology and feature highlights.
- [`ColumnsList.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/ColumnsList.tsx): Modular attribute column tag list.
- [`AlertMessage.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/AlertMessage.tsx): Unified alert banners (`SUCCESS`, `ERROR`, `WARNING`, `INFO`).
- [`WizardOrchestrator.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/shared/WizardOrchestrator.tsx): Master wizard container managing step transitions and automatic scrolling.
