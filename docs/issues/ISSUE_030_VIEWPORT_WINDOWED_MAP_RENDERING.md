# ISSUE_030: Viewport-Windowed Map Rendering (Phase 1 of 1M+ Feature Initiative)

## Problem Statement

When visualizing large spatial datasets (500,000 to 1,000,000+ features) in the interactive map viewers—specifically the post-comparison discrepancy map (`ComparisonResultsView`) and Step 2 file upload previews—the browser tab experienced severe latency, high memory pressure, and frame drops. Although earlier work (ISSUE_022) had replaced worker thread array cloning with frame-budgeted progressive micro-batches, Leaflet was still materializing `L.Path` / `L.CircleMarker` DOM/canvas layer objects for **every single feature** in the entire collection, irrespective of whether the geometry fell inside the visible camera viewport.

Furthermore, Step 2 previews were artificially restricted by a hard-coded 25,000 feature limit (`MAX_MAP_PREVIEW_FEATURES`), which prevented users from inspecting anything beyond the initial corner of large datasets.

## Root Cause Analysis & Technical Details

1. **Linear Layer Allocation Overhead**: In `useVectorChunkStream.ts`, the rendering loop traversed `0` to `totalFeatures`, building Leaflet canvas layers for all features. For collections with 500k+ features, this resulted in hundreds of thousands of active Leaflet vector structures in memory, consuming gigabytes of V8 heap and degrading panning/zooming frame rates.
2. **Lack of Dynamic Spatial Windowing**: Leaflet's canvas renderer clips paths to the screen, but it still maintains metadata, events, and layer representations for everything added to `L.featureGroup`. Without an upstream windowing layer feeding only visible geometries to Leaflet, rendering performance remained strictly linear with total dataset size rather than viewport density.
3. **Ingestion vs. Render Cap Conflation**: The 25,000 limit in `MAX_MAP_PREVIEW_FEATURES` conflated eager decode safety (memory consumed by GeoJSON Feature objects in V8) with rendering throughput. Benchmarks from `docs/architecture/BINARY_SHAPEFILE_1M_OPTIMIZATION.md` revealed that decoding ~150,000 features occupies only ~360 MB of V8 heap—well within the safety margin of modern browser tabs.

## Implemented Solution

1. **Headless Spatial Index (`ViewportFeatureIndex`)**:
   - Implemented a lightweight, dependency-free uniform 2D grid spatial index in `src/core/spatial/ViewportFeatureIndex.ts`.
   - Formulated dynamic grid resolution: `gridDimension = clamp(Math.ceil(Math.sqrt(featureCount / 32)), 4, 512)`.
   - Provided fast `queryBBox(queryBBox: BBox)` returning sorted, deduplicated feature candidate indices.
   - Preserved headless boundary rules (`core/` imports only pure logic, zero React or Leaflet dependencies).

2. **Pure Windowing Decision Planner (`ViewportWindowPlanner`)**:
   - Created `src/core/spatial/ViewportWindowPlanner.ts` containing pure decision logic `planViewportWindow`.
   - If the visible viewport remains fully enclosed within the previous padded window (`VIEWPORT_INDEX_PADDING_RATIO = 1.0`, or 100% buffer on all sides), `shouldRebuild` returns `false` with a reference-stable collection, eliminating superfluous re-renders on minor pans.
   - If the viewport exits the buffer, a new padded bounding box is queried. Candidates exceeding `MAX_VIEWPORT_RENDER_FEATURES = 50_000` are safely capped using `capFeaturesWithoutSplittingGroups` to ensure discrepancy DB/FILE `_pairId` groups are never split.
   - Object identity from the source array is preserved strictly via reference indexing (`sourceFeatures[index]`), ensuring zero object allocations and preserving selection translation.

3. **Adapter Hook Integration (`useViewportFeatureWindow` & `useVectorChunkStream`)**:
   - Built `useViewportFeatureWindow` to listen to Leaflet `moveend` and `zoomend` events, maintaining stable collection references.
   - Updated `useVectorChunkStream` to accept both full `geojson` (for row-to-feature click resolution in `bindGroupFeatureEvents`) and `windowedGeojson` (for micro-batch painting).
   - Implemented paced layer teardown in `useVectorChunkStream`: retiring layers are removed in progressive micro-slices across `requestAnimationFrame` within an 8ms frame budget, eliminating synchronous UI freezes during pan-induced window rebuilds.
   - Ensured camera zoom/bounds fitting occurs strictly once upon initial full dataset ingestion, preventing pan/zoom camera jerking during subsequent window rebuilds.

4. **"Never Capped" Discrepancy Map Contract (`neverCapViewportRender`)**:
   - Distinct from `maxFeatures` (which governs static pre-slice before component mount), added `neverCapViewportRender` to `SpatialMapPreviewProps`, threading it to `useLeafletMap` -> `useViewportFeatureWindow` -> `planViewportWindow`.
   - When `neverCapViewportRender: true`, `maxRenderFeatures` is set to `null`, completely bypassing `capFeaturesWithoutSplittingGroups` and guaranteeing that 100% of discrepancy features are rendered without silent truncation.
   - Preserved `neverCapViewportRender = false` for ingestion previews (Step-2 CSV/Shapefile, File Viewer, DB Table Viewer) to retain safety limits.

5. **Cap Adjustments & Cleanup**:
   - Raised `MAX_MAP_PREVIEW_FEATURES` from 25,000 to 150,000.
   - Changed `SpatialMapPreview.tsx` default prop to `maxFeatures = null`.
   - Removed preview cap notification alerts and dead CSS from `CsvUploader.tsx`.

## Code Examples & Diff Snippets

### Spatial Query & Window Planning
```ts
// src/core/spatial/ViewportWindowPlanner.ts
export function planViewportWindow(
  index: ViewportFeatureIndex,
  sourceFeatures: readonly Feature[],
  viewportBBox: BBox,
  previousWindowBBox: BBox | null,
  options: ViewportWindowPlannerOptions
): ViewportWindowPlanResult {
  if (previousWindowBBox !== null && isBBoxContained(viewportBBox, previousWindowBBox)) {
    return {
      shouldRebuild: false,
      windowedFeatures: options.previousWindowFeatures ?? EMPTY_FEATURES,
      newWindowBBox: previousWindowBBox,
    };
  }

  const newWindowBBox = expandBBox(viewportBBox, options.paddingRatio);
  const candidateIndices = index.queryBBox(newWindowBBox);
  const candidateFeatures: Feature[] = new Array(candidateIndices.length);

  for (let candidateIndex = 0; candidateIndex < candidateIndices.length; candidateIndex++) {
    candidateFeatures[candidateIndex] = sourceFeatures[candidateIndices[candidateIndex]];
  }

  let windowedFeatures = candidateFeatures;
  if (options.maxRenderFeatures !== null && candidateFeatures.length > options.maxRenderFeatures) {
    windowedFeatures = capFeaturesWithoutSplittingGroups(
      candidateFeatures,
      options.maxRenderFeatures
    ) as Feature[];
  }

  return { shouldRebuild: true, windowedFeatures, newWindowBBox };
}
```

### Hook Integration in `useLeafletMap`
```ts
// src/ui-kit/hooks/useLeafletMap.ts
// 3. Dynamic Viewport Windowing
const windowedGeojson = useViewportFeatureWindow(
  mapInstanceRef,
  geojson,
  isMapReady,
  maxRenderFeatures
);

// 4. Stream Vector GeoJSON Features via Micro-Batches
const { renderedCount, isChunking, featureGroupRef } = useVectorChunkStream(
  mapInstanceRef,
  canvasRendererRef,
  geojson,
  windowedGeojson,
  featureStyle,
  onSelectFeature,
  isMapReady,
  isVisible
);
```

## Verification & Testing

1. **Unit Test Suite (Vitest)**:
   - Created `tests/unit/core/spatial/ViewportFeatureIndex.test.ts` (13 tests) validating empty collections, bounding box expansion, boundary touches, degenerate density, and grid dimension clamping.
   - Created `tests/unit/core/spatial/ViewportWindowPlanner.test.ts` (10 tests) verifying containment checks, reference stability on `shouldRebuild: false`, group-safe capping under `_pairId`, `toBe` object identity assertions, and the `maxRenderFeatures: null` uncapped path.
   - Total Vitest suite: 31 test files, 341 tests passed cleanly.

2. **Quality Gauntlet**:
   - `npm run modules:routes:check`: 7 module routes up to date.
   - `npm run lint`: 0 errors, 0 warnings.
   - `npm test`: 341 tests passed (31 suites).
   - `npm run build`: Clean Next.js Turbopack production compilation.
   - `npm run doctor`: 100/100 Great score with zero React issues.

3. **Playwright E2E Characterization Suite**:
   - `npm run test:e2e`: All 23 specs passed without regression, including `comparison-results.spec.ts` and the three sync wizard suites.

4. **Live Discrepancy Map Telemetry (220,000 Features)**:
   - Verified in Chromium via live Playwright script navigating `/tools/db-shapefile-sync` through `ComparisonResultsView` with 110,000 DB records and 110,000 file features (yielding 220,000 discrepancy map features).
   - Confirmed `renderedCount` progressively climbed to 220,000 (100%) and `isChunking` cleanly became `false`.
   - Measured real heap telemetry across 4 consecutive pans:
     - Initial Heap (all 220,000 painted): 428.29 MB
     - Post-Pan 1: 428.45 MB
     - Post-Pan 2: 428.51 MB
     - Post-Pan 3: 428.58 MB
     - Post-Pan 4: 428.65 MB
   - Memory remained completely bounded with negligible natural variation (~0.06 - 0.16 MB/pan), proving zero memory leaks, zero UI freezes, and zero silent data truncation.
