# Documentation Index — GIS Tools

Welcome to the project documentation directory. All documentation files are organized into subdirectories by topic:

---

## 🗄️ Subdirectories & Topics

### 💾 1. Database (`docs/database/`)
- [`POSTGIS_DIRECT_SQL_EXECUTION.md`](file:///c:/Alekos/Projects/gis-tools/docs/database/POSTGIS_DIRECT_SQL_EXECUTION.md) — Direct PostGIS SQL patch execution, transaction safety (`BEGIN; ... COMMIT;`), and password authentication modal.
- [`POSTGRESQL_COLUMN_TYPES_AND_QUOTING.md`](file:///c:/Alekos/Projects/gis-tools/docs/database/POSTGRESQL_COLUMN_TYPES_AND_QUOTING.md) — Introspection of `information_schema.columns` and strict single-quoting fixes for `character varying` / text columns.

### 🗺️ 2. Map (`docs/map/`)
- [`MAP_CANVAS_RENDERER_OPTIMIZATION.md`](file:///c:/Alekos/Projects/gis-tools/docs/map/MAP_CANVAS_RENDERER_OPTIMIZATION.md) — Shared Leaflet HTML5 Canvas renderer (`L.canvas`) optimization for 60fps pan/zoom with large feature counts, plus scaling roadmap (VectorGrid / MapLibre GL JS).
- [`WALKTHROUGH_CSV_EWKB_MAP.md`](file:///c:/Alekos/Projects/gis-tools/docs/map/WALKTHROUGH_CSV_EWKB_MAP.md) — Walkthrough of CSV EWKB geometry parsing and map visualization feature.

### 🏗️ 3. Architecture & Standards (`docs/architecture/`)
- [`CODEBASE_STANDARDS_AND_UI_GUARDS.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/CODEBASE_STANDARDS_AND_UI_GUARDS.md) — Const object enums (`SqlScriptType`, `AlertType`), script re-execution guards, empty script regex detection, and disabled button CSS.
- [`ARCHITECTURE.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/ARCHITECTURE.md) — High-level system architecture and component structure.
- [`ARCHITECTURE_AND_PROGRESS.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/ARCHITECTURE_AND_PROGRESS.md) — Architectural patterns and progress log.
- [`ARQUITECTURA_HERRAMIENTA_SIG.md`](file:///c:/Alekos/Projects/gis-tools/docs/architecture/ARQUITECTURA_HERRAMIENTA_SIG.md) — Architectural overview in Spanish.

### 📋 4. Specifications (`docs/specifications/`)
- [`REQUERIMIENTOS_Y_ESPECIFICACION.md`](file:///c:/Alekos/Projects/gis-tools/docs/specifications/REQUERIMIENTOS_Y_ESPECIFICACION.md) — Functional and non-functional requirements.
- [`TASKS.md`](file:///c:/Alekos/Projects/gis-tools/docs/specifications/TASKS.md) — Feature checklist and task tracking.
