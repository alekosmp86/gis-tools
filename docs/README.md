# Documentation Index — GIS Tools Platform

Welcome to the **GIS Tools** technical documentation directory. All documentation files are organized into subdirectories by topic:

---

## 🗄️ Documentation Sections & Topics

### 🏗️ 1. Architecture & Code Standards (`docs/architecture/`)
- [`ARCHITECTURE.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/ARCHITECTURE.md) — Comprehensive technical architecture guide, multi-threading with Web Workers, Strategy pattern, composite SUID keys, and database introspection.
- [`MODULAR_UTILS_AND_OOP_ARCHITECTURE.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/MODULAR_UTILS_AND_OOP_ARCHITECTURE.md) — Modular organization of `src/utils/` (`binary/`, `spatial/`, `map/`, `common/`), coordinate reprojection pipeline, and OOP domain service architecture.
- [`BINARY_SHAPEFILE_1M_OPTIMIZATION.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/BINARY_SHAPEFILE_1M_OPTIMIZATION.md) — Deep-dive guide on 1M+ Shapefile memory optimization, low-level binary readers (`BinaryDbfReader`, `BinaryShpReader`), string interning pool, atomic exact-match indexing, and 50k map preview sampling.
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

### 🐛 6. Issues & Troubleshooting Log (`docs/issues/`)
- [`ISSUE_001_SHAPEFILE_PROJECTED_COORDINATES_MAP_BLANK.md`](file:///c:/Alekos/Projects/gis-tools/docs/issues/ISSUE_001_SHAPEFILE_PROJECTED_COORDINATES_MAP_BLANK.md) — Projected coordinates (UTM/EPSG) resulting in blank/world map preview due to missing WGS84 reprojection.
- [`ISSUE_002_SQL_DRAWER_LARGE_DATASET_OOM_FREEZE.md`](file:///c:/Alekos/Projects/gis-tools/docs/issues/ISSUE_002_SQL_DRAWER_LARGE_DATASET_OOM_FREEZE.md) — Main UI thread freeze and memory spikes on SQL Scripts tab when processing large spatial datasets.
- [`ISSUE_003_COMPOSITE_SUID_PARTIAL_NULL_MISCLASSIFICATION.md`](file:///c:/Alekos/Projects/gis-tools/docs/issues/ISSUE_003_COMPOSITE_SUID_PARTIAL_NULL_MISCLASSIFICATION.md) — Composite SUID records with partial null sub-fields misclassified as null/vacant records.
- [`ISSUE_004_HIDDEN_MAP_TAB_CANVAS_RENDERING_DESYNC.md`](file:///c:/Alekos/Projects/gis-tools/docs/issues/ISSUE_004_HIDDEN_MAP_TAB_CANVAS_RENDERING_DESYNC.md) — Leaflet Canvas rendering and viewport desynchronization when filtering KPI cards while the map tab is hidden in the DOM.
- [`ISSUE_005_POSTGIS_LARGE_DATASET_QUERY_PROGRESS_FREEZE.md`](file:///c:/Alekos/Projects/gis-tools/docs/issues/ISSUE_005_POSTGIS_LARGE_DATASET_QUERY_PROGRESS_FREEZE.md) — PostGIS large dataset query freezing without progress feedback and monolithic memory overhead.
- [`ISSUE_006_UNMAPPED_GEOMETRY_COLUMN_AUTO_INJECTION_IN_INSERT.md`](file:///c:/Alekos/Projects/gis-tools/docs/issues/ISSUE_006_UNMAPPED_GEOMETRY_COLUMN_AUTO_INJECTION_IN_INSERT.md) — Unmapped PostGIS geometry column auto-injection in INSERT statements for tabular datasets.
- [`ISSUE_007_POLYMORPHIC_COMPARISON_SOURCE_DESCRIPTOR.md`](file:///c:/Alekos/Projects/gis-tools/docs/issues/ISSUE_007_POLYMORPHIC_COMPARISON_SOURCE_DESCRIPTOR.md) — Polymorphic comparison source descriptor architecture for extensible multi-source dataset labeling.
- [`ISSUE_008_CODEBASE_SOLID_DEAD_CODE_PERFORMANCE_AUDIT.md`](file:///c:/Alekos/Projects/gis-tools/docs/issues/ISSUE_008_CODEBASE_SOLID_DEAD_CODE_PERFORMANCE_AUDIT.md) — Codebase quality audit, dead code elimination, SOLID principle adherence, zero-allocation hot paths, and performance optimizations.
- [`ISSUE_009_CSV_GEOMETRY_COMPARISON.md`](file:///c:/Alekos/Projects/gis-tools/docs/issues/ISSUE_009_CSV_GEOMETRY_COMPARISON.md) — Spatial geometry comparison (EWKB/WKT raw binaries) for DB vs. CSV synchronization.


