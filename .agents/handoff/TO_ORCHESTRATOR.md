# Implementer Hand-off: Discrepancy Map Viewport Fit Racing Hidden Container

> **Mission**: Fix the discrepancy map's viewport fit racing a hidden (zero-size) tab container (`ComparisonResultsView.tsx`)  
> **Branch**: `fix/discrepancy-map-hidden-container-viewport-fit` (cut from `main`)  
> **Status**: **COMPLETE & VERIFIED** (All 6 quality gates green, 34/34 Vitest suites passing (355 tests), 24/24 Playwright specs passing, React Doctor 100/100, Next.js Turbopack build clean, 0 lint warnings)

---

## 1. Executive Summary & Problem Resolution

When navigating to the results step of the database synchronization wizards, the default active view is the Table tab (`ComparisonResultsView.tsx:52`), while the Map panel is rendered in the DOM with `.tabHidden { display: none !important; }`.

Previously, `useViewportFeatureWindow` computed its initial camera fit and feature-windowing query against this 0×0 container without visibility awareness:
1. `fitBounds()` no-oped on zero dimensions, leaving Leaflet at the default camera position (`[-32.5, -56.0]`, zoom 7).
2. An initial bounding box was queried and cached against the default camera view.
3. When the user subsequently switched to the Map tab, `useViewportFeatureWindow` never re-triggered `fitBounds()` because `isVisible` was omitted from its parameters and dependency array.
4. Furthermore, switching away to the Table tab caused `useDiscrepancyGeojson` to return `null`, unmounting `SpatialMapPreview` and violating the intended DOM preservation pattern.

This implementation resolves the defect across all layers:
- **Visibility Awareness (D1)**: `useViewportFeatureWindow` now accepts `isVisible: boolean = true`, returns early when `!isVisible`, and includes `isVisible` in its dependency array.
- **Container Invalidation (D2)**: Added `mapInstance.invalidateSize()` immediately after visibility guards pass, ensuring Leaflet recalculates dimensions before executing `fitBounds()` and before calling `mapInstance.getBounds()` inside `updateWindow()`.
- **Camera Retention (D3)**: Preserved `lastProcessedGeojsonRef.current !== geojson` as the exclusive gate for `fitBounds()`. Subsequent tab revisits with the same dataset do not re-run `fitBounds()`, cleanly preserving user manual pan/zoom.
- **Parameter Forwarding (D4)**: `useLeafletMap.ts` forwards `isVisible` directly to `useViewportFeatureWindow`.
- **DOM Preservation & Identity Caching**: In `ComparisonResultsView.tsx`, the map remains mounted in the DOM after first activation (`hasActivatedMap`), and `discrepancyGeojson` reference identity is preserved across tab toggles using React's state-during-render pattern.
- **Verification Surface**: `SpatialMapPreview` exposes `data-rendered-count` and `useMapInstance` exposes `window.__gis_leaflet_map` for deterministic testing.

---

## 2. Architectural Conformance & Binding Decisions

| Decision | Status | Implementation Details & Architectural Rationale |
|---|---|---|
| **D1 (Visibility-aware windowing)** | **HONORED** | Added `isVisible: boolean = true` parameter to `useViewportFeatureWindow`. Effect guards early: `if (!mapInstance \|\| !isMapReady \|\| !isVisible) return;`. Added `isVisible` to dependency array. Mirrors established `useVectorChunkStream.ts` pattern. |
| **D2 (Size invalidation before bounds)** | **HONORED** | Called `mapInstance.invalidateSize()` immediately after visibility guards pass (before `fitBounds()`) and inside `updateWindow()` (before `getBounds()`). Guarantees Leaflet's internal container dimensions cache is fresh before spatial calculations. |
| **D3 (Dataset-extent fit gate)** | **HONORED** | `lastProcessedGeojsonRef.current !== geojson` remains the sole gate for `fitBounds()`. While hidden, the ref stays `null`. On first visibility, it builds the index and fits to extent. On tab revisits with the same dataset, `lastProcessedGeojsonRef.current === geojson`, so `fitBounds()` is bypassed and user camera pan/zoom is preserved. |
| **D4 (Forwarding in useLeafletMap)** | **HONORED** | `useLeafletMap.ts` forwards `isVisible` to `useViewportFeatureWindow(mapInstanceRef, geojson, isMapReady, maxRenderFeatures, isVisible)`. Complete no-op for all 4 other callers where `isVisible` defaults to `true`. |

---

## 3. Verification of Non-Tab-Hidden Callers

Confirmed that all other consumers of `SpatialMapPreview`:
1. `src/components/tools/db-csv-sync/CsvUploader.tsx` (line 216)
2. `src/components/tools/db-shapefile-sync/LoadedShapefileCard.tsx` (line 82)
3. `src/components/tools/file-viewer/FileViewerContainer.tsx` (line 63)
4. `src/components/tools/db-table-viewer/DbTableViewerContainer.tsx` (line 72)

Never pass `isVisible` (defaults to `true`), do not wrap `SpatialMapPreview` in CSS-hidden tab containers, and remain behaviorally identical and unaffected.

---

## 4. Manual Verification & Test Environment Report

- **Live Database Environment**: In this local CLI development environment, no live PostgreSQL/PostGIS database credentials with 15k+ spatial discrepancies are reachable. As required by the specification, this is explicitly stated rather than fabricating a live session.
- **Automated Regression Suite (Playwright)**: Two comprehensive test cases in `tests/e2e/flows/comparison-results.spec.ts` exercise real browser rendering, layout calculations, and container visibility transitions:
  1. **First-Visit Full-Extent Fit**: Navigates from the default Table tab directly into the Map tab without manual panning/zooming. Asserts all 3 fixture discrepancy features are rendered (`data-rendered-count="3"`) and Leaflet camera latitude center is `< -34.0`, proving it moved to the dataset extent (~ -34.85) rather than remaining stuck at default view (`-32.5`).
  2. **Camera Position Retention on Revisit (D3)**: Navigates Table → Map → applies manual camera pan (`setView([-10.0, -20.0], 5)`) → Table → Map. Asserts Leaflet camera center remains at latitude `-10.0` (±0.1) and does not reset to full extent.

---

## 5. Quality Gauntlet Execution Outputs

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

 RUN  v5.0.0 C:/Alekos\Projects\gis-tools

 ✓ tests/unit/modules/cartography-watcher/catalogMapping.test.ts (14 tests) 9ms
 ✓ tests/unit/scripts/generateModuleRoutes.test.ts (27 tests) 47ms
 ✓ tests/unit/core/modules/createModuleRegistry.test.ts (21 tests) 19ms
 ✓ tests/unit/modules/cartography-watcher/sourceNaming.test.ts (19 tests) 13ms
 ✓ tests/unit/core/modules/createModuleRouteHandler.test.ts (5 tests) 51ms
 ✓ tests/unit/modules/cartography-watcher/fetchCatalogFile.test.ts (6 tests) 51ms
 ✓ tests/unit/utils/spatial/GeoJsonDatasetBuilder.test.ts (9 tests) 13ms
 ✓ tests/unit/services/parsers/CsvParser.test.ts (7 tests) 33ms
 ✓ tests/unit/services/parsers/ShapefileParser.test.ts (4 tests) 22ms
 ✓ tests/unit/utils/common/GisEncodingNormalizer.test.ts (19 tests) 15ms
 ✓ tests/unit/core/modules/defineModuleEndpoints.test.ts (13 tests) 13ms
 ✓ tests/unit/core/spatial/ViewportFeatureIndex.test.ts (13 tests) 12ms
 ✓ tests/unit/modules/cartography-watcher/vaultServices.test.ts (25 tests) 632ms
 ✓ tests/unit/core/spatial/ViewportWindowPlanner.test.ts (10 tests) 12ms
 ✓ tests/unit/services/parsers/CsvParserRecordAliasing.test.ts (5 tests) 11ms
 ✓ tests/unit/modules/cartography-watcher/formatters.test.ts (12 tests) 8ms
 ✓ tests/unit/modules/cartography-watcher/deltaEvaluation.test.ts (13 tests) 9ms
 ✓ tests/unit/modules/cartography-watcher/watcherOrchestration.test.ts (41 tests) 665ms
 ✓ tests/unit/core/modules/definePageContributions.test.ts (7 tests) 10ms
 ✓ tests/unit/hooks/useDiscrepancyGeojson.test.ts (5 tests) 10ms
 ✓ tests/unit/core/spatial/FeaturePreviewCap.test.ts (7 tests) 10ms
 ✓ tests/unit/modules/cartography-watcher/sourceOverrides.test.ts (7 tests) 10ms
 ✓ tests/unit/utils/spatial/WktGeometryParser.test.ts (7 tests) 10ms
 ✓ tests/unit/utils/spatial/PolygonRingNormalizer.test.ts (5 tests) 10ms
 ✓ tests/unit/utils/spatial/SpatialGeometryComparator.test.ts (6 tests) 7ms
 ✓ tests/unit/utils/common/GisStringSanitizer.test.ts (8 tests) 8ms
 ✓ tests/unit/workers/comparison/SuidKeyResolver.test.ts (5 tests) 11ms
 ✓ tests/unit/core/common/mainThreadYield.test.ts (2 tests) 12ms
 ✓ tests/unit/utils/spatial/EwkbGeometryParser.test.ts (5 tests) 7ms
 ✓ tests/unit/workers/comparison/SqlPatchGenerator.test.ts (3 tests) 8ms
 ✓ tests/unit/utils/spatial/FeatureRecordIndex.test.ts (7 tests) 5ms
 ✓ tests/unit/core/common/queryBusyState.test.ts (6 tests) 4ms
 ✓ tests/unit/workers/comparison/FileDatasetIndexer.test.ts (3 tests) 6ms
 ✓ tests/unit/modules/cartography-watcher/cartographyWatcherManifest.test.ts (9 tests) 6ms

 Test Files  34 passed (34)
      Tests  355 passed (355)
   Duration  2.75s
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
✓ Compiled successfully in 1447ms
  Running TypeScript ...
  Finished TypeScript in 2.5s ...
  Collecting page data using 11 workers ...
✓ Generating static pages using 11 workers (14/14) in 563ms
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
├ ○ /tools/db-table-viewer
├ ○ /tools/file-viewer
└ ○ /tools/m/cartography-watcher

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand
```

### Gate 5: `npm run doctor` (React Doctor Analysis)
```
> gis-tools@0.1.0 doctor
> react-doctor

√ Scanned 252 files in 6.8s [~10 workers]
✔ Scanned 252 files in 8.5s

React Doctor — gis-tools
Score: 100 / 100 Great

✔ No issues found!
```

### Gate 6: `npm run test:e2e` (Playwright E2E Suite)
```
> gis-tools@0.1.0 test:e2e
> playwright test

Running 24 tests using 6 workers

[1/24] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:9:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe listar fuentes vigiladas y sus estados en el dashboard
[2/24] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:97:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe expandir el árbol del catálogo y filtrar por formato al seleccionar recursos en sync tools
[3/24] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:31:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe agregar una nueva fuente vigilada desde el formulario
[4/24] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:44:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe mantener el formulario abierto, conservar la URL ingresada y mostrar el error si el servidor rechaza la edición
[5/24] [chromium] › tests\e2e\flows\comparison-results.spec.ts:96:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe filtrar los registros en la tabla al hacer clic en las tarjetas KPI
[6/24] [chromium] › tests\e2e\flows\comparison-results.spec.ts:55:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe cargar la vista de resultados con pestaña por defecto (Tabla) y KPIs de resumen
[7/24] [chromium] › tests\e2e\flows\comparison-results.spec.ts:138:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe filtrar la tabla mediante el campo de búsqueda de texto libre
[8/24] [chromium] › tests\e2e\flows\comparison-results.spec.ts:157:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe alternar pestañas entre Tabla y Script SQL, mostrando el parche generado con exclusión mutua
[9/24] [chromium] › tests\e2e\flows\comparison-results.spec.ts:197:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe alternar a la pestaña de Mapa, visualizar el contenedor y mostrar estado vacío con filtro sin geometrías
[10/24] [chromium] › tests\e2e\flows\comparison-results.spec.ts:231:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe preservar la posición de la cámara del usuario al alternar entre pestañas y revisitar el mapa
[11/24] [chromium] › tests\e2e\flows\comparison-results.spec.ts:276:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe permitir ejecutar el script SQL en base de datos y marcar la pestaña como ejecutada
[12/24] [chromium] › tests\e2e\flows\comparison-results.spec.ts:302:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe mostrar el estado de error cuando la consulta de registros falla
[13/24] [chromium] › tests\e2e\flows\comparison-results.spec.ts:321:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe mostrar el estado de carga mientras se consultan registros y luego mostrar el resumen
[14/24] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:14:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[15/24] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:31:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe bloquear la conexión y mostrar mensaje de validación con campos vacíos
[16/24] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:46:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas
[17/24] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:179:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe mostrar alerta de error cuando el servidor falla al obtener columnas (HTTP 500)
[18/24] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:50:7 › Herramienta: Sincronización DB vs. DB (/tools/db-db-sync) › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[19/24] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:65:7 › Herramienta: Sincronización DB vs. DB (/tools/db-db-sync) › debe validar credenciales requeridas en el paso 1
[20/24] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:77:7 › Herramienta: Sincronización DB vs. DB (/tools/db-db-sync) › debe permitir navegar el flujo completo entre DB Origen y DB Destino (Pasos 1 al 5) y retroceder
[21/24] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:10:7 › Herramienta: Sincronización DB vs. Shapefile (/tools/db-shapefile-sync) › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[22/24] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:25:7 › Herramienta: Sincronización DB vs. Shapefile (/tools/db-shapefile-sync) › debe validar credenciales requeridas y bloquear avance en paso 1
[23/24] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:37:7 › Herramienta: Sincronización DB vs. Shapefile (/tools/db-shapefile-sync) › debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas
[24/24] [chromium] › tests\e2e\smoke.test.ts:7:7 › GIS Tools Application Smoke Tests › should verify app home page loads successfully
  24 passed (22.5s)
```

---

## 6. Commit Status

Per workspace rules, **no `git commit` was executed automatically**. All changes are staged in the working directory on branch `fix/discrepancy-map-hidden-container-viewport-fit`, awaiting user direction.
