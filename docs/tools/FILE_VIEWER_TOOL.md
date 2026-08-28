# Spatial File Viewer Tool

> **Location**: `src/components/tools/file-viewer/`  
> **Route**: `/tools/file-viewer`  
> **Status**: Implemented & Production Active

---

## 1. Overview

The **Spatial File Viewer** is a single-view tool (no multi-step wizard) allowing users to load vector or alphanumeric spatial files and instantly inspect:
1. **Geographic Features**: Displayed on an interactive 60fps Leaflet map.
2. **File Metadata**: File size, geometry type, total record count, and DBF/CSV attribute column tags.
3. **Attribute Table**: Complete attribute table with search filtering, record pagination, and bidirectional map-table selection highlighting.

---

## 2. Tool Components (`src/components/tools/file-viewer/`)

All tool components reside inside `src/components/tools/file-viewer/`:

- **`FileViewerContainer.tsx` + `.module.css`**: Master orchestrator component coordinating the uploader, spatial map view, metadata panel, and attribute table. Dynamically imports `SpatialMapPreview` with `{ ssr: false }`.
- **`FileViewerUploader.tsx` + `.module.css`**: Drag & drop file uploader supporting `.zip` (Shapefile), `.geojson`, `.json`, `.csv`, and `.txt`.
- **`FileMetaPanel.tsx` + `.module.css`**: Metadata summary cards display.
- **`AttributeTable.tsx` + `.module.css`**: Interactive paginated attribute table with global search text filtering and row selection synchronization.

---

## 3. Supported Formats & Geometry Parsers

- **Shapefiles (`.zip`)**: Automatic unzipping and parsing of `.shp`, `.dbf`, `.shx`, and `.prj` files in memory.
- **GeoJSON (`.geojson`, `.json`)**: Native GeoJSON parsing.
- **CSV & Text (`.csv`, `.txt`)**: EWKB Hex geometry decoding, WKT string parsing (`POINT`, `LINESTRING`, `POLYGON`, `MULTIPOLYGON`), and Lat/Lng coordinate column auto-detection.

---

## 4. Reused Infrastructure

| Component / Service | Source Path | Reused Function |
|---|---|---|
| `ShapefileParser` | `src/services/parsers/ShapefileParser.ts` | In-memory `.zip` and `.geojson` parsing |
| `CsvParser` | `src/services/parsers/CsvParser.ts` | CSV parsing and EWKB/WKT/LatLng coordinate extraction |
| `SpatialMapPreview` | `src/components/shared/SpatialMapPreview.tsx` | Canvas-optimized Leaflet map view with `MapStylePopover` |
| `PaginationControls` | `src/components/shared/PaginationControls.tsx` | Attribute table pagination |
| `AlertMessage` | `src/components/shared/AlertMessage.tsx` | Error and alert banners |
| `Button` | `src/components/ui/Button.tsx` | UI button components |
