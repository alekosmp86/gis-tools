# Issue 020: Attribute table and preview map selections pointed at different entities

## Problem Statement
Selecting a row in the attribute table highlighted the wrong geometry on the map, and clicking a
geometry highlighted the wrong row. The mismatch did not appear in every dataset: it started at the
first record whose geometry failed to parse, and everything after that offset was shifted.

In the file viewer the symptom was worse and unconditional. For large datasets the map renders a
capped sample of the features while the table lists every record, so the two were guaranteed to
disagree.

## Root Cause Analysis & Technical Details
A single `selectedIndex` state was shared by two components that index **different arrays**:

- `AttributeTable` indexes the full record list — `records` in the DB table viewer,
  `Array.from(recordsMap.values())` in the file viewer.
- `SpatialMapPreview` indexes `geojson.features`, and `useFeatureHighlight` reads
  `geojson.features[selectedFeatureIndex]` directly.

Every producer emits a feature only when geometry is available, while still recording the row:

```ts
// CsvParser.processRows — the row is always recorded…
recordsMap.set(`row-${recordIndex}`, record);
// …but the feature only exists when the geometry parsed.
if (parsedGeom) { geojsonFeatures.push({ type: "Feature", geometry: parsedGeom, properties: record }); }
```

`ShapefileParser` and `GeoJsonDatasetBuilder` follow the same shape. As soon as one record yields no
geometry, `features.length < records.length` and the two index spaces drift apart permanently.

Of the three producers, only `GeoJsonDatasetBuilder` recorded the link back to its source row
(`id: recordIndex`). The two file parsers recorded nothing, so no translation was even possible.

## Implemented Solution
The **record index is now the single source of truth** for selection, and translation happens at the
map boundary.

- `CsvParser` and `ShapefileParser` stamp `id` on each feature with the record's position in
  `recordsMap` insertion order — the same order `Array.from(recordsMap.values())` produces for the
  table. `GeoJsonDatasetBuilder` already did this.
- A new `buildFeatureRecordIndex` utility builds both directions once per collection. Features with no
  numeric `id` fall back to their own position, so collections produced by the comparison engines keep
  their existing behaviour instead of losing selection.
- `DbTableViewerContainer` and `FileViewerContainer` hold `selectedRecordIndex`. The table binds to it
  directly; the map receives a translated feature index and its callback translates back.

Record index — not feature index — has to be the source of truth: a record whose geometry did not
parse has no feature at all, and its row must still be selectable in the table.

## Code Examples & Diff Snippets

```tsx
// Before: one index, two different arrays.
<SpatialMapPreview selectedFeatureIndex={selectedIndex} onSelectFeature={setSelectedIndex} />
<AttributeTable records={records} selectedIndex={selectedIndex} onSelectRow={setSelectedIndex} />
```

```tsx
// After: record index is authoritative, translated for the map.
const featureRecordIndex = buildFeatureRecordIndex(geojson?.features);
const selectedFeatureIndex =
  selectedRecordIndex === null ? null : featureRecordIndex.toFeatureIndex(selectedRecordIndex);

<SpatialMapPreview
  selectedFeatureIndex={selectedFeatureIndex}
  onSelectFeature={(featureIndex) =>
    setSelectedRecordIndex(
      featureIndex === null ? null : featureRecordIndex.toRecordIndex(featureIndex)
    )
  }
/>
<AttributeTable records={records} selectedIndex={selectedRecordIndex} onSelectRow={setSelectedRecordIndex} />
```

```ts
// CsvParser: the feature now names the row it came from.
geojsonFeatures.push({ id: recordIndex, type: "Feature", geometry: parsedGeom, properties: record });
```

## Verification & Testing

```bash
npm run lint     # exit 0, no findings
npm run build    # exit 0, compiled and typechecked, 13/13 static pages generated
npm run doctor   # exit 0, "No issues found!" across 147 scanned files
```

`useVectorChunkStream` lists `onSelectFeature` among its effect dependencies, so an unstable callback
would re-render the entire map — the same failure class as issue 018. React Compiler memoizes the
translating closure on the collection it captures, and `react-doctor` reports no manual-memoization
finding, confirming no `useMemo`/`useCallback` needs to be added by hand.

**Still to verify at runtime:** load a CSV in which some rows have no parseable geometry, then confirm
that row→map and map→row selection agree past the first gap. The same check applies to the file
viewer's capped-sample path with a dataset above `MAX_MAP_PREVIEW_FEATURES`.

## Scope note
`Step4ResultsView` renders comparison results without an attribute table, so it has no divergence to
correct. Its collections are covered by the positional fallback in `buildFeatureRecordIndex`.
