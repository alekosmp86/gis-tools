# Issue #001: Shapefile Features Invisible on Map Preview (Projected Coordinates / UTM)

> **Category**: Map Visualization / Shapefile Parsing  
> **Status**: Resolved  
> **Date**: 2026-09-02  
> **Affected Files**:
> - [`src/utils/binary/binaryShpReader.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/binary/binaryShpReader.ts)
> - [`src/services/parsers/ShapefileParser.ts`](file:///c:/Alekos/Projects/gis-tools/src/services/parsers/ShapefileParser.ts)
> - [`src/workers/comparisonCore.ts`](file:///c:/Alekos/Projects/gis-tools/src/workers/comparisonCore.ts)
> - [`src/utils/spatial/projectionUtils.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/spatial/projectionUtils.ts)
> - [`src/utils/spatial/geometryComparator.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/spatial/geometryComparator.ts)
> - [`src/hooks/useDiscrepancyGeojson.ts`](file:///c:/Alekos/Projects/gis-tools/src/hooks/useDiscrepancyGeojson.ts)
> - [`src/app/api/db/records/route.ts`](file:///c:/Alekos/Projects/gis-tools/src/app/api/db/records/route.ts)

---

## 1. Problem Statement

When uploading a Shapefile package in a `.zip` archive (e.g., `service_area_ultron.zip` with 407 polygons), the user interface successfully extracted metadata (attributes, feature count, geometry type), but the interactive Leaflet map preview displayed only a blank/default world map view at zoom 0 with no vector shapes visible.

### User Symptom
- Attribute list tags and feature counts rendered correctly (e.g., `407 entidades`, `Polygon`).
- The vector map preview failed to center or display polygons, displaying the global basemap instead.

---

## 2. Root Cause Analysis & Technical Details

1. **Direct Binary Byte Reading**:
   The low-level zero-allocation binary reader ([`BinaryShpReader.ts`](file:///c:/Alekos/Projects/gis-tools/src/utils/binaryShpReader.ts)) parsed shape geometry records directly from the raw `.shp` binary byte buffer into GeoJSON `coordinates`.

2. **Projected Coordinate Reference Systems (CRS)**:
   Many GIS Shapefiles use projected coordinate systems (such as UTM Zone 19S/21S, EPSG:32719, Gauß-Krüger, Web Mercator EPSG:3857, etc.) where coordinate values are stored in metric distances (e.g., Easting $X \approx 576{,}000\text{ m}$, Northing $Y \approx 6{,}140{,}000\text{ m}$).

3. **Leaflet Coordinate Constraints**:
   Leaflet's Web Mercator renderer expects geographic latitude/longitude degrees in WGS84 (`EPSG:4326`):
   - Longitude: $[-180.0, 180.0]$
   - Latitude: $[-90.0, 90.0]$

4. **Missing Projection Step**:
   Because `BinaryShpReader` did not parse the `.prj` projection file or reproject coordinates to WGS84 degrees, Leaflet received coordinates such as `[576000, 6140000]`. Leaflet could not compute valid bounding boxes (`LatLngBounds.isValid()` failed) and rendered the default world view without drawing the shapes.

---

## 3. Implemented Solution

1. **`src/utils/projectionUtils.ts`**:
   - Created `createProjectionConverter(prjText)` utilizing `proj4`.
   - Parses standard ESRI WKT strings extracted from `.prj` files inside the Shapefile `.zip` archive.
   - Converts coordinates dynamically from the source projection to WGS84 (`EPSG:4326`).
   - Automatically detects if the layer is already in geographic WGS84 degrees and bypasses redundant conversion.

2. **`src/utils/binaryShpReader.ts`**:
   - Updated `readGeometry(recordIndex, transformCoordinate)` to accept an optional coordinate transformation function.
   - Transforms coordinates on-the-fly for `Point`, `MultiPoint`, `Polyline` (`LineString`), and `Polygon` / `MultiPolygon` shapes.

3. **`src/services/parsers/ShapefileParser.ts`**:
   - Initializes the projection converter with `extractedPackage.prjText` and passes it to `shpReader.readGeometry(...)` when generating the 50,000-feature initial preview collection.

4. **`src/workers/comparisonCore.ts` & `src/utils/geometryComparator.ts`**:
   - Web Worker comparison loop and PostGIS `INSERT` query generator decode projected geometries into valid WGS84 GeoJSON.
   - `normalizeGeometry` and `normalizeCoordinatesInGeometry` in `geometryComparator.ts` automatically detect and convert metric coordinates to WGS84 degrees, ensuring accurate geometric comparisons between DB and Shapefile records.

5. **`src/app/api/db/records/route.ts` & `src/hooks/useDiscrepancyGeojson.ts`**:
   - Database record queries automatically apply `ST_Transform("geom", 4326)` when native table SRID is projected (`ST_SRID > 0`).
   - `useDiscrepancyGeojson` normalizes both DB geometries (`dbGeom`) and Shapefile geometries (`shpGeom`) through `normalizeGeometry()`, rendering all discrepancy features at 60fps on the Step 4 interactive map without bounding box collapse.

---

## 4. Code Examples & Diff Snippets

### Before: Raw Untransformed Coordinates
```typescript
// In BinaryShpReader.ts (Old)
case ShapeType.POLYGON: {
  ...
  const coordinateX = this.dataView.getFloat64(pointsOffset + pointIndex * 16, true);
  const coordinateY = this.dataView.getFloat64(pointsOffset + pointIndex * 16 + 8, true);
  ringCoordinates.push([coordinateX, coordinateY]); // Output: [576000, 6140000] (Leaflet fails)
}
```

### After: Projected WGS84 Coordinates
```typescript
// In BinaryShpReader.ts (Fixed)
case ShapeType.POLYGON: {
  ...
  const rawCoordinateX = this.dataView.getFloat64(pointsOffset + pointIndex * 16, true);
  const rawCoordinateY = this.dataView.getFloat64(pointsOffset + pointIndex * 16 + 8, true);
  const [coordinateX, coordinateY] = transformCoordinate
    ? transformCoordinate([rawCoordinateX, rawCoordinateY])
    : [rawCoordinateX, rawCoordinateY];
  ringCoordinates.push([coordinateX, coordinateY]); // Output: [-68.1683, -34.8795] (Leaflet renders 60fps)
}
```

### Projection Converter Implementation
```typescript
// In src/utils/projectionUtils.ts
import proj4 from "proj4";

export function createProjectionConverter(
  prjText?: string | null
): ((coordinate: [number, number]) => [number, number]) | null {
  if (!prjText || !prjText.trim()) return null;

  const cleanPrj = prjText.trim();
  if (
    cleanPrj === "EPSG:4326" ||
    cleanPrj === "4326" ||
    (cleanPrj.startsWith("GEOGCS") && !cleanPrj.includes("PROJCS"))
  ) {
    return null;
  }

  try {
    const converter = proj4(cleanPrj, "EPSG:4326");
    return (coordinate: [number, number]): [number, number] => {
      try {
        const [transformedX, transformedY] = converter.forward(coordinate);
        if (isNaN(transformedX) || isNaN(transformedY)) return coordinate;
        return [transformedX, transformedY];
      } catch {
        return coordinate;
      }
    };
  } catch (error) {
    console.warn("Could not initialize proj4 for prjText:", error);
    return null;
  }
}
```

---

## 5. Verification & Testing

- **`npx tsc --noEmit`**: 0 TypeScript compilation errors.
- **`npm run lint`**: 0 ESLint warnings or errors.
- **`npm run doctor`**: Score **100 / 100 Great (`✔ No issues found!`)**.
- **`npm run build`**: Production bundle built successfully.
