# System Architecture & Technical Specifications: GIS Tools

This document provides a comprehensive overview of the system architecture, design decisions, multithreading strategies (Web Workers), solved engineering challenges, and future development roadmaps for **GIS Tools**.

---

## 📋 1. Executive Summary

**GIS Tools** is a high-speed, modular web platform designed for auditing, correlating, analyzing discrepancies, and synchronizing spatial and alphanumeric records between **PostgreSQL/PostGIS databases** and external data sources (Shapefiles `.zip`, GeoJSON `.geojson`, CSV files, and database replicas).

### Architectural Principles
1. **100% In-Memory Processing**: File uploads (`.zip`, `.shp`, `.csv`) are inspected directly in browser RAM without server disk persistence or temporary database staging tables.
2. **Multithreaded Execution (Web Workers)**: CPU-intensive correlation operations ($O(1)$ hash indexing, attribute comparisons across hundreds of thousands of records) execute in background Web Worker threads to keep the main UI thread responsive at 60fps.
3. **Decoupled Component Architecture**: Strict separation between UI components, custom state hooks, domain models, and worker services.
4. **Strategy Pattern**: Extensible `ISpatialFileParser` and `IComparisonEngine` interfaces allow adding new file parsers or comparison engines without modifying existing business logic.
5. **Zero Data Loss Audit**: Explicit auditing and reporting for records with Null/Empty SUIDs and Duplicate SUIDs.
6. **Composite SUID Keys**: Supports composite primary keys formed by multiple database columns (e.g., `department` + `parcel_id`).
7. **`NOT NULL` Handling & Introspection**: PostgreSQL column metadata introspection (`information_schema.columns`) combined with custom default values for unmapped required database columns during `INSERT` script generation.
8. **Decoupled Sub-Hook Map Architecture**: Leaflet map functionality is composed of 5 single-responsibility sub-hooks (`useMapInstance`, `useBasemapTileLayer`, `useVectorChunkStream`, `useFeatureHighlight`, `useLayerSymbology`).

---

## 🏛️ 2. Key Architectural Patterns

### A. Strategy Pattern
The platform uses strategy abstractions to decouple file loading, comparison algorithms, and UI presentation:

1. **`ISpatialFileParser` Interface** ([`src/types/parsers.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/parsers.ts)):
   - Unifies parsing across different formats into a standardized `ParsedFileDataset`.
   - **`ShapefileParser`**: Parses `.zip` (SHP+DBF) and `.geojson` files.
   - **`CsvParser`**: Parses delimited `.csv` tabular files with automatic EWKB Hex, WKT, and Lat/Lng coordinate parsing.

2. **`IComparisonEngine` Interface** ([`src/types/comparison.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/comparison.ts)):
   - Defines dataset comparison contracts.
   - **`DbVsFileComparisonEngine`**: Orchestrates database vs file comparison via background Web Workers.
   - **`DbVsDbComparisonEngine`**: Compares two live PostgreSQL database instances (primary vs replica).

---

### B. Async Multithreading with Web Workers

```
  [Main UI Thread (React 19)]
            │
            ├─ 1. fetch("/api/db/records")   ──▶ PostgreSQL Database (Network I/O)
            │
            ├─ 2. serializeFileDataset()     ──▶ Converts Map<> to plain serializable object
            │
            └─ 3. postMessage() ────────────▶ [Background Thread: Web Worker]
                                                  ├─ Phase 1: Composite DB Indexing (SuidMap + Nulls)
                                                  ├─ Phase 2: Composite File Indexing (SuidMap + Nulls)
                                                  ├─ Phase 3: Pre-compute O(1) Column Mapping
                                                  ├─ Phase 4: Attribute Mismatch Comparison (UPDATE)
                                                  ├─ Phase 5: Missing Record Inserter (INSERT) + Defaults
                                                  └─ postMessage({ type: 'DONE', payload })
                                                                │
                                                                ▼
                                                      [Promise Resolution / UI Render]
```

- **`src/types/workerMessages.ts`**: Strongly typed message protocol (`WorkerInputMessage`, `WorkerProgressMessage`, `WorkerDoneMessage`, `WorkerErrorMessage`).
- **`src/workers/comparisonWorker.ts`**: Dedicated Web Worker performing $O(N)$ dataset comparison off the main thread.
- **`src/workers/comparisonWorkerSync.ts`**: Synchronous fallback engine for environments where Web Workers are unavailable.
- **`src/services/workerBridge.ts`**: Promise-based adapter providing automatic fallback and dataset serialization.

---

### C. Decoupled Map Sub-Hook Architecture

The Leaflet map engine inside [`useLeafletMap.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/useLeafletMap.ts) is decomposed into 5 modular sub-hooks located in `src/hooks/map/`:

1. [`useMapInstance.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/map/useMapInstance.ts): Map mounting, `L.canvas` HTML5 renderer initialization, and `isMapReady` state signal.
2. [`useBasemapTileLayer.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/map/useBasemapTileLayer.ts): Tile layer switching between OpenStreetMap, Satellite, and Dark basemaps.
3. [`useVectorChunkStream.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/map/useVectorChunkStream.ts): Web Worker chunk streaming and micro-batch state management for progressive feature rendering.
4. [`useFeatureHighlight.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/map/useFeatureHighlight.ts): Dynamic glowing target feature highlight and smooth camera panning.
5. [`useLayerSymbology.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/map/useLayerSymbology.ts): 60fps dynamic symbology updates (stroke color, fill color, line weight, stroke opacity, fill opacity, point radius, and stroke pattern).

---

### D. Composite Shared Unique Identifiers (SUID)

- Supports selecting single or multiple database columns to form composite SUID keys (e.g., `dept` + `parcel_id`) in [`SuidSelectorCard.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-sync-common/SuidSelectorCard.tsx).
- The Web Worker builds composite hash keys by combining normalized string values (`val1_val2`) for $O(1)$ lookup performance.
- Generates multi-column `WHERE` clauses in SQL: `WHERE "dept" = '01' AND "parcel_id" = '45012'`.

---

### E. Dual SQL Script Generation (UPDATE & INSERT)

The comparison engine generates two distinct PostGIS SQL patch scripts:

1. **Update Script (`sqlUpdateScript`)**:
   - For records present in both sources but containing disparate attribute values.
   - Syntax: `UPDATE "schema"."table" SET "col" = 'val' WHERE "suid_col1" = 'v1' AND "suid_col2" = 'v2';`
2. **Insertion Script (`sqlInsertScript`)**:
   - For records present in the file source that are missing from the database.
   - Syntax: `INSERT INTO "schema"."table" ("suid_col1", "suid_col2", "col1", "col_def") VALUES ('v1', 'v2', 'val1', 'default_val');`
   - **Default Values & `NOT NULL` Restrictions**: Via [`InsertDefaultsCard.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-sync-common/InsertDefaultsCard.tsx), users can assign static values (e.g., `'ACTIVE'`) or SQL expressions (e.g., `NOW()`) to unmapped required database columns.

---

## 📂 3. Directory & File Map

### Domain Models & Types (`src/types/`)
- [`db.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/db.ts): Database connection models (`DbConfig`, `DbColumnMetadata`, `SavedDbProfile`, `ExecuteBatchResult`).
- [`parsers.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/parsers.ts): `ParsedFileDataset` and `ISpatialFileParser` interfaces.
- [`comparison.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/comparison.ts): Discrepancy models (`ComparisonSummary`, `DiscrepancyItem`, `DiscrepancyType`, `DiscrepancyFilter`) and mapping configurations (`ColumnMappingConfig`, `InsertFieldDefault`).
- [`workerMessages.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/workerMessages.ts): Web Worker message definitions.
- [`ui.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/ui.ts): UI badges, alerts, button variants, and tool catalog definitions (`ToolCategory`, `ToolCardData`, `WizardStepDef`).
- [`shp.ts`](file:///c:/Alekos/Projects/gis-tools/src/types/shp.ts): Shapefile dataset interfaces.

### Engines & Parsers (`src/services/`)
- [`DbVsFileComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsFileComparisonEngine.ts): PostGIS vs File comparison engine.
- [`DbVsDbComparisonEngine.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/engines/DbVsDbComparisonEngine.ts): PostGIS DB vs DB replica engine.
- [`workerBridge.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/workerBridge.ts): Worker communication bridge with automatic fallback.
- [`ShapefileParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/ShapefileParser.ts): Zip archive (SHP+DBF) and GeoJSON parser.
- [`CsvParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/CsvParser.ts): Delimited CSV parser with EWKB/WKT/LatLng support.
- [`localStorageDbConfig.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/localStorageDbConfig.ts): Local storage credentials manager (excluding passwords).

### Web Workers (`src/workers/`)
- [`comparisonWorker.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparisonWorker.ts): Background comparison worker with composite key support.
- [`mapChunkWorker.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/mapChunkWorker.ts): GeoJSON feature chunking worker for progressive map streaming.

### Utilities (`src/utils/`)
- [`gisCleaners.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/gisCleaners.ts): Value cleaners (`cleanValue`) and SUID sanitization (`cleanSuid`).
- [`ewkbParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/ewkbParser.ts): EWKB Hex parser and UTM Zone 19S coordinate converter.
- [`wktParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/wktParser.ts): WKT geometry parser (Point, LineString, Polygon, MultiPolygon).
