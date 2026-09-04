# PostGIS / PostgreSQL Table Viewer Tool

> **Location**: `src/app/tools/db-table-viewer/`  
> **Route**: `/tools/db-table-viewer`  
> **Status**: Implemented & Production Active

---

## 1. Overview

The **PostGIS / PostgreSQL Table Viewer** provides direct, interactive inspection of PostgreSQL and PostGIS database tables.

It allows database administrators and GIS analysts to inspect live PostGIS tables, search attribute values, view geometry bounds on an interactive map preview, and customize layer styling.

---

## 2. Core Features

1. **Live Database Table Introspection**
   - Connects to any PostgreSQL/PostGIS database table via Host, Port, Database, User, Password, Schema, and Table parameters.
   - Fetches column metadata and record counts via `/api/db/columns` and `/api/db/records`.

2. **Interactive Spatial Map Preview**
   - Renders PostGIS EWKB Hex geometry columns on a 60fps Leaflet canvas map (`L.canvas`).
   - Supports real-time feature highlight and smooth camera panning (`flyTo`).

3. **Dynamic Layer Symbology Popover**
   - Interactive popover panel ([`MapStylePopover.tsx`](src/components/shared/map/MapStylePopover.tsx)) allowing live updates to stroke/fill colors, stroke weight (1-10px), opacity, point radius, and line dash patterns (`SOLID`, `DASHED`, `DOTTED`).

4. **Paginated Attribute Table**
   - High-performance attribute table with global search text filtering and custom page size options (50, 100, 250, 500 rows per page).
