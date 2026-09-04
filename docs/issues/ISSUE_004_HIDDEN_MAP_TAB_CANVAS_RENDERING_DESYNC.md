# Issue #004: Hidden Map Tab Canvas Rendering & Viewport Desynchronization

## Problem Statement
When navigating the Step 4 Results View, the three presentation modes (*Tabla de Discrepancias*, *Mapa de Discrepancias Espaciales*, and *Script SQL PostGIS*) are kept mounted in the DOM to avoid the destructive overhead of tearing down 500k+ Leaflet layer instances.

However, if a user clicked a KPI filter card (e.g. from *Total Evaluados* to *Discrepancias Geométricas*) while viewing the **Table** tab, the underlying map received the new GeoJSON dataset while its container was hidden via `.tabHidden` (`display: none;`).
- In `display: none`, the container dimensions were `0x0`.
- Leaflet's HTML5 Canvas renderer was unable to calculate pixel coordinates on a zero-size viewport, exiting early without painting the paths.
- When the user subsequently switched to the **Map** tab, the container became visible, but the map displayed an empty screen because the GeoJSON collection was marked as already processed (`lastProcessedGeojson === geojson`), and no redraw/bounds-fitting was triggered.

---

## Root Cause Analysis & Technical Details

1. **Zero-Size Viewport During Background Filter Updates**:
   - Leaflet's `L.Canvas` relies on `map._size` (`map.getSize()`) to project geographical `LatLng` coordinates to canvas pixel space.
   - When `discrepancyGeojson` updated while `activeViewTab !== ResultsViewTab.MAP`, `useVectorChunkStream` added layers to `L.Canvas` whose internal viewport was `(0, 0)`.
2. **Missing Visibility-Aware Lifecycle in Vector Stream Hook**:
   - `useVectorChunkStream` started web worker chunking and canvas painting unconditionally, regardless of whether the DOM container was visible.
   - Upon completion, `lastProcessedGeojsonRef.current` was set to the new GeoJSON reference.
   - When the user switched tabs, the map became visible, but since `lastProcessedGeojsonRef.current === geojson`, `useVectorChunkStream` did nothing, leaving the map blank.

---

## Implemented Solution

We established a **visibility-aware map rendering lifecycle**:

1. **`isVisible` Prop Propagation**:
   - Added `isVisible: boolean = true` prop to [`SpatialMapPreview.tsx`](src/components/shared/SpatialMapPreview.tsx), [`useLeafletMap.ts`](src/hooks/useLeafletMap.ts), and [`useVectorChunkStream.ts`](src/hooks/map/useVectorChunkStream.ts).
   - In [`Step4ResultsView.tsx`](src/components/tools/db-sync-common/Step4ResultsView.tsx), passed `isVisible={activeViewTab === ResultsViewTab.MAP}`.
2. **Deferred Rendering While Hidden**:
   - When `!isVisible`, `useVectorChunkStream` skips worker chunking into the 0x0 container.
3. **Automatic Resynchronization On Tab Visibility**:
   - When `isVisible` transitions from `false` to `true`:
     - If `lastProcessedGeojson !== geojson`, it calls `mapInstance.invalidateSize()`, resets the layer group, and streams the new GeoJSON features smoothly onto the visible canvas.
     - If `lastProcessedGeojson === geojson` (already painted), it immediately invokes `mapInstance.invalidateSize()` and `mapInstance.fitBounds(featureGroup.getBounds())` to ensure the viewport is accurately sized and centered.

---

## Verification & Testing

- **Compilation & Lints**: Passed with 0 errors via `npx tsc --noEmit` and `npm run lint`.
- **User Scenario Test**:
  1. On Step 4, stay on the *Tabla de Discrepancias* tab.
  2. Click the *Discrepancias Geométricas* KPI card (filtering to 40,441 records).
  3. Click the *Mapa de Discrepancias Espaciales* tab.
  4. The map automatically sizes its viewport, streams the 40,441 geometric discrepancies, and fits the bounding box without requiring any additional clicks.
