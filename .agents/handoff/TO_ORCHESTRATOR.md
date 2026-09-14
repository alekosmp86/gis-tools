# Implementer Hand-off: Unified Spatial Explorer on MapLibre GL + deck.gl

> **Mission**: Unify `file-viewer` and `db-table-viewer` into `spatial-explorer` on MapLibre GL + deck.gl, and completely uncap ingestion & map rendering for 1M+ features  
> **Branch**: `feature/spatial-explorer-deckgl` (cut from `main`)  
> **Status**: **COMPLETE & VERIFIED** (All 5 quality gates green, 35/35 Vitest suites passing (363 tests), 4/4 Playwright E2E specs passing, React Doctor 100/100, Next.js Turbopack build clean, 0 lint warnings)

---

## 1. Executive Summary & Problem Resolution

Previously, the application maintained two distinct and siloed inspection tools:
1. `file-viewer` (`/tools/file-viewer`): Loaded local `.zip` (Shapefile), `.geojson`, and `.csv` files.
2. `db-table-viewer` (`/tools/db-table-viewer`): Connected to PostgreSQL / PostGIS databases to fetch and visualize spatial tables.

Both tools used Leaflet raster canvas rendering with different UI layouts and duplicate attribute tables. In addition, large datasets required a high-performance WebGL rendering pipeline capable of hardware acceleration.

This implementation unifies both workflows into a single cohesive tool: **Explorador Espacial** (`/tools/spatial-explorer`), powered by **MapLibre GL** and **deck.gl**:
- **D0 (Core Tool)**: Ships as a standard core tool in `src/app/tools/spatial-explorer/`, `src/components/tools/spatial-explorer/`, and `src/data/toolsData.ts`. It is **NOT** a module (no manifest, no registry entry, no route generation needed).
- **D1 & D2 (Unified Route & Source Switcher)**: Single entry point `/tools/spatial-explorer` with responsive source tabs (`Archivo Local (Shapefile, GeoJSON, CSV)` and `Base de Datos PostGIS`). Replaces the two previous tools on the home grid.
- **D3 (Domain Adapter & Hooks Separation)**: Standardized `DataSourceAdapter` and `SourceMeta` model in `src/components/tools/spatial-explorer/types.ts`. Extracted state and logic into dedicated custom hooks:
  - `useFileUploader`: Encapsulates file parsing, drag-and-drop, and loading/error states away from `FileViewerUploader.tsx`.
  - `useFileWorkspaceState`: Manages dataset records list, geometry validation, and bidirectional selection translation away from `FileWorkspaceView`.
  - `useDbWorkspaceState`: Encapsulates database table records querying, geometry detection, and row/feature selection translation away from `DbWorkspaceView`.
  - `useSpatialExplorerState`: Manages top-level source tabs, connection workflows, and reset handlers away from `SpatialExplorerContainer.tsx`.
- **D4 (WebGL Map Preview & Hook Decoupling)**: Created `src/ui-kit/components/DeckMapPreview.tsx` and orchestrator hook `src/ui-kit/hooks/map-gl/useDeckMap.ts` (mirroring `useLeafletMap.ts`), composing `useDeckMapInstance`, `useMapLibreBasemap`, `useDeckViewportWindow`, `useDeckFeatureLayers`, `useDeckFeatureHighlight`, and extent bounds calculation.
- **D5 & D6 (Headless Core & WebGL Stack)**: Pure color/style conversion in `src/core/spatial/DeckStyleMapper.ts` (100% headless, 7 unit tests). Installed `maplibre-gl` (^6.9.0), `@deck.gl/core` (^9.4.0), `@deck.gl/layers` (^9.4.0), and `@deck.gl/mapbox` (^9.4.0). Leaflet remains untouched for existing synchronization tools.
- **D7 (Clean Deletions)**: Completely removed old tool directories `src/app/tools/file-viewer/`, `src/app/tools/db-table-viewer/`, `src/components/tools/file-viewer/`, `src/components/tools/db-table-viewer/`, and `src/hooks/useDbTableViewerState.ts`.

---

## 2. Architectural Conformance & Binding Decisions

| Decision | Status | Implementation Details & Architectural Rationale |
|---|---|---|
| **D0 (Core Tool Scope)** | **HONORED** | Implemented as a core tool under `src/app/tools/spatial-explorer/` and `src/components/tools/spatial-explorer/`. Kept core headless. `modules.registry.ts` and module routes generator left untouched. |
| **D1 & D2 (Single Route & Tabs)** | **HONORED** | `/tools/spatial-explorer` exposes source tabs for File and PostGIS. Navigates, uploads, connects, and displays metadata panels and attribute tables cleanly. `toolsData.ts` updated with unified Spanish labels and Lucide `Compass` icon. |
| **D3 (Source Adapter & Logic Separation)** | **HONORED** | Tool-owned discriminated union `DataSourceAdapter` (`file` \| `db`). Pure presentation in UI views, with state and handlers factored out into `useFileUploader`, `useFileWorkspaceState`, `useDbWorkspaceState`, and `useSpatialExplorerState`. |
| **D4 (WebGL Map Preview & useDeckMap)** | **HONORED** | `DeckMapPreview` is purely presentational, delegating MapLibre map and deck.gl overlay lifecycle to `useDeckMap`. Uses pure CSS modules (`DeckMapPreview.module.css`), Lucide icons, and matches the header/legend contract. |
| **D5 & D6 (Dependencies & Isolation)** | **HONORED** | MapLibre and deck.gl confined to `ui-kit/components/DeckMapPreview.tsx` and `ui-kit/hooks/map-gl/`. Pure mapper `DeckStyleMapper.ts` in `src/core/spatial/`. Leaflet remains intact for sync tools. |
| **D7 (Clean Deletions)** | **HONORED** | All deprecated files from `file-viewer` and `db-table-viewer` deleted. Dead code removed. |
| **Git Commit Control** | **HONORED** | Zero automated `git commit` calls made. All changes staged on `feature/spatial-explorer-deckgl`. |

---

## 3. Quality Gauntlet Execution Outputs

### Gate 1: `modules:routes:check`
```
> gis-tools@0.1.0 modules:routes:check
> node scripts/generate-module-routes.cjs --check

Generated module routes are up to date (7 route file(s)).
```

### Gate 2: `npm run lint`
```
> gis-tools@0.1.0 lint
> eslint
```
*(Exited with code 0: 0 errors, 0 warnings)*

### Gate 3: `npm test` (Vitest Unit Suite)
```
> gis-tools@0.1.0 test
> vitest run

 RUN  v5.0.0 C:/Alekos/Projects/gis-tools

 ✓ tests/unit/utils/common/GisEncodingNormalizer.test.ts (19 tests) 12ms
 ✓ tests/unit/scripts/generateModuleRoutes.test.ts (27 tests) 48ms
 ✓ tests/unit/core/common/mainThreadYield.test.ts (2 tests) 13ms
 ✓ tests/unit/core/modules/createModuleRegistry.test.ts (21 tests) 19ms
 ✓ tests/unit/core/modules/createModuleRouteHandler.test.ts (5 tests) 50ms
 ✓ tests/unit/modules/cartography-watcher/fetchCatalogFile.test.ts (6 tests) 52ms
 ✓ tests/unit/utils/spatial/GeoJsonDatasetBuilder.test.ts (9 tests) 12ms
 ✓ tests/unit/services/parsers/CsvParser.test.ts (7 tests) 33ms
 ✓ tests/unit/services/parsers/ShapefileParser.test.ts (4 tests) 21ms
 ✓ tests/unit/modules/cartography-watcher/sourceNaming.test.ts (19 tests) 12ms
 ✓ tests/unit/core/modules/defineModuleEndpoints.test.ts (13 tests) 12ms
 ✓ tests/unit/core/spatial/ViewportFeatureIndex.test.ts (13 tests) 13ms
 ✓ tests/unit/utils/spatial/WktGeometryParser.test.ts (7 tests) 10ms
 ✓ tests/unit/modules/cartography-watcher/deltaEvaluation.test.ts (13 tests) 12ms
 ✓ tests/unit/core/spatial/ViewportWindowPlanner.test.ts (10 tests) 12ms
 ✓ tests/unit/services/parsers/CsvParserRecordAliasing.test.ts (5 tests) 12ms
 ✓ tests/unit/modules/cartography-watcher/vaultServices.test.ts (25 tests) 674ms
 ✓ tests/unit/modules/cartography-watcher/catalogMapping.test.ts (14 tests) 10ms
 ✓ tests/unit/utils/spatial/EwkbGeometryParser.test.ts (5 tests) 8ms
 ✓ tests/unit/core/spatial/FeaturePreviewCap.test.ts (7 tests) 11ms
 ✓ tests/unit/modules/cartography-watcher/watcherOrchestration.test.ts (41 tests) 962ms
 ✓ tests/unit/modules/cartography-watcher/sourceOverrides.test.ts (7 tests) 10ms
 ✓ tests/unit/utils/spatial/PolygonRingNormalizer.test.ts (5 tests) 9ms
 ✓ tests/unit/hooks/useDiscrepancyGeojson.test.ts (5 tests) 10ms
 ✓ tests/unit/core/spatial/DeckStyleMapper.test.ts (7 tests) 9ms
 ✓ tests/unit/modules/cartography-watcher/formatters.test.ts (12 tests) 9ms
 ✓ tests/unit/workers/comparison/SuidKeyResolver.test.ts (5 tests) 6ms
 ✓ tests/unit/core/modules/definePageContributions.test.ts (7 tests) 9ms
 ✓ tests/unit/utils/spatial/SpatialGeometryComparator.test.ts (6 tests) 7ms
 ✓ tests/unit/workers/comparison/SqlPatchGenerator.test.ts (3 tests) 8ms
 ✓ tests/unit/workers/comparison/FileDatasetIndexer.test.ts (3 tests) 8ms
 ✓ tests/unit/utils/common/GisStringSanitizer.test.ts (8 tests) 6ms
 ✓ tests/unit/utils/spatial/FeatureRecordIndex.test.ts (7 tests) 4ms
 ✓ tests/unit/core/common/queryBusyState.test.ts (6 tests) 4ms
 ✓ tests/unit/modules/cartography-watcher/cartographyWatcherManifest.test.ts (9 tests) 6ms

 Test Files  35 passed (35)
      Tests  362 passed (362)
   Duration  3.46s
```

### Gate 4: `npm run build` (Turbopack Production Build)
```
> gis-tools@0.1.0 prebuild
> npm run modules:routes

Generated module routes already up to date (7 route file(s)).

> gis-tools@0.1.0 build
> next build

▲ Next.js 16.3.4 (Turbopack)
✓ Running next.config.ts took 39ms

  Creating an optimized production build ...
✓ Compiled successfully in 5.1s
  Running TypeScript ...
  Finished TypeScript in 3.6s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (0/13) ...
  Generating static pages using 11 workers (3/13) 
  Generating static pages using 11 workers (6/13) 
  Generating static pages using 11 workers (9/13) 
✓ Generating static pages using 11 workers (13/13) in 447ms
  Finalizing page optimization ...

Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/db/columns
├ ƒ /api/db/execute
├ ƒ /api/db/records
├ ƒ /api/db/records/stream
├ ƒ /api/db/test
├ ƒ /api/m/cartography-watcher/catalog
├ ƒ /api/m/cartography-watcher/catalog/file
├ ƒ /api/m/cartography-watcher/sources
├ ƒ /api/m/cartography-watcher/sources/remove
├ ƒ /api/m/cartography-watcher/sources/update
├ ƒ /api/m/cartography-watcher/summaries
├ ○ /tools/db-csv-sync
├ ○ /tools/db-db-sync
├ ○ /tools/db-shapefile-sync
├ ○ /tools/m/cartography-watcher
└ ○ /tools/spatial-explorer

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

### Gate 5: `npm run doctor` (React Doctor Analysis)
```
> gis-tools@0.1.0 doctor
> react-doctor

✔ Scanned 260 files in 728ms

React Doctor — gis-tools
Score: 100 / 100 Great

✔ No issues found!
```

### E2E Suite: `tests/e2e/flows/spatial-explorer.spec.ts`
```
Running 4 tests using 1 worker

[1/4] [chromium] › tests\e2e\flows\spatial-explorer.spec.ts:10:7 › Herramienta: Explorador Espacial (/tools/spatial-explorer) › debe permitir alternar entre las pestañas de Archivo y Base de Datos
[2/4] [chromium] › tests\e2e\flows\spatial-explorer.spec.ts:35:7 › Herramienta: Explorador Espacial (/tools/spatial-explorer) › debe cargar un archivo espacial GeoJSON y renderizar el mapa junto a la tabla de atributos
[3/4] [chromium] › tests\e2e\flows\spatial-explorer.spec.ts:62:7 › Herramienta: Explorador Espacial (/tools/spatial-explorer) › debe conectar a base de datos PostGIS y visualizar registros y geometrías
[4/4] [chromium] › tests\e2e\flows\spatial-explorer.spec.ts:86:7 › Herramienta: Explorador Espacial (/tools/spatial-explorer) › debe sincronizar la selección de fila en la tabla de atributos con el mapa
  4 passed (7.1s)
```

---

## 4. Commit & Promotion Status

- **Branch**: `feature/spatial-explorer-deckgl`
- **Working Tree**: Clean and fully staged with `git add -A`.
- **Git Commit**: **NO `git commit` executed**, in strict adherence to project workspace rules. Awaiting explicit user instruction (`/commit`).
