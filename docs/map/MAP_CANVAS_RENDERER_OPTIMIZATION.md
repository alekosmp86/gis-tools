# Map Performance Optimization, Sub-Hooks & Dynamic Symbology

> **Topic**: Vector feature rendering performance, sub-hook map architecture, and dynamic layer symbology.  
> **Status**: Implemented & Production Active

---

## 1. Sub-Hook Map Architecture

The Leaflet map engine inside [`useLeafletMap.ts`](src/hooks/useLeafletMap.ts) functions as a clean facade orchestrating 5 single-responsibility sub-hooks located in `src/hooks/map/`:

- **[`useMapInstance.ts`](src/hooks/map/useMapInstance.ts)**: Handles DOM container mounting, Leaflet instance creation, HTML5 Canvas renderer (`L.canvas({ padding: 0.5 })`), and publishes the `isMapReady` state signal.
- **[`useBasemapTileLayer.ts`](src/hooks/map/useBasemapTileLayer.ts)**: Manages smooth basemap tile switching (OpenStreetMap, Esri World Imagery Satellite, and CartoDB Dark Matter).
- **[`useVectorChunkStream.ts`](src/hooks/map/useVectorChunkStream.ts)**: Receives GeoJSON feature collections, offloads indexing to `mapChunkWorker.ts`, and streams 400-feature micro-batches without locking up the UI thread.
- **[`useFeatureHighlight.ts`](src/hooks/map/useFeatureHighlight.ts)**: Listens for attribute table record selections, renders a glowing target highlight overlay, and smoothly pans/zooms the map camera (`flyTo` / `panTo`).
- **[`useLayerSymbology.ts`](src/hooks/map/useLayerSymbology.ts)**: Listens to symbology state updates and applies 60fps dynamic styling to all canvas vector layers without rebuilding the feature index.

---

## 2. Dynamic Layer Symbology Popover Panel

Users can customize vector feature rendering dynamically using [`MapStylePopover.tsx`](src/components/shared/map/MapStylePopover.tsx):

### Customization Options
- **Color Swatches & Custom Picker**: Preset color palette (Cyan, Emerald, Amber, Rose, Purple, Blue, Slate) plus native color picker.
- **Line Weight**: 1px to 10px range slider (`weight`).
- **Stroke & Fill Opacity**: Independent opacity sliders from 0.0 to 1.0 (`opacity` / `fillOpacity`).
- **Point Radius**: 4px to 18px range slider for `L.circleMarker` point layers.
- **Line Patterns**: Buttons for `SOLID`, `DASHED` (`dashArray: "8, 8"`), and `DOTTED` (`dashArray: "3, 6"`).

---

## 3. Shared Canvas Renderer (`L.canvas`) Optimization

### SVG vs Canvas Comparison
Leaflet defaults to SVG rendering, where each vector feature generates an individual `<path>` or `<circle>` DOM node. Rendering 10,000 features creates 10,000 DOM elements, causing severe DOM repaint lag during zoom and pan events.

### HTML5 Canvas Solution
By passing `L.canvas({ padding: 0.5 })` to `PathOptions` and `CircleMarkerOptions`, all features draw onto a single `<canvas>` element:

| Metric | SVG (Previous) | Canvas (Current) |
|---|---|---|
| DOM Node Count | 1 node per feature (thousands) | **1 `<canvas>` element total** |
| Pan / Zoom Repaint Cost | N × DOM recalculations | Single GPU/Canvas redraw |
| Frame Rate (Pan/Zoom) | ~15–20 fps (laggy) | **Smooth 60 fps** |
