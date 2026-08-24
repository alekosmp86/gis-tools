# Feature Documentation: CSV EWKB Geometry Parsing & Interactive Spatial Map Preview

Comprehensive technical documentation of all utilities, components, hooks, constants, and uploaders implemented in branch `feature/csv-ewkb-geometry-map`.

---

## 📁 Topics by File

### 1. `src/utils/ewkbParser.ts`
**Topic**: EWKB Hex Parsing & UTM Zone 19S (EPSG:32719) Coordinate Transformation

- **Purpose**: Zero-dependency binary EWKB Hex geometry parser and high-precision UTM 19S $(X, Y)$ meters to WGS84 $(\text{longitude}, \text{latitude})$ degrees coordinate converter.
- **Key Functions**:
  - `parseEwkbHexToGeoJson(hexStr: string): Geometry | null`: Parses PostGIS binary EWKB Hex headers (`Point`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`) with SRID support (e.g. `0105000020D17F0000...`).
  - `utm19sToWgs84(easting: number, northing: number): [number, number]`: Transforms projected coordinates in meters ($X \approx 443,000$, $Y \approx 6,650,000$) to geographic coordinates in degrees $(\text{lon}, \text{lat})$.

---

### 2. `src/services/parsers/CsvParser.ts`
**Topic**: CSV Spatial Geometry Column Auto-Detection & GeoJSON Building

- **Purpose**: Automatically detects geometry columns in CSV files and converts binary geometry attributes into GeoJSON feature collections.
- **Key Implementation Details**:
  - Auto-detects geometry column names matching `/^(geom|geometry|wkt|wkb_geometry)$/i`.
  - Decodes EWKB Hex strings into GeoJSON `FeatureCollection` stored in `dataset.geojson`.
  - Populates `dataset.geometryType` (e.g. `MultiLineString`).

---

### 3. `src/constants/mapConstants.ts`
**Topic**: Map Static Data, Basemap Tile Configurations & Discrepancy Color Mappers

- **Purpose**: Centralized dictionary of map static data, basemap layer URLs, and enum-based discrepancy color and Spanish label mappers.
- **Exported Constants & Functions**:
  - `BASEMAP_TILES`: Tile layer definitions for `voyager` (CartoDB Voyager Streets), `osm` (OpenStreetMap Standard), `satellite` (Esri World Imagery), and `dark` (CartoDB Dark Matter).
  - `DISCREPANCY_COLORS`: Map binding `DiscrepancyType` enum constants to distinct vector colors (`ATTRIBUTE_MISMATCH` $\rightarrow$ `#d97706` Amber, `ONLY_IN_SHP` $\rightarrow$ `#9333ea` Purple, `ONLY_IN_DB` $\rightarrow$ `#0284c7` Blue, `DUPLICATE_SUID` $\rightarrow$ `#ea580c` Orange, `NULL_SUID` $\rightarrow$ `#dc2626` Red, `MATCH` $\rightarrow$ `#059669` Emerald).
  - `getDiscrepancyColor(type?: string)` & `getDiscrepancyLabel(type?: string)`: Safe helper functions returning color codes and Spanish text descriptions.

---

### 4. `src/components/shared/SpatialMapPreview.tsx` & `src/components/shared/SpatialMapPreview.module.css`
**Topic**: Reusable Interactive Leaflet Map Preview Component & Legend Overlay

- **Purpose**: Reusable interactive Leaflet map preview with dynamic basemap switcher, color-coded vector layer rendering, legend overlay, auto-fitting bounds, and overflow-protected popups with close buttons.
- **Key Features**:
  - **Basemap Switcher**: Select between 4 map styles (Streets Voyager, OpenStreetMap, Satellite, Dark Mode).
  - **Map Legend Overlay**: Floating glassmorphism legend indicating discrepancy color keys present in the layer.
  - **Popup Overflows & Close Button**: Truncates 200+ hex `geom` strings, limits popup width (`maxWidth: 310px`), adds word wrapping, and displays a prominent **'X'** close button.
  - **Zero Inline Styles**: Styled strictly using CSS module classes and `data-color-type` attributes.

---

### 5. `src/hooks/useDiscrepancyGeojson.ts`
**Topic**: Spatial Discrepancy GeoJSON Extraction Hook

- **Purpose**: Custom React hook encapsulating spatial discrepancy GeoJSON feature collection creation matching the currently selected KPI filter card (`activeFilter`).
- **Logic**:
  - Indexes spatial geometries by SUID.
  - Filters discrepancy items by `activeFilter`.
  - Attaches `_discrepancyType`, `_discrepancyNote`, and `_differencesCount` properties to each GeoJSON feature for map rendering.

---

### 6. `src/components/tools/db-shapefile-sync/ResultsControlsBar.tsx` & `src/components/tools/db-shapefile-sync/ResultsControlsBar.module.css`
**Topic**: View Mode Tabs & Search Controls Sub-Component

- **Purpose**: Atomic sub-component rendering view mode switcher tabs (`Tabla de Discrepancias`, `Mapa de Discrepancias Espaciales`, `Script SQL PostGIS`) and table search input.

---

### 7. `src/components/tools/db-shapefile-sync/Step4ResultsView.tsx`
**Topic**: Step 4 Results View Modular Orchestrator Component

- **Purpose**: Lean orchestrator component connecting KPI summary cards, `ResultsControlsBar`, `DiscrepanciesTable`, `SpatialMapPreview`, and `SqlPatchDrawer`.

---

### 8. Uploaders Integration (`src/components/tools/db-csv-sync/CsvUploader.tsx` & `src/components/tools/db-shapefile-sync/ShapefileUploader.tsx`)
**Topic**: Dynamic Map Preview Integration in Upload Steps

- **Purpose**: Dynamically imports `<SpatialMapPreview />` with `{ ssr: false }` to render vector map previews in Step 2 when spatial features are detected in CSV or Shapefile layers.

---

## 🧪 Verification & Audit Status

- **Linting (`npm run lint`)**: 0 errors.
- **Production Build (`npm run build`)**: Next.js 16 (Turbopack) production build completed in 1.7s.
- **React Doctor Audit (`npm run doctor`)**: **Score: 100 / 100 Great (`✔ No issues found!`)**.
