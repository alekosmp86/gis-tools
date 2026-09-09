# Issue 022: Preview map render path allocated and copied the dataset several times per render

## Problem Statement
Rendering large spatial datasets in the shared preview map was slow and memory-hungry well before
Leaflet drew anything. The `MAX_MAP_PREVIEW_FEATURES` ceiling (25 000) kept the symptom manageable but
hid the cause: the render path copied the whole feature collection twice and allocated several
throwaway objects for every single feature.

## Root Cause Analysis & Technical Details
Four independent sources of per-feature cost sat between a `FeatureCollection` and the map.

**1. A worker that only sliced an array.** `useVectorChunkStream` posted the entire feature array to
`mapChunkWorker`, which sliced it into micro-batches, rebuilt every feature to stamp a
`_featureIndex` property, and posted each batch back. Every real cost — layer construction, style
computation, event binding — stayed on the main thread. The worker therefore bought nothing while
charging two full structured clones of the dataset plus two new objects per feature.

**2. A service object per feature.** `computeFeatureStyle`, `createPointToLayer`,
`bindFeatureEvents` and `buildPopupHtml` each instantiated their stateless class on every call
(`new MapSymbologyStyler()`, `new MapEventHandler()`, and with it `new MapPopupPresenter()`).

**3. A click listener per feature.** `onEachFeature` registered a closure on every rendered geometry,
each capturing the complete feature array.

**4. Chunk pacing that paced nothing.** The `MAP_CHUNK_DELAY_MS` timer delayed only the progress
*state update*; layer construction had already run synchronously in the worker message handler. The
cleanup also retained just the most recent timer handle, so callbacks from earlier chunks were never
cancelled on unmount.

### Measured baseline
A harness reproducing these operations (excluding Leaflet layer construction, which is unchanged):

| Cost | 25 000 features | 100 000 features |
|---|---|---|
| Feature rebuild for `_featureIndex` | 1.4 ms / 5.7 MB | 18.6 ms / 22.3 MB |
| Structured clone into the worker | 159.2 ms / 48.5 MB | 790.2 ms / 198.0 MB |
| Structured clone of chunks back out | 115.9 ms / 54.7 MB | 472.9 ms / 26.8 MB |
| `new MapSymbologyStyler()` per feature | 3.3 ms / 5.8 MB | 11.1 ms / 18.7 MB |
| `new MapEventHandler()` + presenter per feature | 2.4 ms / 3.9 MB | 11.3 ms / 14.5 MB |
| **Total** | **~282 ms / ~119 MB** | **~1 304 ms / ~280 MB** |

The cost is linear in feature count, which is why 1M+ features were never viable through this path.

## Implemented Solution
- **Shared stateless instances.** `MapSymbologyStyler`, `MapEventHandler` and `MapPopupPresenter` now
  reuse one private static instance instead of allocating per call.
- **Style resolution cached by discrepancy type.** `createStyleResolver` binds one style and renderer
  and computes `PathOptions` once per discrepancy type rather than once per feature. Sharing is safe
  because Leaflet's `setOptions` copies properties onto each layer instead of retaining the source.
- **One delegated click listener** on the parent `FeatureGroup` replaces one listener per feature.
- **The worker is gone.** Chunks are sliced directly from the source collection on the main thread;
  `Array.slice` yields references, so no feature object is copied on the way to Leaflet.
- **Chunks are paced by `requestAnimationFrame`**, one batch per frame, so the browser actually paints
  between batches. Only one frame handle can be pending, which also fixes the disposal leak.

### A trap worth recording
Leaflet propagates layer events to parent groups, but `_propagateEvent` sets `layer: e.target` at each
hop. Rendered chunks are nested (`path` → `L.GeoJSON` sub-group → feature group), so after the second
hop `event.layer` refers to the **sub-group**, not the clicked geometry. Only `sourceTarget` survives
the chain, and the delegated handler reads that.

The plan originally intended to resolve the selected index from `feature.id`. An audit found only one
of five `Feature` producers sets an id, and `GeoJsonDatasetBuilder`'s id is the *record* index, which
diverges from the feature index whenever a record carries no geometry. Selection is therefore resolved
by object identity against the rendered collection — Leaflet's `asFeature` returns the same object
reference for inputs already of type `Feature`, so `indexOf` is exact. It runs once per click, not per
feature.

## Code Examples & Diff Snippets

```ts
// Before: two structured clones and two new objects per feature, to slice an array.
const worker = new Worker(new URL("../../workers/mapChunkWorker.ts", import.meta.url));
worker.postMessage({ type: CHUNK_GEOJSON, payload: { features: geojson.features, chunkSize } });
// worker: rawChunk.map((f, i) => ({ ...f, properties: { ...f.properties, _featureIndex: … } }))

// After: slice by reference on the main thread, one batch per frame.
const chunkFeatures = geojson.features.slice(renderedOffset, renderedOffset + MAP_MICRO_CHUNK_SIZE);
scheduledFrame = requestAnimationFrame(renderNextChunk);
```

```ts
// Before: a listener, a closure and two service objects per feature.
onEachFeature: (feature, layer) =>
  bindFeatureEvents(feature, layer, geojson.features, onSelectFeature),

// After: one delegated listener for the whole group.
bindGroupFeatureEvents(featureGroup, geojson?.features ?? [], onSelectFeature);
```

## Verification & Testing

```bash
npm run lint     # exit 0, no findings
npm run build    # exit 0, compiled and typechecked, 13/13 static pages generated
npm run doctor   # exit 0, "No issues found!" across 148 scanned files
```

Measured after the change, same harness and inputs: the removable overhead drops from ~282 ms /
~119 MB to ~2.6 ms / ~1.7 MB at 25 000 features, and from ~1 304 ms / ~280 MB to ~11 ms / ~6 MB at
100 000.

**Still to verify in the browser**, since the harness deliberately excludes Leaflet layer
construction: end-to-end time from dataset ready to fully painted map, and behaviour parity across
every consumer of `SpatialMapPreview` — the CSV and Shapefile load steps, `ComparisonResultsView`, the file
viewer and the DB table viewer. Popups, discrepancy colouring, progressive rendering and
bidirectional row↔map selection must behave as before.

## Known limitation
This work makes the existing 25 000-feature ceiling cheap; it does not make 1M+ features viable.
Leaflet still creates one layer object per feature, which is linear in memory and in per-redraw work.
Raising the ceiling meaningfully requires drawing geometry directly onto a canvas layer or rendering
only what is in the viewport — an architectural change that was deliberately left out of scope.
