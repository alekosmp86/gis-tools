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
