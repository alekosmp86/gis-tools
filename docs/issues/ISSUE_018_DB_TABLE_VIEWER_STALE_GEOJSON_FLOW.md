# Issue 018: DB Table Viewer repeated PostgreSQL streaming and unnecessary derived-state mirroring

## Problem Statement
While extracting the DB table viewer data flow into a dedicated hook, the streaming effect was rewritten
to satisfy `react-hooks/exhaustive-deps` by adding every value the linter named to the dependency array,
including the object returned by `useStreamDbRecords()`. The result was an effect that re-ran on every
render and re-issued the PostgreSQL streaming request in a loop: each request flipped `isPending`,
each state change produced a new render, and each render produced a new dependency identity.

The same refactor also mirrored the spatial preview (`geojson`, `detectedGeometryType`) into `useState`
and populated it from the mutation's `onSuccess` callback, on the assumption that the previous
render-time derivation was recomputed on every render.

## Root Cause Analysis & Technical Details

### 1. Unstable dependency on a TanStack Query mutation object
`@tanstack/react-query` v5 builds the value returned by `useMutation` as a fresh object literal on every
render (`return { ...result, mutate, mutateAsync }`). Only `mutate` and `mutateAsync` are referentially
stable — `mutate` is wrapped in a `useCallback` keyed on the mutation observer.

Placing the whole mutation object in a dependency array therefore guarantees the effect re-runs on every
render. Because `mutate` itself triggers state transitions, the loop is self-sustaining and every
iteration re-enters `DatabaseStreamReader.fetchOrStreamRecords` against the database.

The original `eslint-disable-next-line react-hooks/exhaustive-deps` was hiding a lint symptom; replacing
it with an unstable dependency was strictly worse than the suppression it removed.

### 2. `columns` is not a fetch input
`columns` only affects geometry parsing, never the SQL query. Including it in the fetch effect made a
change to the column list re-stream the whole table.

### 3. Derived state was mirrored unnecessarily
React Compiler is enabled (`reactCompiler: true` in `next.config.ts`), so a derived value computed in a
hook or component body is already memoized on its inputs. The original render-time
`parseRecordsToGeoJson(records, columns)` call was not recomputing on every render, so copying its result
into `useState` added no performance benefit and introduced a desync window: if `columns` changed without
a refetch, the stored GeoJSON stayed stale. `react-doctor` confirms this independently — an explicit
`useMemo` around the same call is reported as
`react-doctor/react-compiler-no-manual-memoization`.

## Implemented Solution
`src/hooks/useDbTableViewerState.ts` now:

- depends only on the stable `mutate` callback and on the real query inputs (`config`, `totalRows`);
- keeps `records`, `detectedSrid` and `progressText` in state, and derives `geojson` /
  `detectedGeometryType` directly from `records` + `columns`, letting React Compiler memoize it;
- retains a `requestSequenceRef` guard so a superseded stream cannot overwrite newer records;
- clears the dataset on error instead of leaving stale rows on screen.

Supporting cleanups landed in the same change set:

- `DbTableViewerState` moved to `src/types/db.ts` per the type separation rule.
- `GeoJsonDatasetBuilder` lost its unused injectable-normalizer constructor and its unused
  `DEFAULT_NORMALIZER` static; `buildFromRecords` was decomposed into `findGeometryColumnName`,
  `resolveRecordGeometry` and `findGeometryInOtherColumns`, and abbreviated identifiers
  (`col`, `val`, `geoType`, `lower`) were renamed.

## Code Examples & Diff Snippets

```ts
// Before: the mutation result object is a new reference on every render,
// so this effect re-streams the table indefinitely.
const streamRecordsMutation = useStreamDbRecords();

useEffect(() => {
  streamRecordsMutation.mutate(/* ... */);
}, [columns, config, streamRecordsMutation, totalRows]);
```

```ts
// After: depend on the stable `mutate` callback and on actual query inputs only.
const { mutate: streamDbRecords, isPending, isError, error } = useStreamDbRecords();

useEffect(() => {
  streamDbRecords(/* ... */);
}, [config, streamDbRecords, totalRows]);
```

```ts
// Before: spatial preview mirrored into state from onSuccess.
const [geojson, setGeojson] = useState<FeatureCollection | null>(null);
onSuccess: (data) => {
  const parsed = parseRecordsToGeoJson(data.records, columns);
  setGeojson(parsed.geojson);
}

// After: derived from the dataset, memoized by React Compiler, never stale.
const { geojson, detectedGeometryType } = parseRecordsToGeoJson(records, columns);
```

## Verification & Testing

```bash
npm run lint     # exit 0, no findings
npm run build    # exit 0, compiled and typechecked, 13/13 static pages generated
npm run doctor   # exit 0, "No issues found!" across 148 scanned files
```

`react-doctor` reported `react-compiler-no-manual-memoization` at
`src/hooks/useDbTableViewerState.ts` while an explicit `useMemo` was still wrapping the derivation; the
final version removes it and the scan is clean.

An unrelated `package-lock.json` change (pruning of the `@emnapi/*` optional dependencies, an
`npm install` side effect) was reverted so it does not ride along with this fix.
