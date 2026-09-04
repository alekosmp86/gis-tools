# Issue #017: Capping Features in DB-CSV Step 2 Map Preview

## Problem Statement
In the **DB vs. CSV Synchronization** tool (`/tools/db-csv-sync`), the Step 2 file inspection view (`CsvUploader.tsx`) loaded the entire parsed GeoJSON feature collection directly into `<SpatialMapPreview />`. When uploading large CSV files containing tens or hundreds of thousands of records with spatial coordinates (EWKB Hex or WKT), Leaflet attempted to mount and stream all records onto the map canvas during Step 2. This caused UI stuttering, freezing, and memory spikes during an initial inspection step whose sole purpose was to preview the spatial extent and verify column mappings.

Meanwhile, the user required that the final step (Step 4 `Step4ResultsView`) continue rendering all discrepancies and records without any restriction or truncation.

## Root Cause Analysis & Technical Details
1. **Uncapped Preview Collection in Step 2**:
   - In `src/components/tools/db-csv-sync/CsvUploader.tsx`, `<SpatialMapPreview geojson={data.geojson} />` passed the raw, uncapped GeoJSON dataset straight to `useLeafletMap`.
   - While `ShapefileParser.ts` and `useDbQueries.ts` already enforced a preview cap of `25_000` features, `CsvUploader` lacked this limit and rendered 100% of the parsed rows.
2. **Scattered Magic Number**:
   - `25_000` was hardcoded independently in `ShapefileParser.ts` and `useDbQueries.ts` without a unified single source of truth in `src/constants/mapConstants.ts`.

## Implemented Solution
1. **Centralized Map Preview Threshold**:
   - Defined and exported `MAX_MAP_PREVIEW_FEATURES = 25_000` in [`src/constants/mapConstants.ts`](file:///c:/Alekos/Projects/gis-tools/src/constants/mapConstants.ts).
   - Reused `MAX_MAP_PREVIEW_FEATURES` in [`ShapefileParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/ShapefileParser.ts) and [`useDbQueries.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/useDbQueries.ts).
2. **Dedicated Preview Slicing in `CsvUploader`**:
   - Created `buildCappedPreviewGeoJson(geojson, maxFeatures)` helper function in [`CsvUploader.tsx`](file:///c:/Alekos/Projects/gis-tools/src/components/tools/db-csv-sync/CsvUploader.tsx).
   - Generated a slice of features (`geojson.features.slice(0, MAX_MAP_PREVIEW_FEATURES)`) exclusively for the Step 2 preview map.
   - When capped, rendered an informational warning banner via `AlertMessage` (`AlertType.WARNING`):
     *"Vista previa de muestra: Mostrando los primeros {X} de {Total} registros con geometría en el mapa inicial para asegurar fluidez de navegación. La totalidad de los {Total} registros se auditará y visualizará en el paso final."*
3. **Preserving 100% Uncapped Dataset for Subsequent Steps**:
   - `onSuccess(parsed)` continues to pass the complete, intact `ParsedFileDataset` to `DbCsvSyncToolPage`.
   - Step 3 (SUID Mapping) and Step 4 (Results View and discrepancy map) receive the full dataset with all records and all geometries intact.

## Code Examples & Diff Snippets

### Centralized Constant in `src/constants/mapConstants.ts`
```typescript
/** Maximum number of features rendered in initial file preview maps to maintain responsiveness and prevent memory exhaustion */
export const MAX_MAP_PREVIEW_FEATURES = 25_000;
```

### Feature Slicing & Warning in `src/components/tools/db-csv-sync/CsvUploader.tsx`
```tsx
function buildCappedPreviewGeoJson(
  geojson: FeatureCollection | undefined,
  maxFeatures: number
): FeatureCollection | null {
  if (!geojson || !geojson.features || geojson.features.length === 0) {
    return null;
  }
  if (geojson.features.length <= maxFeatures) {
    return geojson;
  }
  return {
    ...geojson,
    features: geojson.features.slice(0, maxFeatures),
  };
}
```

```tsx
{previewGeojson && previewGeojson.features.length > 0 && (
  <div className={styles.mapSection}>
    {isPreviewCapped && data.geojson && (
      <AlertMessage
        type={AlertType.WARNING}
        className={styles.previewNotice}
        text={`Vista previa de muestra: Mostrando los primeros ${formatNumber(previewGeojson.features.length)} de ${formatNumber(data.geojson.features.length)} registros con geometría en el mapa inicial para asegurar fluidez de navegación. La totalidad de los ${formatNumber(data.featureCount)} registros se auditará y visualizará en el paso final.`}
      />
    )}
    <SpatialMapPreview
      geojson={previewGeojson}
      title="VISTA PREVIA ESPACIAL DEL ARCHIVO CSV"
    />
  </div>
)}
```

## Verification & Testing
- **TypeScript Checking**: `npx tsc --noEmit` exited cleanly with code 0.
- **ESLint Quality Gate**: `npm run lint` passed with 0 errors and 0 warnings.
- **React Doctor Audit**: `npm run doctor` passed with a perfect **100 / 100** score (zero warnings, zero issues).
- **Next.js Production Build**: `npm run build` compiled all routes and static pages successfully.
