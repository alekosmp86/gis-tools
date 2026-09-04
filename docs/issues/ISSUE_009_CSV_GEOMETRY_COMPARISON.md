# Issue #009: Spatial Geometry Comparison for DB vs. CSV Synchronization

> **Category**: Spatial Comparison / Parsers / DB vs CSV Synchronization  
> **Status**: Resolved  
> **Date**: 2026-09-03  
> **Affected Files**:
> - [`src/app/tools/db-csv-sync/page.tsx`](src/app/tools/db-csv-sync/page.tsx)
> - [`src/hooks/useDatasetComparison.ts`](src/hooks/useDatasetComparison.ts)
> - [`src/utils/spatial/EwkbGeometryParser.ts`](src/utils/spatial/EwkbGeometryParser.ts)
> - [`src/utils/spatial/WktGeometryParser.ts`](src/utils/spatial/WktGeometryParser.ts)
> - [`src/workers/comparison/SpatialComparisonEngine.ts`](src/workers/comparison/SpatialComparisonEngine.ts)

---

## 1. Problem Statement

In the **DB vs. CSV Synchronization Tool** (`/tools/db-csv-sync`), spatial geometry comparison was disabled:
1. The comparison toggle checkbox was hidden in Step 3 (`showGeometryToggle={false}`).
2. PostgreSQL bytea raw hex strings prefixed with `\x` or `0x` (e.g. `\x01030000...`) were rejected by the EWKB parser.
3. In databases where geometries reside in a column named `geom_wkb` while an unpopulated/NULL `geom` column also exists, the comparison engine's fallback hierarchy read the empty `geom` column, skipping the populated `geom_wkb` column mapped by the user.

---

## 2. Root Cause Analysis & Technical Details

- **Hidden UI Toggle**: In `src/app/tools/db-csv-sync/page.tsx`, `SuidMappingStep` hardcoded `showGeometryToggle={false}`, preventing users from enabling geometry comparison.
- **Cache Invalidation**: `useDatasetComparison.ts` omitted `mappingConfig.compareGeometry` from the React Query `queryKey`, meaning toggling the checkbox did not invalidate the comparison cache.
- **Prefix Rejection in EWKB Parser**: `EwkbGeometryParser.ts` and `WktGeometryParser.ts` expected raw hex characters and failed regex matching when strings started with PostgreSQL bytea prefixes (`\x` or `0x`).
- **Unmapped Column Evaluation**: `SpatialComparisonEngine.ts` evaluated candidate columns in a hardcoded order (`geom ?? geometry ?? ...`), ignoring `mappingConfig.attributeMap` (e.g. DB `geom_wkb` ↔ CSV `geom`), causing unpopulated `geom` columns to shadow populated `geom_wkb` columns.

---

## 3. Implemented Solution

1. **Step 3 Checkbox Toggle**: Set `showGeometryToggle={true}` in `src/app/tools/db-csv-sync/page.tsx`.
2. **React Query Key**: Added `mappingConfig.compareGeometry` to `queryKey` in `src/hooks/useDatasetComparison.ts`.
3. **Hex Prefix Sanitization**: Added `.replace(/^(\\x|0x)/i, "")` in `EwkbGeometryParser.ts` and `WktGeometryParser.ts`.
4. **Mapped Column Comparison**: Updated `evaluateGeometryDifference` in `SpatialComparisonEngine.ts` to check the mapped geometry column from `mappingConfig.attributeMap` (or `dbRec.geom_wkb`), decode strings via `parseAnyGeometryString`, and pass resolved geometries for Canvas map rendering.

---

## 4. Code Examples & Diff Snippets

### Hex Prefix Stripping (`EwkbGeometryParser.ts`)
```typescript
// BEFORE: Failed on \x010300...
const cleanHex = rawInput.trim();

// AFTER: Strips \x and 0x prefixes
const rawHex = rawInput.trim();
const cleanHex = rawHex.replace(/^(\\x|0x)/i, "");
```

### Mapped Geometry Comparison (`SpatialComparisonEngine.ts`)
```typescript
// Resolve mapped geometry column from Step 3
let mappedDbCol: string | undefined = undefined;
let mappedFileCol: string | undefined = undefined;

if (mappingConfig.attributeMap) {
  for (const [dbKey, fileKey] of Object.entries(mappingConfig.attributeMap)) {
    if (/geom/i.test(dbKey) || /geom/i.test(fileKey)) {
      mappedDbCol = dbKey;
      mappedFileCol = fileKey;
      break;
    }
  }
}

const rawDbGeom = (mappedDbCol ? dbRec[mappedDbCol] : undefined)
  ?? dbRec.geom_wkb
  ?? dbRec.geom
  ?? dbRec.geometry;

const dbGeom = typeof rawDbGeom === "string" ? parseAnyGeometryString(rawDbGeom) || rawDbGeom : rawDbGeom;
const rawFileGeom = fileGeometry ?? (mappedFileCol && fileRec ? fileRec[mappedFileCol] : undefined);
const fileGeom = typeof rawFileGeom === "string" ? parseAnyGeometryString(rawFileGeom) || rawFileGeom : rawFileGeom;
```

---

## 5. Verification & Testing

- `npx tsc --noEmit`: 0 errors.
- `npm run lint`: 0 errors, 0 warnings.
- `npm run build`: Production bundle compiled cleanly with Turbopack.
