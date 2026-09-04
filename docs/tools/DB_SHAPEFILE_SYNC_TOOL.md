# DB vs. Shapefile Sync Tool

> **Location**: `src/app/tools/db-shapefile-sync/`  
> **Route**: `/tools/db-shapefile-sync`  
> **Status**: Implemented & Production Active

---

## 1. Overview

The **DB vs. Shapefile Sync Tool** correlates PostGIS spatial tables against ESRI Shapefiles (`.zip` containing `.shp`, `.dbf`, `.shx`, `.prj`, `.cpg`) and GeoJSON datasets.

Engineered with zero-allocation binary readers and string interning, it supports enterprise-scale cadastral layers containing over **1,000,000+ polygons** in the browser without memory exhaustion or UI thread freezes.

---

## 2. 4-Step Wizard Workflow

1. **Step 1: Database Connection & Table Introspection**
   - Connect to PostgreSQL/PostGIS (`DbConnectionForm`).
   - Introspects table columns, data types, primary keys, and spatial geometries.
2. **Step 2: Shapefile / GeoJSON Upload & Spatial Preview**
   - Upload compressed ESRI Shapefile archive (`.zip`) or raw GeoJSON (`.geojson`, `.json`).
   - Fast concurrent in-memory unzipping via `ZipShapefileExtractor`.
   - Low-level zero-allocation DBF/SHP inspection (`BinaryDbfReader`, `BinaryShpReader`) with string interning.
   - Dynamic projection conversion from metric/projected coordinates (e.g. UTM, Gauss-Krüger) to WGS84 (`EPSG:4326`) via `ProjectionEngine`.
   - **Sample Map Preview**: Previews up to `MAX_MAP_PREVIEW_FEATURES` (25,000 features) in Step 2 with an informative warning banner for large datasets, while retaining the full binary buffers in memory for 1M+ comparison.
3. **Step 3: Composite SUID Mapping & Attribute Selection**
   - Select single or multi-column composite SUID keys (`SuidMappingStep`).
   - Map DBF attributes to database columns and configure default values for required `NOT NULL` fields.
4. **Step 4: Comparison Audit, Full Discrepancy Map & SQL Patches**
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
