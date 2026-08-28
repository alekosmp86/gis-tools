# Documentation Index — GIS Tools Platform

Welcome to the **GIS Tools** technical documentation directory. All documentation files are organized into subdirectories by topic:

---

## 🗄️ Documentation Sections & Topics

### 🏗️ 1. Architecture & Code Standards (`docs/architecture/`)
- [`ARCHITECTURE.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/ARCHITECTURE.md) — Comprehensive technical architecture guide, multi-threading with Web Workers, Strategy pattern, composite SUID keys, and database introspection.
- [`ARCHITECTURE_AND_PROGRESS.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/ARCHITECTURE_AND_PROGRESS.md) — Development progress log, architectural decisions, and solved engineering challenges.
- [`CODEBASE_STANDARDS_AND_UI_GUARDS.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/CODEBASE_STANDARDS_AND_UI_GUARDS.md) — Workspace coding standards, prop interface co-location rules, zero inline styles policy, Lucide icons usage, and single-letter variable removal.
- [`WIZARD_ORCHESTRATOR_ARCHITECTURE.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/WIZARD_ORCHESTRATOR_ARCHITECTURE.md) — Decoupled 4-step wizard orchestrator, glassmorphism master card, and automatic smooth scroll implementation.

### 💾 2. Database (`docs/database/`)
- [`POSTGIS_DIRECT_SQL_EXECUTION.md`](file:///c:/Alekos/Projects/gis-tools/docs/database/POSTGIS_DIRECT_SQL_EXECUTION.md) — Direct PostGIS SQL patch execution modal, chunked statement batching (500 per batch), and transaction safety (`BEGIN; ... COMMIT;`).
- [`POSTGRESQL_COLUMN_TYPES_AND_QUOTING.md`](file:///c:/Alekos/Projects/gis-tools/docs/database/POSTGRESQL_COLUMN_TYPES_AND_QUOTING.md) — Database column introspection (`information_schema.columns`) and strict data type quoting rules for PostgreSQL SQL generation.

### 🗺️ 3. Map & Visualization (`docs/map/`)
- [`MAP_CANVAS_RENDERER_OPTIMIZATION.md`](file:///c:/Alekos/Projects/gis-tools/docs/map/MAP_CANVAS_RENDERER_OPTIMIZATION.md) — Decoupled 5 sub-hook map architecture (`useMapInstance`, `useBasemapTileLayer`, `useVectorChunkStream`, `useFeatureHighlight`, `useLayerSymbology`), HTML5 Canvas renderer (`L.canvas`) for 60fps rendering, and dynamic symbology popover panel (`MapStylePopover`).
- [`WALKTHROUGH_CSV_EWKB_MAP.md`](file:///c:/Alekos/Projects/gis-tools/docs/map/WALKTHROUGH_CSV_EWKB_MAP.md) — Decoding EWKB Hex geometries and WKT strings for CSV map visualization.

### 🛠️ 4. Tools (`docs/tools/`)
- [`FILE_VIEWER_TOOL.md`](file:///c:/Alekos/Projects/gis-tools/docs/tools/FILE_VIEWER_TOOL.md) — Spatial File Viewer architecture, bidirectional map-table selection, and attribute table pagination.
- [`DB_DB_SYNC_TOOL.md`](file:///c:/Alekos/Projects/gis-tools/docs/tools/DB_DB_SYNC_TOOL.md) — PostgreSQL DB vs. DB replica synchronization tool architecture and workflows.
- [`POSTGIS_TABLE_VIEWER_TOOL.md`](file:///c:/Alekos/Projects/gis-tools/docs/tools/POSTGIS_TABLE_VIEWER_TOOL.md) — PostGIS / PostgreSQL Table Viewer tool, direct table introspection, and vector map preview.

### 📋 5. Specifications (`docs/specifications/`)
- [`REQUERIMIENTOS_Y_ESPECIFICACION.md`](file:///c:/Alekos/Projects/gis-tools/docs/specifications/REQUERIMIENTOS_Y_ESPECIFICACION.md) — System requirements and specifications.
- [`TASKS.md`](file:///c:/Alekos/Projects/gis-tools/docs/specifications/TASKS.md) — Development task tracking and checklist.
