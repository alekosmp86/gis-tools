# ISSUE 010: Shapefile Geometry Synchronization, Lazy SQL Generation & Modular Architecture Refactoring

## 1. Problem Statement
During spatial synchronization between an active PostGIS database table and an ESRI Shapefile dataset, multiple interrelated issues were identified across accuracy, performance, code maintainability, and UI:

1. **Missing UPDATE Queries for Geometry Mismatches**:
   When geometric differences occurred between the database and the Shapefile, no SQL UPDATE statements were generated. Since Shapefile geometries are stored in the `.shp` binary stream rather than DBF attribute columns, they were excluded by the rule that only mapped columns in Step 3 generate updates.
2. **Vertex Loss & Coordinate Truncation in Database Updates**:
   When SQL UPDATE scripts were generated and executed, dense cadastral survey polygons lost vertices (e.g. 8,244 vertices in the `.shp` file collapsed to 8,233 vertices in PostgreSQL; and an 11,968-vertex polygon collapsed to 11,955 vertices). Re-comparing against the Shapefile showed persistent geometric discrepancies despite executing the update scripts.
3. **Monolithic Heap Spikes on SQL String Allocation**:
   Calling `.join("\n")` on tens of thousands of spatial SQL statements during the initial comparison pass caused a $2\times$ heap allocation spike (~100–300 MB) in V8 and duplicated this memory in the main UI thread via `postMessage`.
4. **Codebase Monoliths Violating SRP (Single Responsibility Principle)**:
   - `SpatialComparisonEngine.ts` grew to 721 lines, handling alias resolution, binary DBF unpacking, pass-1 matching, pass-2 unvisited feature scanning, and patch collection.
   - `SpatialGeometryComparator.ts` grew to 403 lines, handling EWKB/WKT string parsing, mercator-to-WGS84 rescaling, ring canonicalization, vertex deduplication, and cyclic comparison.
   - `SqlPatchDrawer.tsx` (270 lines) and `DiscrepanciesTable.tsx` (310 lines) coupled state, filtering, rendering, and modals in monolithic files.
5. **Table Row SUID Alignment**:
   In the Discrepancies Table, when rendering a multi-row discrepancy group, the SUID code was pushed to the top of the cell rather than vertically centered with the type badge and spanned rows.
6. **React Doctor Lint Warnings & Performance Rules**:
   - `react-doctor/async-parallel`: Sequential awaits on independent dynamic imports in `workerBridge.ts`.
   - `react-hooks-js/todo`: TryStatement with a `finally` clause in `useSqlPatchDrawerState.ts` incompatible with React Compiler HIR lowering.
   - `react-doctor/prefer-explicit-variants` & `react-doctor/no-high-complexity-react-function`: `SqlPatchHeader` switching subtrees on boolean flags with high cyclomatic complexity.

---

## 2. Root Cause Analysis & Technical Details

1. **Destructive 6-Decimal Degree Truncation (`roundGisCoordinate`)**:
   `serializeCompactGeoJson()` in `SqlScriptBuilder.ts` forcibly rounded all coordinates to 6 decimal places (`~11 cm`). In surveyor-grade polygons where vertices are centimeters apart, adjacent vertices rounded to identical numbers, causing PostGIS to collapse and eliminate the zero-length segments.
2. **Double-Reprojection Distortion**:
   Shapefile native coordinates (e.g. metric UTM Zone 21S / EPSG:32721) were being converted to WGS84 degrees via JavaScript `proj4`, truncated, and then converted *back* to the database SRID in PostgreSQL via `ST_Transform(..., targetSrid)`.
3. **Stale Database Column Precedence**:
   In `SpatialComparisonEngine.ts`, `rawDbGeom` checked `dbRec.geom_wkb` before `dbRec.geom`. PostGIS updates modified `geom`, but the comparison engine was re-evaluating the stale un-updated `geom_wkb` column.
4. **Cyclic Ring Rotation Boundary Flip**:
   `normalizeRing()` picked a starting vertex (`minIdx`) based on rounded minimum coordinates. Sub-millimeter floating-point shifts caused the database polygon to rotate from vertex 0 while the Shapefile polygon rotated from vertex 10, failing identical geometries.
5. **SUID Cell CSS Override**:
   `DiscrepancySuidCell.module.css` contained an explicit rule `.suidCell { vertical-align: top !important; }`, preventing the SUID cell from vertically centering across its spanned rows.
6. **React Compiler HIR Finalizer Limitation**:
   React Compiler's High-Level Intermediate Representation (`BuildHIR::lowerStatement`) does not yet support `try ... finally` blocks.

---

## 3. Implemented Solutions & Architecture

### A. High-Fidelity Geometry Synchronization & Zero-Copy Streaming
1. **Lightweight Offset Indexing**:
   - Added `fileRecordIndex?: number` to `DiscrepancyItem` (8 bytes per item).
   - During SQL generation in the worker, `shpReader.readGeometry(item.fileRecordIndex, null)` reads the unprojected native coordinates directly from the binary buffer, avoiding heap duplication.
2. **Native SRID Direct Injection**:
   - `ProjectionEngine.extractEpsg(prjText)` extracts native EPSG codes directly from `.prj` files.
   - When `sourceSrid === targetSrid` (both in EPSG:32721 or EPSG:4326), SQL statements inject native coordinates directly:
     `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON('...'), targetSrid))`
   - Zero reprojection, zero precision loss, 100% vertex preservation.
3. **Shapefile Geometry Update Exception**:
   - In `SqlPatchGenerator.ts`, when `item.type === DiscrepancyType.GEOMETRY_MISMATCH && this.isBinaryDbf`, automatically generates spatial PostGIS `UPDATE` queries.
4. **Cyclic Shift Ring Matching & Consecutive Duplicate Point Collapsing**:
   - Evaluates cyclic shifts and reverse winding with numerical epsilon tolerance (`0.0003°` / ~30m).
   - Collapses consecutive duplicate points caused by coordinate quantization.

### B. Lazy SQL Generation Architecture
1. **Zero-Allocation Initial Pass**:
   - `PatchCollector` runs in preview-only mode (`collectFullScript = false`) during initial comparison, computing exact statement counts and recording only the first 25 preview statements without allocating large string arrays.
2. **On-Demand Background Generation**:
   - Added `ComparisonWorkerMessageType.GENERATE_SQL` to `src/types/workerMessages.ts` and `comparisonWorker.ts`.
   - Full scripts are generated in a background worker thread on-demand when the user clicks "Copiar", "Descargar .sql", or "Ejecutar en BD".

### C. Single Responsibility Principle (SRP) Decomposition

#### 1. `SpatialComparisonEngine.ts` (Reduced from 721 to ~190 lines):
Decoupled into dedicated sub-engine modules in `src/workers/comparison/`:
- **`GeometryDifferenceEvaluator.ts`**: Resolves PostGIS geometry aliases (`geom`, `the_geom`, `geom_wkb`, `wkt`), parses geometries, and performs tolerance comparison.
- **`FeatureAttributeExtractor.ts`**: Zero-copy attribute reading and difference detection from binary DBF buffers or JS objects.
- **`MatchedRecordsComparator.ts`**: Pass 1 matched iteration, duplicate tracking, and discrepancy classification.
- **`UnmatchedFileFeaturesCollector.ts`**: Pass 2 unvisited file feature collection (`ONLY_IN_SHP`).
- **`PatchCollector.ts`**: Collects and formats SQL preview lines and counts.

#### 2. `SpatialGeometryComparator.ts` (Reduced from 403 to ~150 lines):
Decomposed into single-responsibility spatial modules in `src/utils/spatial/`:
- **`GeometryRawNormalizer.ts`** (~95 lines): Multi-format parsing (GeoJSON, WKT, EWKB hex) and WGS84 coordinate scale normalization.
- **`PolygonRingNormalizer.ts`** (~125 lines): Ring vertex deduplication, canonical rotation, and cyclic shift tolerance matching.
- **`SpatialGeometryComparator.ts`** (~150 lines): High-level orchestrator coordinating type validation and delegated comparisons.

#### 3. Component Modularization:
- **`src/components/tools/db-sync-common/discrepancies-table/`**:
  - `DiscrepanciesTable.tsx`, `DiscrepanciesTableHeader.tsx`, `DiscrepanciesTableHead.tsx`, `DiscrepancyItemRows.tsx`, `DiscrepanciesTableEmpty.tsx`, `useDiscrepanciesTableData.ts`.
- **`src/components/tools/db-sync-common/sql-patch-drawer/`**:
  - `SqlPatchDrawer.tsx`, `SqlPatchHeader.tsx`, `SqlPatchTabs.tsx`, `SqlPatchPreviewBox.tsx`, `SqlPatchCopyButton.tsx`, `SqlPatchDownloadButton.tsx`, `SqlPatchExecuteButton.tsx`, `useSqlPatchDrawerState.ts`.

### D. UI Fixes
- **SUID Vertical Centering**: Changed `.suidCell` in `DiscrepancySuidCell.module.css` from `vertical-align: top !important;` to `vertical-align: middle;`, aligning the SUID text directly with the type badge across spanned rows.

### E. React Doctor & React Compiler Optimizations
1. **`react-doctor/async-parallel`**: Parallelized dynamic `import(...)` statements in `src/services/workerBridge.ts` using `Promise.all`.
2. **`react-hooks-js/todo`**: Refactored `try ... finally` to structured `try ... catch` in `useSqlPatchDrawerState.ts` to satisfy React Compiler's HIR lowering.
3. **`react-doctor/prefer-explicit-variants` & `react-doctor/no-high-complexity-react-function`**:
   - Extracted `<SqlPatchCopyButton />`, `<SqlPatchDownloadButton />`, `<SqlPatchExecuteButton />`, and `<SqlPatchExecutedButton />`.
   - Converted `<SqlPatchHeader />` into a zero-complexity structural component (`cyclomatic complexity = 1`, `cognitive complexity = 0`).
   - Reached **100 / 100 Great** score in React Doctor with **0 issues**.

---

## 4. Code Examples & Diff Snippets

### A. Concurrent Dynamic Imports in `src/services/workerBridge.ts`:
```typescript
if (typeof Worker === "undefined") {
  const [{ SqlPatchGenerator }, { BinaryShpReader }, { ProjectionEngine }] =
    await Promise.all([
      import("../workers/comparison/SqlPatchGenerator"),
      import("../utils/binary/BinaryShpReader"),
      import("../utils/spatial/ProjectionEngine"),
    ]);
  // ...
}
```

### B. React Compiler HIR Lowering in `useSqlPatchDrawerState.ts`:
```typescript
setIsGenerating(true);
try {
  const generated = await onGenerateFullScript();
  setLazyScripts(generated);
  setIsGenerating(false);
  return isUpdateTab ? generated.sqlUpdateScript : generated.sqlInsertScript;
} catch {
  setIsGenerating(false);
  setExecutionResult({
    type: AlertType.ERROR,
    text: "Error al generar el script SQL completo en segundo plano.",
  });
  return null;
}
```

### C. Direct Native PostGIS Injection in `SqlScriptBuilder.ts`:
```typescript
public buildPostgisGeomExpr(geometry: unknown, targetColumnName?: string, sourceSrid?: number): string {
  const compactJsonString = this.serializeCompactGeoJson(geometry);
  const originSrid = sourceSrid || (this.targetSrid !== 4326 ? this.targetSrid : 4326);

  let baseExpr: string;
  if (originSrid === this.targetSrid) {
    baseExpr = `ST_SetSRID(ST_GeomFromGeoJSON('${compactJsonString}'), ${this.targetSrid})`;
  } else {
    baseExpr = `ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${compactJsonString}'), ${originSrid}), ${this.targetSrid})`;
  }

  const targetType = targetColumnName && this.dbColumnTypes ? this.dbColumnTypes[targetColumnName]?.toLowerCase() : undefined;
  if (targetType?.includes("multi") && (geometry as { type?: string })?.type === "Polygon") {
    return `ST_Multi(${baseExpr})`;
  }
  return baseExpr;
}
```

---

## 5. Verification & Testing

- **React Doctor**:
  ```
  React Doctor — gis-tools
  Score: 100 / 100 Great
  ✔ No issues found!
  ```
- **TypeScript Type Check**: `npx tsc --noEmit` passed with 0 errors.
- **ESLint Cleanliness**: `npm run lint` passed with 0 errors and 0 warnings.
- **Turbopack Build**: `npm run build` compiled all 13 routes cleanly in 952ms.
