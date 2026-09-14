# Issue 033: Spatial Explorer 1M+ Features Capping at 150,000

## 1. Problem Statement
When ingesting large datasets (such as `paisurbano_shp.zip` containing 1,051,248 records / 106.76 MB) into the Spatial Explorer (`/tools/spatial-explorer`), the DBF metadata card accurately detected 1,051,248 records, but:
1. The spatial map header pill stated `VISTA ESPACIAL — paisurbano_shp.zip • 150.000 entidades`.
2. The attribute table indicated `Tabla de Atributos (150.000)` and only contained 150,000 rows.
3. PostGIS database table streaming in `useDbQueries.ts` similarly capped query results to 150,000 rows when streaming tables with over 150k features.

This broke the primary architectural goal of the MapLibre GL + deck.gl WebGL refactor, which is designed to render and explore 1,000,000+ features without artificial truncation.

## 2. Root Cause Analysis & Technical Details
Even though the rendering layer (`DeckMapPreview.tsx` and `useDeckMap.ts`) had been completely uncapped with `maxRenderFeatures = null`, the underlying parser and streaming ingestion layers retained legacy safety limits:

1. **`src/core/services/parsers/ShapefileParser.ts`**:
   - Evaluated `const isLargeDataset = featureCount > MAX_MAP_PREVIEW_FEATURES;` (where `MAX_MAP_PREVIEW_FEATURES = 150_000`).
   - Defined `const previewLimit = isLargeDataset ? MAX_MAP_PREVIEW_FEATURES : featureCount;`.
   - The parsing loop for records and geometries was constrained to `for (let recordIndex = 0; recordIndex < previewLimit; recordIndex++)`.
   - Similarly, in `buildDatasetFromGeoJson`, features were sliced via `allFeatures.slice(0, MAX_MAP_PREVIEW_FEATURES)`.
   - Consequently, `recordsMap` and `geojson.features` were truncated to 150,000 items before ever reaching `DeckMapPreview` or `AttributeTable`.

2. **`src/ui-kit/hooks/useDbQueries.ts`**:
   - Computed `previewLimit = params.totalRows && params.totalRows > MAX_MAP_PREVIEW_FEATURES ? MAX_MAP_PREVIEW_FEATURES : undefined`.
   - Passed `previewLimit` into `DatabaseStreamReader.fetchOrStreamRecords`, forcing a `LIMIT 150000` on PostGIS queries.

3. **`src/components/tools/spatial-explorer/hooks/useFileWorkspaceState.ts`**:
   - Wrapped `dataset.recordsMap.values()` in a redundant `new Set(...)`, allocating an unnecessary secondary collection of over 1 million references in heap memory.

## 3. Implemented Solution
1. **Uncapped `ShapefileParser`**:
   - Replaced `MAX_MAP_PREVIEW_FEATURES` with `LARGE_DATASET_THRESHOLD = 100_000` (defined in `parserConstants.ts`), used strictly to set the `isLargeDataset` boolean flag for UI informational badges (`FileMetaPanel.tsx`).
   - Removed `previewLimit` entirely: the extraction loop now iterates over the complete dataset up to `featureCount`.
   - Removed `slice(0, MAX_MAP_PREVIEW_FEATURES)` from GeoJSON parsing, ensuring all features are retained.
2. **Uncapped `useDbQueries`**:
   - Removed `previewLimit` computation and `MAX_MAP_PREVIEW_FEATURES` import. PostGIS queries stream all rows directly without artificial capping.
3. **Cleaned Map Constants**:
   - Removed `MAX_MAP_PREVIEW_FEATURES` from `src/core/constants/mapConstants.ts`.
4. **Optimized Workspace State**:
   - Simplified `recordsList` extraction in `useFileWorkspaceState.ts` to `Array.from(dataset.recordsMap.values())`, eliminating the redundant 1M-element `Set` allocation.
5. **Comprehensive Unit Testing**:
   - Added unit test in `ShapefileParser.test.ts` verifying that datasets with >100,000 features are parsed completely without capping and accurately flag `isLargeDataset: true`.

## 4. Code Examples & Diff Snippets

### ShapefileParser.ts
```diff
- import { MAX_MAP_PREVIEW_FEATURES } from "@/core/constants/mapConstants";
- import { PARSE_PROGRESS_CHUNK_SIZE } from "@/core/constants/parserConstants";
+ import { PARSE_PROGRESS_CHUNK_SIZE, LARGE_DATASET_THRESHOLD } from "@/core/constants/parserConstants";
...
- const isLargeDataset = featureCount > MAX_MAP_PREVIEW_FEATURES;
- const previewLimit = isLargeDataset ? MAX_MAP_PREVIEW_FEATURES : featureCount;
+ const isLargeDataset = featureCount > LARGE_DATASET_THRESHOLD;
...
- for (let recordIndex = 0; recordIndex < previewLimit; recordIndex++) {
+ for (let recordIndex = 0; recordIndex < featureCount; recordIndex++) {
```

### useDbQueries.ts
```diff
- const previewLimit =
-   params.totalRows && params.totalRows > MAX_MAP_PREVIEW_FEATURES
-     ? MAX_MAP_PREVIEW_FEATURES
-     : undefined;
- return DatabaseStreamReader.fetchOrStreamRecords(
-   params.config,
-   undefined,
-   params.onProgress,
-   previewLimit ? { limit: previewLimit } : undefined
- );
+ return DatabaseStreamReader.fetchOrStreamRecords(
+   params.config,
+   undefined,
+   params.onProgress
+ );
```

## 5. Verification & Testing
1. **Vitest Unit Suite**:
   - `npm test`: 35 suites passed, 363 tests passed (including `should not truncate features and mark isLargeDataset for datasets exceeding LARGE_DATASET_THRESHOLD`).
2. **Quality Gauntlet**:
   - `npm run modules:routes:check`: 7 routes verified.
   - `npm run lint`: 0 errors, 0 warnings.
   - `npm run build`: Production bundle builds cleanly.
   - `npm run doctor`: 100/100 score, 0 issues.
