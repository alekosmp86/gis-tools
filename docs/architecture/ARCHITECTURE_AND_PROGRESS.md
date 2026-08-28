# Progress Log & Architectural Decisions — GIS Tools

This document documents major milestone updates, architectural decisions, and progress logs for the **GIS Tools** platform.

---

## 📈 Platform Progress Summary

| Feature / Milestone | Status | Description |
| :--- | :---: | :--- |
| **DB vs. Shapefile Sync Tool** | ✅ Active | Full PostgreSQL/PostGIS correlation against Shapefile `.zip` and GeoJSON files. |
| **DB vs. CSV Sync Tool** | ✅ Active | PostGIS correlation against CSV files with EWKB Hex, WKT, and Lat/Lng parsing. |
| **DB vs. DB Sync Tool (Replicas)** | ✅ Active | Direct PostGIS DB 1 vs PostGIS DB 2 replica table correlation. |
| **Spatial File Viewer Tool** | ✅ Active | In-memory spatial file inspection with interactive Leaflet map preview. |
| **PostGIS Table Viewer Tool** | ✅ Active | Direct PostGIS table viewer with real-time vector streaming. |
| **Dynamic Symbology Popover** | ✅ Active | Live 60fps layer styling (colors, stroke weight, opacity, point radius, stroke patterns). |
| **Sub-Hook Map Architecture** | ✅ Active | Decoupled Leaflet integration into 5 single-responsibility hooks. |
| **Direct PostGIS SQL Execution** | ✅ Active | Transactional SQL batch execution modal (`BEGIN; ... COMMIT;`). |
| **Codebase Rules & Compliance** | ✅ Active | 100/100 React Doctor score, co-located props, zero inline styles, Lucide icons only. |

---

## 🏛️ Recent Architectural Decisions

### 1. Leaflet Map Sub-Hook Decomposition
- **Decision**: Split the monolithic `useLeafletMap` hook into 5 focused sub-hooks:
  - `useMapInstance`: Map lifecycle and container mounting.
  - `useBasemapTileLayer`: Tile layer switching.
  - `useVectorChunkStream`: Progressive Web Worker chunk streaming.
  - `useFeatureHighlight`: Target feature highlight overlay and camera panning.
  - `useLayerSymbology`: Live 60fps style updates.
- **Benefits**: Improved testability, strict single-responsibility compliance, and isolation of map re-renders.

### 2. Multi-Category Tool Tagging
- **Decision**: Updated `ToolCardData` to accept `category: ToolCategory[]` array instead of a single string.
- **Benefits**: Allows tools like DB vs. DB Sync to be listed under both `Base de Datos` (Database) and `Sincronización` (Sync) category filters.

### 3. Co-located Component Props & Clean Types
- **Decision**: Enforced co-location of component `*Props` interfaces directly inside their corresponding `.tsx` files and eliminated barrel re-export files (`src/types/gis.ts`).
- **Benefits**: Cleaner imports, zero cyclic dependencies, and better IDE navigation.
