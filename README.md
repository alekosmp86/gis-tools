# 🌍 GIS Tools — Spatial & Database Audit & Synchronization Platform

**GIS Tools** is a high-performance, modular web application platform built for auditing, correlating, analyzing discrepancies, visualizing spatial data, and synchronizing alphanumeric and geographic records between **PostgreSQL/PostGIS databases** and external data sources (Shapefiles `.zip`, GeoJSON `.geojson`, `.csv` tabular files, and database-to-database replicas).

---

## 🚀 Available Tools

1. 🔄 **DB vs. Shapefile Data Synchronization** (`/tools/db-shapefile-sync`)
   - Cross-correlates PostgreSQL/PostGIS tables against Shapefiles (`.zip` containing `.shp` & `.dbf`) and GeoJSON (`.geojson`) layers.
   - Flexible Shared Unique Identifier (SUID) selection, supporting single or multi-column composite keys (e.g., `dept` + `parcel_id`).
   - Automated generation of PostGIS update (`UPDATE`) and insertion (`INSERT`) SQL scripts with `NOT NULL` default handling.

2. 📊 **DB vs. CSV Data Synchronization** (`/tools/db-csv-sync`)
   - Correlates PostGIS records against CSV files with automatic detection of spatial geometries.
   - Automatic decoding of EWKB Hex geometries, WKT strings, and Latitude/Longitude coordinate columns.
   - Generates PostGIS SQL patch scripts.

3. 🗄️ **DB vs. DB Data Synchronization (Replicas)** (`/tools/db-db-sync`)
   - Direct database-to-database comparison between primary and replica PostgreSQL databases without requiring external file exports.
   - Performs $O(N)$ attribute and SUID correlation across live connections.

4. 🗺️ **Spatial File Viewer** (`/tools/file-viewer`)
   - Instant in-memory inspection of Shapefile, GeoJSON, and CSV files.
   - Interactive 60fps Leaflet map with bidirectional selection highlighting between the map and attribute table.

5. 🔍 **PostGIS / PostgreSQL Table Viewer** (`/tools/db-table-viewer`)
   - Direct inspection of PostgreSQL/PostGIS database tables.
   - Full spatial map preview with real-time vector streaming, attribute filtering, and high-performance pagination.

---

## 🛠️ Main Tech Stack

- **Framework**: Next.js 16 (App Router, Turbopack) & React 19
- **State & Caching**: TanStack React Query v5
- **Styling**: Vanilla CSS Modules (Glassmorphism design system, zero inline styles)
- **Map & Spatial Rendering**: Leaflet with HTML5 Canvas Renderer (`L.canvas`) for 60fps vector rendering
- **Multithreading**: Dedicated Web Workers for in-memory $O(1)$ indexed background processing
- **Icons**: Lucide React SVG Icons exclusively

---

## 📁 Project Structure

```
src/
├── app/                     # App Router pages and API routes (/api/db/...)
├── components/
│   ├── home/                # Hero, FilterTabs, ToolCard
│   ├── layout/              # Header, Footer
│   ├── shared/              # DbConnectionForm, ProfileSelect, StepIndicator, MapStylePopover
│   ├── ui/                  # Atomic UI components (Button, Badge, SearchInput)
│   └── tools/
│       ├── db-sync-common/  # Shared wizard steps (SUID mapping, results, SQL patch drawer)
│       ├── db-shapefile-sync/# Shapefile uploader and geometry controls
│       ├── db-csv-sync/     # CSV uploader and header inspection
│       ├── db-db-sync/      # DB vs DB connection forms
│       ├── db-table-viewer/ # PostGIS table inspector
│       └── file-viewer/     # Spatial file viewer container
├── constants/               # Map tile presets, default styles, and swatches
├── data/                    # Tool catalog data and sample profiles
├── hooks/                   # Custom React hooks (useDbConnectionForm, useLeafletMap, etc.)
│   └── map/                 # Sub-hooks (useMapInstance, useBasemapTileLayer, useVectorChunkStream, etc.)
├── services/                # Parsers (ShapefileParser, CsvParser) and comparison engines
├── types/                   # Isolated domain models and schemas (db.ts, comparison.ts, etc.)
├── utils/                   # EWKB/WKT geometry parsers, GIS cleaners, formatters
└── workers/                 # Web Workers for async background comparison & chunking
```

---

## 🏗️ Architecture Highlights

### Decoupled Sub-Hook Map Architecture
The Leaflet map integration is organized into 5 single-responsibility sub-hooks composed by a facade hook (`useLeafletMap`):
- `useMapInstance`: Map container mounting and `L.canvas` setup.
- `useBasemapTileLayer`: Tile layer switching (OSM, Satellite, Dark).
- `useVectorChunkStream`: Web Worker GeoJSON chunk streaming & micro-batch state.
- `useFeatureHighlight`: Target feature highlight styling and smooth camera panning.
- `useLayerSymbology`: Live 60fps dynamic symbology updates.

### Dynamic Layer Symbology Popover
Users can customize map feature styling on the fly:
- **Color Swatches & Picker**: Custom stroke and fill colors.
- **Stroke Width**: 1px to 10px range slider.
- **Opacity Controls**: Separate stroke and fill opacity (0.0 to 1.0).
- **Point Radius**: 4px to 18px range slider.
- **Line Patterns**: Solid, Dashed, and Dotted stroke patterns.

---

## 📚 Documentation Directory

Detailed technical documentation is maintained inside the [`docs/`](file:///c:/Alekos/Projects/gis-tools/docs/README.md) directory:

- 🏗️ [**Architecture & System Overview**](file:///c:/Alekos/Projects/gis-tools/docs/architecture/ARCHITECTURE.md)
- 📊 [**Progress & Architecture Records**](file:///c:/Alekos/Projects/gis-tools/docs/architecture/ARCHITECTURE_AND_PROGRESS.md)
- 💾 [**PostGIS Direct SQL Batch Execution**](file:///c:/Alekos/Projects/gis-tools/docs/database/POSTGIS_DIRECT_SQL_EXECUTION.md)
- 🗺️ [**Map Canvas Optimization & Sub-Hooks**](file:///c:/Alekos/Projects/gis-tools/docs/map/MAP_CANVAS_RENDERER_OPTIMIZATION.md)
- 🔍 [**Spatial File Viewer Guide**](file:///c:/Alekos/Projects/gis-tools/docs/tools/FILE_VIEWER_TOOL.md)
- 🗄️ [**DB vs DB Sync Guide**](file:///c:/Alekos/Projects/gis-tools/docs/tools/DB_DB_SYNC_TOOL.md)
- 📊 [**PostGIS Table Viewer Guide**](file:///c:/Alekos/Projects/gis-tools/docs/tools/POSTGIS_TABLE_VIEWER_TOOL.md)

---

## ⚙️ Local Development

```bash
# Start Next.js development server
npm run dev

# Run React Doctor compliance audit
npm run doctor

# Execute ESLint validation
npm run lint

# Build production bundle
npm run build
```
