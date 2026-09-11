# Issue 032 — Discrepancy Map Hidden Container Viewport Fit Racing

## Problem Statement
On the discrepancy analysis map (`ComparisonResultsView.tsx`'s "Mapa de Discrepancias Espaciales" tab), features were not consistently visible at once upon first switching into the tab. What rendered varied erratically depending on subsequent manual pan/zoom interactions. The discrepancy map carries an explicit "never capped" contract (`ComparisonResultsView.tsx:143-146`), requiring all discrepancy features across the entire geographic extent to be immediately visible without manual intervention or forcing the user to locate and click "Ajustar vista a los límites de la capa".

## Root Cause Analysis & Technical Details
1. **Zero-Size Hidden DOM Container**:
   The discrepancy map panel in `ComparisonResultsView.tsx` is wrapped in `.tabHidden { display: none !important; }` while the default `TABLE` tab is active.
2. **Premature Viewport Calculation**:
   `useViewportFeatureWindow`'s effect only checked `isMapReady` and `geojson` identity, without awareness of tab visibility (`isVisible`). When initialized, Leaflet attempted `mapInstance.fitBounds(bounds)` and `mapInstance.getBounds()` against a container with 0×0 dimensions (`offsetWidth == 0 && offsetHeight == 0`).
3. **Degenerate Bounding Box Caching**:
   `fitBounds` effectively no-oped on zero dimensions, leaving Leaflet at the default camera position (`[-32.5, -56.0]`, zoom 7). An invalid/partial bounding box was calculated and cached in `previousWindowBBoxRef`. Because `isVisible` was not in the dependency array, revealing the Map tab never re-triggered the dataset-extent `fitBounds`.
4. **DOM Unmounting on Inactive State**:
   In `ComparisonResultsView.tsx`, `useDiscrepancyGeojson` previously returned `null` whenever `!isMapActive`. This caused `SpatialMapPreview` to unmount upon switching away to the Table tab, tearing down the Leaflet map and defeating the DOM preservation pattern (`{/* Map View with Color-Coded Discrepancies (Preserved in DOM to eliminate 500k layer teardown overhead) */}`).

## Implemented Solution
1. **Visibility-Aware Windowing Hook (D1)**:
   Added `isVisible: boolean = true` parameter to `useViewportFeatureWindow`. Guarded the top of the effect with `if (!mapInstance || !isMapReady || !isVisible) return;` and included `isVisible` in the `useEffect` dependency array.
2. **Container Size Invalidation Before Bounds Calculations (D2)**:
   Added `mapInstance.invalidateSize()` immediately after visibility guards pass, ensuring Leaflet recalculates container dimensions before executing `fitBounds()` and before calling `mapInstance.getBounds()` inside `updateWindow()`.
3. **Camera Position Preservation Across Revisits (D3)**:
   Preserved `lastProcessedGeojsonRef.current !== geojson` as the exclusive gate for `fitBounds()`. On subsequent tab toggles with the same dataset, `fitBounds` is bypassed, preserving manual user camera adjustments while only updating the feature window.
4. **Hook Parameter Forwarding (D4)**:
   Forwarded `isVisible` from `useLeafletMap` down into `useViewportFeatureWindow(mapInstanceRef, geojson, isMapReady, maxRenderFeatures, isVisible)`.
5. **DOM Preservation & State Caching**:
   Updated `ComparisonResultsView.tsx` so that once the map is activated, it remains mounted in the DOM using the intended CSS `.tabHidden` pattern, and memoizes `discrepancyGeojson` across tab toggles so reference identity is preserved.
6. **Testing & Inspection Surface**:
   Exposed `data-rendered-count` on `SpatialMapPreview`'s container and attached `window.__gis_leaflet_map` for end-to-end verification.

## Code Examples & Diff Snippets

### `src/ui-kit/hooks/map/useViewportFeatureWindow.ts`
```diff
 export function useViewportFeatureWindow(
   mapInstanceRef: React.RefObject<L.Map | null>,
   geojson: FeatureCollection,
   isMapReady: boolean = false,
-  maxRenderFeatures: number | null = MAX_VIEWPORT_RENDER_FEATURES
+  maxRenderFeatures: number | null = MAX_VIEWPORT_RENDER_FEATURES,
+  isVisible: boolean = true
 ): FeatureCollection {
...
   useEffect(() => {
     const mapInstance = mapInstanceRef.current;
-    if (!mapInstance || !isMapReady) {
+    if (!mapInstance || !isMapReady || !isVisible) {
       return;
     }

+    mapInstance.invalidateSize();
+
     if (lastProcessedGeojsonRef.current !== geojson) {
...
-  }, [mapInstanceRef, geojson, isMapReady, maxRenderFeatures]);
+  }, [mapInstanceRef, geojson, isMapReady, maxRenderFeatures, isVisible]);
```

### `src/ui-kit/hooks/useLeafletMap.ts`
```diff
   // 3. Dynamic Viewport Windowing
   const windowedGeojson = useViewportFeatureWindow(
     mapInstanceRef,
     geojson,
     isMapReady,
-    maxRenderFeatures
+    maxRenderFeatures,
+    isVisible
   );
```

### `src/components/tools/db-sync-common/ComparisonResultsView.tsx`
```diff
+  const [hasActivatedMap, setHasActivatedMap] = useState<boolean>(false);
+  if (activeViewTab === ResultsViewTab.MAP && !hasActivatedMap) {
+    setHasActivatedMap(true);
+  }
+
+  const isMapActive = hasActivatedMap || activeViewTab === ResultsViewTab.MAP;
```

## Verification & Testing
1. **Playwright E2E Regression Suite (`tests/e2e/flows/comparison-results.spec.ts`)**:
   - Verified that switching directly from the Table tab to the Map tab on first visit renders all features (`data-rendered-count="3"`) and adjusts camera center (`centerLatitude < -34.0`), distinguishing it from the default view at `-32.5`.
   - Verified tab revisit camera retention: switching Table → Map → panning to `[-10.0, -20.0]` → Table → Map preserves the camera center without resetting to full extent.
2. **Quality Gauntlet**:
   - `npm run modules:routes:check`: 7 route files up to date.
   - `npm run lint`: 0 errors, 0 warnings.
   - `npm test`: 355 unit tests passing.
   - `npm run build`: Turbopack production build clean.
   - `npm run doctor`: 0 issues found (100/100).
   - `npm run test:e2e`: 24/24 specs passing.
