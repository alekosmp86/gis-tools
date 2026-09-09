# Documentation Index — GIS Tools Platform

Welcome to the **GIS Tools** technical documentation directory. All documentation files are organized into subdirectories by topic:

---

## 🗄️ Documentation Sections & Topics

### 🏗️ 1. Architecture & Code Standards (`docs/architecture/`)
- [`ARCHITECTURE.md`](docs/architecture/ARCHITECTURE.md) — Comprehensive technical architecture guide, multi-threading with Web Workers, Strategy pattern, composite SUID keys, and database introspection.
- [`MODULAR_MONOLITH_AND_MODULES.md`](docs/architecture/MODULAR_MONOLITH_AND_MODULES.md) — Modular monolith layer split (`core/`, `ui-kit/`, `modules/`), the import invariant enforced in ESLint, module contracts and registry, UI extension slots with per-contribution error isolation, and the JSON-declared endpoint generation pipeline (`src/app/api/m/**`). Includes the reference module (`src/modules/cartography-watcher`) and the add/delete/restore acceptance test that proved the deletion property. Authoring recipe: [`.agents/rules/module_authoring.md`](.agents/rules/module_authoring.md).
- [`MODULAR_UTILS_AND_OOP_ARCHITECTURE.md`](docs/architecture/MODULAR_UTILS_AND_OOP_ARCHITECTURE.md) — Modular organization of `src/utils/` (`binary/`, `spatial/`, `map/`, `common/`), coordinate reprojection pipeline, and OOP domain service architecture.
- [`BINARY_SHAPEFILE_1M_OPTIMIZATION.md`](docs/architecture/BINARY_SHAPEFILE_1M_OPTIMIZATION.md) — Deep-dive guide on 1M+ Shapefile memory optimization, low-level binary readers (`BinaryDbfReader`, `BinaryShpReader`), string interning pool, atomic exact-match indexing, and 50k map preview sampling.
- [`ARCHITECTURE_AND_PROGRESS.md`](docs/architecture/ARCHITECTURE_AND_PROGRESS.md) — Development progress log, architectural decisions, and solved engineering challenges.
- [`CODEBASE_STANDARDS_AND_UI_GUARDS.md`](docs/architecture/CODEBASE_STANDARDS_AND_UI_GUARDS.md) — Workspace coding standards, prop interface co-location rules, zero inline styles policy, Lucide icons usage, and single-letter variable removal.
- [`WIZARD_ORCHESTRATOR_ARCHITECTURE.md`](docs/architecture/WIZARD_ORCHESTRATOR_ARCHITECTURE.md) — Decoupled 4-step wizard orchestrator, glassmorphism master card, and automatic smooth scroll implementation.
- [`dependency-graph.html`](docs/architecture/dependency-graph.html) — Interactive Next.js dependency graph application with draggable physics nodes, neighborhood highlighting, and layer filters.

### 💾 2. Database (`docs/database/`)
- [`POSTGIS_DIRECT_SQL_EXECUTION.md`](docs/database/POSTGIS_DIRECT_SQL_EXECUTION.md) — Direct PostGIS SQL patch execution modal, chunked statement batching (500 per batch), and transaction safety (`BEGIN; ... COMMIT;`).
- [`POSTGRESQL_COLUMN_TYPES_AND_QUOTING.md`](docs/database/POSTGRESQL_COLUMN_TYPES_AND_QUOTING.md) — Database column introspection (`information_schema.columns`) and strict data type quoting rules for PostgreSQL SQL generation.

### 🗺️ 3. Map & Visualization (`docs/map/`)
- [`MAP_CANVAS_RENDERER_OPTIMIZATION.md`](docs/map/MAP_CANVAS_RENDERER_OPTIMIZATION.md) — Decoupled 5 sub-hook map architecture (`useMapInstance`, `useBasemapTileLayer`, `useVectorChunkStream`, `useFeatureHighlight`, `useLayerSymbology`), HTML5 Canvas renderer (`L.canvas`) for 60fps rendering, and dynamic symbology popover panel (`MapStylePopover`).
- [`WALKTHROUGH_CSV_EWKB_MAP.md`](docs/map/WALKTHROUGH_CSV_EWKB_MAP.md) — Decoding EWKB Hex geometries and WKT strings for CSV map visualization.

### 🛠️ 4. Tools (`docs/tools/`)
- [`DB_SHAPEFILE_SYNC_TOOL.md`](docs/tools/DB_SHAPEFILE_SYNC_TOOL.md) — PostgreSQL/PostGIS DB vs. Shapefile sync tool with zero-allocation 1M+ memory optimization.
- [`DB_CSV_SYNC_TOOL.md`](docs/tools/DB_CSV_SYNC_TOOL.md) — PostgreSQL/PostGIS DB vs. CSV sync tool with EWKB Hex/WKT/LatLng spatial parsing and capped Step 2 preview.
- [`DB_DB_SYNC_TOOL.md`](docs/tools/DB_DB_SYNC_TOOL.md) — PostgreSQL DB vs. DB replica synchronization tool architecture and workflows.
- [`FILE_VIEWER_TOOL.md`](docs/tools/FILE_VIEWER_TOOL.md) — Spatial File Viewer architecture, bidirectional map-table selection, and attribute table pagination.
- [`CARTOGRAPHY_WATCHER_MODULE.md`](docs/tools/CARTOGRAPHY_WATCHER_MODULE.md) — Observador de Actualizaciones Cartográficas as an extension module: CKAN delta detection (checksum, publication date, size), the server-side vault with read-through caching, the catalogue tab inside the DB-CSV and DB-Shapefile uploaders, and its own generated page at `/tools/m/cartography-watcher`.
- [`POSTGIS_TABLE_VIEWER_TOOL.md`](docs/tools/POSTGIS_TABLE_VIEWER_TOOL.md) — PostGIS / PostgreSQL Table Viewer tool, direct table introspection, and vector map preview.

### 📋 5. Specifications (`docs/specifications/`)
- [`REQUERIMIENTOS_Y_ESPECIFICACION.md`](docs/specifications/REQUERIMIENTOS_Y_ESPECIFICACION.md) — System requirements and specifications.
- [`TASKS.md`](docs/specifications/TASKS.md) — Development task tracking and checklist.

### 🐛 6. Issues & Troubleshooting Log (`docs/issues/`)
- [`ISSUE_001_SHAPEFILE_PROJECTED_COORDINATES_MAP_BLANK.md`](docs/issues/ISSUE_001_SHAPEFILE_PROJECTED_COORDINATES_MAP_BLANK.md) — Projected coordinates (UTM/EPSG) resulting in blank/world map preview due to missing WGS84 reprojection.
- [`ISSUE_002_SQL_DRAWER_LARGE_DATASET_OOM_FREEZE.md`](docs/issues/ISSUE_002_SQL_DRAWER_LARGE_DATASET_OOM_FREEZE.md) — Main UI thread freeze and memory spikes on SQL Scripts tab when processing large spatial datasets.
- [`ISSUE_003_COMPOSITE_SUID_PARTIAL_NULL_MISCLASSIFICATION.md`](docs/issues/ISSUE_003_COMPOSITE_SUID_PARTIAL_NULL_MISCLASSIFICATION.md) — Composite SUID records with partial null sub-fields misclassified as null/vacant records.
- [`ISSUE_004_HIDDEN_MAP_TAB_CANVAS_RENDERING_DESYNC.md`](docs/issues/ISSUE_004_HIDDEN_MAP_TAB_CANVAS_RENDERING_DESYNC.md) — Leaflet Canvas rendering and viewport desynchronization when filtering KPI cards while the map tab is hidden in the DOM.
- [`ISSUE_005_POSTGIS_LARGE_DATASET_QUERY_PROGRESS_FREEZE.md`](docs/issues/ISSUE_005_POSTGIS_LARGE_DATASET_QUERY_PROGRESS_FREEZE.md) — PostGIS large dataset query freezing without progress feedback and monolithic memory overhead.
- [`ISSUE_006_UNMAPPED_GEOMETRY_COLUMN_AUTO_INJECTION_IN_INSERT.md`](docs/issues/ISSUE_006_UNMAPPED_GEOMETRY_COLUMN_AUTO_INJECTION_IN_INSERT.md) — Unmapped PostGIS geometry column auto-injection in INSERT statements for tabular datasets.
- [`ISSUE_007_POLYMORPHIC_COMPARISON_SOURCE_DESCRIPTOR.md`](docs/issues/ISSUE_007_POLYMORPHIC_COMPARISON_SOURCE_DESCRIPTOR.md) — Polymorphic comparison source descriptor architecture for extensible multi-source dataset labeling.
- [`ISSUE_008_CODEBASE_SOLID_DEAD_CODE_PERFORMANCE_AUDIT.md`](docs/issues/ISSUE_008_CODEBASE_SOLID_DEAD_CODE_PERFORMANCE_AUDIT.md) — Codebase quality audit, dead code elimination, SOLID principle adherence, zero-allocation hot paths, and performance optimizations.
- [`ISSUE_009_CSV_GEOMETRY_COMPARISON.md`](docs/issues/ISSUE_009_CSV_GEOMETRY_COMPARISON.md) — Spatial geometry comparison (EWKB/WKT raw binaries) for DB vs. CSV synchronization.
- [`ISSUE_010_SHAPEFILE_GEOMETRY_MISMATCH_SQL_UPDATE_PATCH.md`](docs/issues/ISSUE_010_SHAPEFILE_GEOMETRY_MISMATCH_SQL_UPDATE_PATCH.md) — Shapefile geometry synchronization, high-fidelity vertex preservation, zero-copy native streaming, and PostGIS UPDATE generation.
- [`ISSUE_011_TABLE_VIEWER_SPATIAL_DETECTION_AND_ATTRIBUTES.md`](docs/issues/ISSUE_011_TABLE_VIEWER_SPATIAL_DETECTION_AND_ATTRIBUTES.md) — PostGIS Table Viewer spatial geometry recognition, all-null attribute values fix, and dynamic EWKB SRID reprojection.
- [`ISSUE_012_SQL_PATCH_SUID_GROUPING_AND_ONLY_IN_DB_NULL_FIX.md`](docs/issues/ISSUE_012_SQL_PATCH_SUID_GROUPING_AND_ONLY_IN_DB_NULL_FIX.md) — SQL patch single UPDATE per SUID grouping, elimination of destructive NULL updates on ONLY_IN_DB items, and CSV delimiter/BOM parsing robustness.
- [`ISSUE_013_KPI_CARD_DISCREPANCY_TABLE_FILTER_DESYNC.md`](docs/issues/ISSUE_013_KPI_CARD_DISCREPANCY_TABLE_FILTER_DESYNC.md) — KPI cards and discrepancy table filter desynchronization fix, eliminating false attribute mismatches with null file values.
- [`ISSUE_014_PRIMARY_KEY_UPDATE_OPTIMIZATION.md`](docs/issues/ISSUE_014_PRIMARY_KEY_UPDATE_OPTIMIZATION.md) — PostGIS SQL UPDATE WHERE clause optimization via auto-detected primary keys, eliminating sequential scans in 1M+ row tables.
- [`ISSUE_015_LAZY_SQL_GENERATION_AND_IMMEDIATE_EXECUTION_MODAL.md`](docs/issues/ISSUE_015_LAZY_SQL_GENERATION_AND_IMMEDIATE_EXECUTION_MODAL.md) — Lazy preview-only SQL generation on step 4 transition, immediate modal opening on "Ejecutar en BD", and chunked generation/execution upon confirmation.
- [`ISSUE_016_CSV_GEOMETRY_UPDATE_PATCH_GENERATION.md`](docs/issues/ISSUE_016_CSV_GEOMETRY_UPDATE_PATCH_GENERATION.md) — SQL UPDATE patch generation for geometry discrepancies in CSV and tabular datasets by lifting Shapefile-only binary DBF constraints.
- [`ISSUE_017_CSV_STEP2_PREVIEW_MAP_FEATURE_CAP.md`](docs/issues/ISSUE_017_CSV_STEP2_PREVIEW_MAP_FEATURE_CAP.md) — Capping features in DB-CSV Step 2 preview map via unified `MAX_MAP_PREVIEW_FEATURES` while preserving full uncapped features in Step 4.
- [`ISSUE_018_CIRCULAR_DEPENDENCY_AND_LAYER_SEPARATION_AUDIT.md`](docs/issues/ISSUE_018_CIRCULAR_DEPENDENCY_AND_LAYER_SEPARATION_AUDIT.md) — Elimination of circular dependency between domain types and worker services, layer separation audit, and permanent dependency graph integration.
- [`ISSUE_019_EXPORT_ENCODING_GLITCH_TOLERANCE.md`](docs/issues/ISSUE_019_EXPORT_ENCODING_GLITCH_TOLERANCE.md) — Character encoding glitch and mojibake tolerance for GIS/DBF exports (letter 'Ñ' corruptions), preserving strict case and punctuation sensitivity.
- [`ISSUE_020_WIZARD_STEP4_SYNC_PARAMETERS_DECOUPLING.md`](docs/issues/ISSUE_020_WIZARD_STEP4_SYNC_PARAMETERS_DECOUPLING.md) — Decoupling SUID mapping from SQL sync parameters into a dedicated 5-step wizard and renaming Step4ResultsView to ComparisonResultsView.
- [`ISSUE_021_DB_TABLE_VIEWER_STALE_GEOJSON_FLOW.md`](docs/issues/ISSUE_021_DB_TABLE_VIEWER_STALE_GEOJSON_FLOW.md) — DB Table Viewer repeated PostgreSQL streaming caused by an unstable TanStack Query mutation object in the effect dependencies, plus removal of unnecessary derived-state mirroring under React Compiler.
- [`ISSUE_022_PREVIEW_MAP_RENDER_PATH_ALLOCATION_COST.md`](docs/issues/ISSUE_022_PREVIEW_MAP_RENDER_PATH_ALLOCATION_COST.md) — Preview map render path copying the dataset through a worker that only sliced arrays, plus per-feature service allocation and click listeners, replaced by reference slicing, shared instances, delegated events and frame-paced chunks.
- [`ISSUE_023_SELECTION_INDEX_DIVERGENCE_TABLE_VS_MAP.md`](docs/issues/ISSUE_023_SELECTION_INDEX_DIVERGENCE_TABLE_VS_MAP.md) — Attribute table and preview map sharing one selection index while indexing different arrays, corrected by stamping the record index on every feature and translating at the map boundary.
- [`ISSUE_024_AUTOMATED_TESTING_SUITE_AND_INFRASTRUCTURE.md`](docs/issues/ISSUE_024_AUTOMATED_TESTING_SUITE_AND_INFRASTRUCTURE.md) — Automated testing infrastructure (Vitest + Playwright), non-UI services, spatial math and parsers test suite, and strict specification compliance.
- [`ISSUE_025_REACT_QUERY_SSR_HYDRATION_MISMATCH.md`](docs/issues/ISSUE_025_REACT_QUERY_SSR_HYDRATION_MISMATCH.md) — React Query SSR hydration mismatch on module refresh buttons caused by the optimistic `isFetching` result differing between server and client renders, fixed by a shared hydration-safe busy flag derived from `isPending || isFetching`.
- [`ISSUE_026_CATALOG_TREE_GROUP_COLLAPSE_UNDER_FLEX_SHRINK.md`](docs/issues/ISSUE_026_CATALOG_TREE_GROUP_COLLAPSE_UNDER_FLEX_SHRINK.md) — Catalogue tree groups squashing and clipping each other instead of scrolling, because `overflow: hidden` zeroes a flex item's automatic minimum size inside a capped-height column, fixed by pinning `flex-shrink: 0`.


