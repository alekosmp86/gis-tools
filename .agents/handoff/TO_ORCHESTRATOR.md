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


---

# Report: module `address-dedup` (REVISED brief, SQL as the engine)

Branch `feat/module-address-dedup` (cut from `main`). Nothing committed or pushed. No real database touched.

## Status
DONE. pglite ran the query **unmodified** (exact exported text, bound params, same code path as the pg repository).

## Files
- Module `src/modules/address-dedup/`: `constants.ts`, `types.ts`, `module.routes.json`, `manifest.ts`, `api/handlers.ts`, `data/dedupLabels.ts`, `domain/{summary,groups,export}.ts`, `services/{AddressRepository,PgAddressRepository,DedupOrchestrator}.ts`, `services/queries/{duplicateAnalysisQuery,mapAnalysisRow,runDuplicateAnalysis}.ts`, `ui/` (DedupDashboard, DedupConnectionForm, DedupOptionsPanel, DedupSummaryTable, DedupGroupList, DedupExportBar, DedupHomeCard, dedupClient, useDedupAnalysis, useDedupProfiles + .module.css).
- Tests `tests/unit/modules/address-dedup/`: `duplicateAnalysisQuery`, `summary`, `groups`, `export`, `dedupOrchestration`, `pgAddressRepository`, `handlers`, `addressDedupManifest` (+ helpers `pgliteHarness.ts`, `rowFactory.ts`).
- Outside module (D10): `src/app/modules.registry.ts` (1 import, 1 entry), generated `src/app/api/m/address-dedup/**` and `src/app/tools/m/address-dedup/page.tsx`, `docs/tools/ADDRESS_DEDUP_MODULE.md`, `docs/README.md` (link), `CLAUDE.md` (pointer), `package.json` + lockfile (`@electric-sql/pglite@^0.5.8`, devDependency only).

## Gauntlet (real output, final run after restore; portable Node)
- `npm run modules:routes && npm run modules:routes:check`: PASS, "Generated module routes are up to date (10 route file(s))."
- `npm run lint`: PASS, no output (0 errors, 0 warnings).
- `npm test`: PASS, `Test Files 42 passed (42)`, `Tests 463 passed (463)` (baseline without the module: 34 files / 355 tests; module adds 8 files / 108 tests).
- `npm run build` (after `rm -rf .next`): PASS, "Compiled successfully", routes listed: `/api/m/address-dedup/analyze`, `/api/m/address-dedup/export`, `/tools/m/address-dedup`.
- `npm run doctor`: PASS, "Score: 100 / 100 Great, No issues found!" (the score API was reachable this time). First run flagged `query-mutation-missing-invalidation` and then `react-hooks-js/todo` (try/finally); fixed by restructuring `useDedupAnalysis` (promise chain, no useMutation), no suppression.
- Deletability proof: moved module folder and test folder out, restored registry to HEAD, `npm run modules:routes` reported orphaned `address-dedup/analyze`, `address-dedup/export`, `tools/m/address-dedup/page.tsx` and removed them; `rm -rf .next && npm run build` clean, route table back to the 7 watcher API routes + 5 tools + watcher page; `npm run lint` clean; `npm test` 34 files / 355 tests green. Restored everything, regenerated, `modules:routes:check` green. (Files outside the deletion set that remain: docs, CLAUDE.md pointer, package.json/lockfile pglite devDependency, allowed by D10.)
- Dead-code audit: removed two unneeded exports (`isLocatable`, `PointExport`); no unused imports (eslint clean).
- Note: bare `npx tsc --noEmit` reports a stale `.next/types/validator.ts` error about `spatial-explorer/page.js` (leftover from another branch); not present after a clean `.next` build. `next build` type-check passes.

## Findings and questions for the orchestrator
1. **`NO_DUPLICATE` can never appear in the output.** Singletons are excluded under both scopes (REMOVAL_GROUPS needs a REMOVE; ALL needs `dup_group_size > 1`), so the brief's test "singleton KEEP/NO_DUPLICATE" cannot be written as stated. The branch exists in SQL and the const; the test pins that singletons (matched or not) never appear. Not changed.
2. **`id_font` comment discrepancy.** `find_removal_candidates.sql` code says `IN (1, 9, 10)` with comment "ANTEL, IDE, TLK"; `find_infrastructure_matches.sql` says `IN (9, 10)` "ANTEL, TLK only; IDEUY (id_font=1) excluded". Implied mapping: IDE=1, ANTEL=9, TLK=10. Kept code `[1, 9, 10]` and `name_font` as `fuente`; tests use that mapping. Unconfirmed against the real DB.
3. **`$7` branch ordering.** Per brief the `REDUNDANT_WITH_PROTECTED` branch sits before the rank branch, and `REDUNDANT_WITH_MATCHED` is part of the trailing else, so with `$7=true` an unmatched ANTEL in a group that has both a matched ANTEL and an IDE row gets `REDUNDANT_WITH_PROTECTED` (REMOVE either way). Confirm that is the intended reason.
4. **Query shape beyond v3.** Decision is computed as one CASE producing `decision_reason` (CTE `reasoned`); `decision` is derived from it (CTE `decided`), so branch logic is not duplicated. The v3 key also includes `rs_reftramo`; kept faithfully (not listed in the brief's key description). `pool_rank`/`n_matched` now use `$3`, `has_protected_in_group` uses `$4`; the protected KEEP branch uses `$4` instead of the literal `'IDE'`.
5. **Row typing.** `pg` returns bigint aggregates (`group_id`, `dup_group_size`, ...) as strings, so `mapAnalysisRow` coerces numbers instead of the SQL casting (keeps SQL faithful). Verified on pglite only; pg strings handled by the same coercion, not run against real pg.
6. **Link `size` property** = group member count (all rows), not locatable count. Brief said `{groupId, size}` only.
7. **Analyze UI** uses a local hook (`useDedupAnalysis`) rather than a react-query mutation, because react-doctor flagged an invalidation-less mutation and the call carries credentials and should not be cached. The export button uses a react-query mutation.
8. Error text scrubbing replaces the submitted password with `***` in 500 bodies (pg errors still may include host, per brief D7).
9. `handlers.test` covers malformed JSON, empty body, `null`, `[]`, query-string credentials ignored, password never in error body.

## Not done / unverified
- Nothing skipped from the brief. UI was built and compiled (build, lint, doctor) but not exercised in a browser; no e2e added. The `pg` repository was tested with a fake client only (per brief); real `pg` connection behavior is unverified. No commit made.


---

# Fix round 1: address-dedup

- F1: `PgClientLike` gained `on("error", listener)`. The repository attaches `client.on("error", () => undefined)` right after `createClient` and before `connect()`, not inside `createPgClient`. That way the fake client used in tests exercises the same path as the real one. Tests added: a listener is registered before connect, and a mid-query client 'error' emission rejects with the query failure with no uncaught throw, with `end()` still called. The fake throws on 'error' when no listener is registered, as EventEmitter does.
- F2: new `mapAnalysisRow.test.ts` with 6 cases covering string numbers from pg, null/NaN coordinates, null and numeric km, booleans, and numeric output types.
- F3: `mapAnalysisRow` maps a NULL or undefined `fuente`/`urn` to `""`. `DedupSummaryTable` has a new column "Otras / sin fuente" that sums any fuente not in ANTEL/TLK/IDE, so totals reconcile. Summary test added: a row with an empty fuente is still counted.
- F4: `downloadExport` attaches the anchor to `document.body`, clicks, removes it, and revokes the URL in `setTimeout` using `DOWNLOAD_URL_REVOKE_DELAY_MS` (constants).
- F5: `useDedupAnalysis` returns a `resultId` that increments on each result. `<DedupGroupList key={analysis.resultId}>` resets pagination, with no effect.
- Docs: added section 7 "Known limitations" (CSV formula injection not neutralised).

Gauntlet (portable Node, clean `.next`):
- `modules:routes:check`: PASS (10 route files up to date).
- `lint`: PASS (no output).
- `npm test`: PASS, 43 files / 473 tests.
- `build`: PASS (address-dedup routes listed).
- `doctor`: PASS, 100/100, No issues found. A first run flagged `js-set-map-lookups` in the new column helper; fixed with a Set.

Skipped: nothing. The UI was not exercised in a browser. Not committed.


---

# UI redesign: address-dedup (layout + table UX)

UI-only, on `feat/module-address-dedup`, nothing committed. SQL, `services/`, `api/`, `manifest.ts`, `module.routes.json`, core and ui-kit were not touched. The only edits outside `ui/` are additive: `constants.ts`, `types.ts`, `data/dedupLabels.ts` and the new `domain/` files. `domain/summary|groups|export.ts` are unchanged. The docs deletion-set list was updated.

## Files
Created in `src/modules/address-dedup/`:
- `domain/groupFilters.ts`, `domain/summaryView.ts`, `domain/rowFormat.ts` (pure logic).
- `ui/` components and hooks:
  - Layout: `DedupConfigCard`, `DedupContextBar`, `DedupLoadingCard`, `DedupTabs`, `DedupResultsView`.
  - Resumen tab: `DedupSummaryTab`, `DedupKpiCards`, `DedupKpiCard`, `DedupDecisionMatrix`, `DedupReasonTable`.
  - Grupos tab: `DedupGroupsTab`, `DedupGroupToolbar`, `DedupFilterSelect`, `DedupGroupTable`, `DedupGroupHeaderRow`, `DedupMemberRow`, `DedupCopyButton`, `DedupGroupsEmptyState`, `useDedupGroupFilters`.
  - Shared: `DedupShared.module.css`, plus a `.module.css` per component.

Rewritten or edited:
- `DedupDashboard` (now orchestration only), `DedupExportBar` (compact button group), and `DedupConnectionForm` (takes `children` so the options sit before the Run button).
- `constants.ts` (`GroupSort`, `DecisionFilter`, `FILTER_ALL`, `DedupTab`, `KpiTone`, `OTHER_FUENTE_COLUMN`), `types.ts`, `data/dedupLabels.ts`.

Deleted: `DedupSummaryTable.tsx/.css`, `DedupGroupList.tsx/.css`, `DedupDashboard.module.css`.

Added to the deletion set (documented in `docs/tools/ADDRESS_DEDUP_MODULE.md`): `tests/e2e/flows/address-dedup.spec.ts` and `tests/e2e/fixtures/dedupFixtures.ts`.

Tests:
- Unit: `groupFilters.test.ts`, `summaryView.test.ts`, `rowFormat.test.ts`.
- E2E: 13 tests in `address-dedup.spec.ts`. They cover:
  - the config card alone before a run, the context bar and Resumen KPIs and both tables, and the Grupos tab;
  - keyboard tab navigation, search, the decision filter keeping all members and clearing, "Solo para revisar", the empty state, and expand/collapse all;
  - the export request with `format=csv`, "Editar parámetros" and cancel, validation error placement, and the loading card.

## Gauntlet (portable Node; final code state, clean `.next` for build)
- `modules:routes && modules:routes:check`: PASS, "Generated module routes are up to date (10 route file(s))."
- `lint`: PASS, no output.
- `npm test`: PASS, 46 files / 523 tests (was 43 / 473).
- `build`: PASS, Compiled successfully; address-dedup routes present.
- `doctor`: PASS, 100/100, "No issues found!"
  - Two intermediate warnings, `js-combine-iterations` in `rowFormat.ts` and `summaryView.ts`, were fixed with single loops, no suppression.
- `npm run test:e2e`:
  - The full run immediately after the build failed once: 36 passed, 1 failed. The failing test was `address-dedup.spec.ts` "debe mostrar solo la tarjeta de configuración antes de ejecutar", which is the first page hit on a cold dev server. I did not capture the failure text.
  - It passed when re-run alone and in two further full runs: `37 passed (28.0s)` and `37 passed (28.4s)`.
  - The previously existing 24 specs plus the 13 new ones are all green in those runs. Treat the cold-start failure as a probable timing flake, not proven.

## Screenshots (`...\scratchpad\dedup-ui\`)
- `C:\Users\g611045\AppData\Local\Temp\claude\c--Alekos-Projects-gis-tools\947681d9-9c0b-4b39-8f12-44d3961eae71\scratchpad\dedup-ui\01-config.png`
- `...\02-resumen.png`
- `...\03-grupos.png`
- `...\04-grupos-filtrado.png`

## Deviations and notes
- Indeterminate loading uses a small CSS bar inside `DedupLoadingCard`, because the ui-kit `ProgressBar` is determinate only.
- Proportion bars use `<progress>` styled in CSS, so there is no inline style.
- Copy confirmation: the tick clears on blur or mouse leave, with no timer.
- Switching Resumen to Grupos and back resets the Grupos filters, because the inactive tab unmounts. A new result resets everything via `key={resultId}`. Say if filters should persist across tabs.
- The "N filas no tienen coordenadas" warning is pre-existing text and reads "1 filas"; not changed.
- The paginator footer text "registros" comes from the ui-kit `PaginationControls` and counts groups here; ui-kit was not edited.
- In the dev-server screenshots, the Next dev badge overlaps the first group chevron; this is a dev-only artefact.
- Nothing skipped. Not exercised: real data volume (~1,200 groups) rendering performance, and the clipboard copy in a browser.


---

# UI fix round 1: address-dedup

- G1: removed `SCREENSHOT_DIR`, `screenshotPath`, the `path` import and every `page.screenshot` call from the e2e spec. A grep for `g611045` and `claude\` over `src/`, `tests/`, `docs/`, `CLAUDE.md` and `package.json` finds nothing. The handoff files under `.agents/` still contain those paths, since they are briefs and reports, not code.
- G2: `DedupGroupTable` no longer has a vertical clamp or a nested scroll. Only `overflow-x: auto` remains and the thead is not sticky. The 6-group fixture shows every row (screenshot 03).
- G3: the toolbar is `position: sticky` only at `min-width: 900px`, with an opaque background via the local property `--dedup-toolbar-background`. At 360px it is static and flows with the page.
- G4: hard-coded colours replaced. The table head uses the local `--dedup-head-background`, the member badge uses `var(--accent-rose)`, and the home card title hover uses `var(--accent-cyan)`. `globals.css` was not edited.
- G5: new `pluralize` in `domain/rowFormat.ts` (unit-tested). The no-coordinates warning now uses `formatNumber` and the singular/plural strings from `data/dedupLabels.ts`. The group header "fila/filas" uses the same helper and the same labels.
- G6: added `EMPTY_FUENTE` in `constants.ts`. The "Otras / sin fuente" filter option now means "any fuente that is not ANTEL/TLK/IDE", the same rule as the matrix column. `listFuentes` returns the known fuentes present plus one `OTHER` option; an unknown value such as "XYZ" is not its own option. Tests were updated, and the same-member rule tests still pass. `isKnownFuente` is exported from `summaryView.ts` and shared.
  - Note: `EMPTY_FUENTE` is used in `DedupMemberRow`. The raw `""` compares in `groupFilters` and the toolbar are gone, since the logic now goes through `isKnownFuente` and `OTHER_FUENTE_COLUMN`.
- G7: the SIZE_DESC and REMOVALS_DESC tie-break tests now feed `[...sortFixture()].reverse()`. With the groupId tie-break temporarily deleted, both failed ("× should sort by size descending, breaking ties by group id ascending" and "× should sort by removals descending, ..."; 2 failed | 32 passed). I then restored it.
- G8: `fillConnection` waits for the Analizar button to be enabled and asserts each filled input with `toHaveValue`. The validation test got the same wait.
- G9: tabpanel has `tabIndex={0}` and the padrón cell is `white-space: nowrap`.

## Gauntlet (portable Node)
- `modules:routes:check`: PASS (10 route files up to date).
- `lint`: PASS, no output.
- `npm test`: PASS, 46 files / 528 tests.
- `build` (clean `.next`): PASS, Compiled successfully.
- `doctor`: PASS, 100/100, "No issues found!"
- `test:e2e`, run directly after the build with a cold dev server, then once more: both `37 passed` (31.5s and 26.9s). The earlier cold-start flake did not recur.

## Review screenshots (throwaway script outside the repo; dev server stopped afterwards)
Folder `C:\Users\g611045\AppData\Local\Temp\claude\c--Alekos-Projects-gis-tools\947681d9-9c0b-4b39-8f12-44d3961eae71\scratchpad\dedup-ui2\`:
- `01-config-1280.png`, `02-resumen-1280.png`, `03-grupos-1280.png` (all 6 groups and 12 rows visible, page scroll only), `04-grupos-filtrado-1280.png`
- `05-grupos-360.png` (full page), `06-grupos-360-scrolled.png` (the toolbar scrolls away and does not cover the screen)

Skipped: nothing. Not done, per the brief: shared aria-controls id, and the unlabelled group-toggle cell.


---

# UI fix round 2: address-dedup

Grupos state now survives Resumen <-> Grupos. `useDedupGroupFilters` is lifted into `DedupResultsView`, and `DedupGroupsTab` takes `view` as a prop. `key={resultId}` still resets everything on a new analysis. A new e2e test applies the Decisión=Eliminar filter, switches to Resumen and back with the filter and the count still applied, then re-runs and finds both reset.

Gauntlet (portable Node, clean `.next`):
- `modules:routes:check`: PASS (10 route files).
- `lint`: PASS, no output.
- `npm test`: PASS, 46 files / 528 tests.
- `build`: PASS (Compiled successfully).
- `doctor`: PASS, 100/100, No issues found.
- `test:e2e`: PASS, 38 passed (40.2s).

Not committed.


---

## Brief 4 — sources resolved by name, no `id_font`

Status: DONE. Not committed.

Changes:
- `constants.ts`: deleted `DedupRules.DETECTION_FONT_IDS`.
- `types.ts`: `fontIds: number[]` replaced by `detectionFuentes: string[]`.
- `services/DedupOrchestrator.ts`: `listDetectionFuentes()` = de-duplicated union of `REMOVABLE_FUENTES` and `PROTECTED_FUENTES` (ANTEL, TLK, IDE). No new literal list.
- `services/queries/duplicateAnalysisQuery.ts`: `WHERE b.name_font = ANY($1::text[])`, binds `detectionFuentes`, `$1` doc comment updated, "ANTEL, IDE, TLK" note dropped. `$2..$8` unchanged.
- `docs/tools/ADDRESS_DEDUP_MODULE.md`: `$1` row and two font-id mentions updated.
- `tests/.../pgliteHarness.ts`: removed `id_font` column, `FONT_ID_BY_FUENTE`, `idFont` fixture field (nothing references them; proves the query does not need them). `DEFAULT_PARAMETERS.detectionFuentes` = `[ANTEL, TLK, IDE]`. `urnOf` falls back to a generic prefix for an unknown fuente.
- `duplicateAnalysisQuery.test.ts`: "widened fonts" case now uses a fifth source name `OTRA` (detected only when listed). New test: IDE row excluded when absent from `detectionFuentes`.
- `dedupOrchestration.test.ts`: expected `$1` value changed from `[1, 9, 10]` to `[ANTEL, TLK, IDE]` (contract change, not a weakened assertion).

Gauntlet (portable Node):
- `modules:routes:check`: PASS (10 route files, up to date).
- `lint`: PASS, no output.
- `npm test`: PASS, 46 files / 529 tests.
- `build`: PASS (`/tools/m/address-dedup` listed).
- `doctor`: PASS, No issues found (score unavailable, expected).
- `test:e2e`: PASS, 38 passed (33.6s).
- grep for `id_font|fontIds|FONT_ID|idFont` over src/tests/docs: no matches.

Deviations / notes:
- The brief says the "differential test vs v3 SQL must still show zero mismatches". No such test exists in the repo (grep for "differential" / v3 SQL runner: only comments/docs mention `find_removal_candidates.sql`; the v3 file is outside the repo). I did not create one and could not run one. If the differential lives in a script outside the repo, re-run it against the new `$1`.
- Exact v3 parity at defaults holds only if prod `name_font` is exactly `ANTEL`/`TLK`/`IDE` for ids 9/10/1 (verified by you per the brief).


---

## Brief 5 - group table shows every match-key column + top/bottom scrollbars

Status: DONE. Not committed.

Changes:
- `services/queries/duplicateAnalysisQuery.ts`: effective segment computed once in a `CROSS JOIN LATERAL` inside `keyed` (`padron_locality_or_geo`); `match_key` reuses it. Final SELECT appends `province_code, padron_locality, padron_locality_or_geo, match_key`.
- `types.ts`: `AnalysisRow` gains the 4 fields; new `AnalysisTextField` type.
- `services/queries/mapAnalysisRow.ts`: maps them (match_key via `toText`).
- `domain/export.ts`: Point `properties` now built from `EXPORT_COLUMNS` (was `...row`, which would have leaked the new fields). CSV header unchanged.
- `data/dedupLabels.ts`: `MATCH_KEY_COLUMNS` (field + Spanish label, key order); `GROUP_TABLE_COLUMNS` and count derived from it.
- `domain/rowFormat.ts`: `describeAddress`/`describePadron`/`NO_ADDRESS_LABEL` deleted (unused); added `EMPTY_CELL` + `formatCell`.
- `ui/DedupMemberRow.tsx` (+css): renders key cells via `formatCell`, nowrap cells; `.padron` removed.
- `ui/DedupGroupHeaderRow.tsx`: toggle `title` = match_key.
- `ui/DedupGroupTable.tsx` (+css): wrapped in `DedupScrollFrame`; table `min-width: max-content`, head nowrap.
- New `ui/DedupScrollFrame.tsx` + `.module.css`, `ui/useSyncedHorizontalScroll.ts`: top scroller with spacer (width via ResizeObserver on content and table), two-way scroll mirror, epsilon guard, top bar hidden without overflow.
- `docs/tools/ADDRESS_DEDUP_MODULE.md`: query columns, groups table, export notes.
- Tests: `duplicateAnalysisQuery.test.ts` (7 new: province_code, padron_locality, geo fallback with/without padron, decimals param, same key per group, key embeds segment), `mapAnalysisRow.test.ts` (2), `export.test.ts` (pinned v3 header literal; Point properties == EXPORT_COLUMNS), `rowFormat.test.ts` rewritten (formatCell, column count/order), `rowFactory.ts`, e2e fixtures + spec (15 key headers, top/bottom sync at 360px, no page overflow at 360px, top bar visible iff overflow).

Gauntlet (portable Node):
- modules:routes:check: PASS (10 route files up to date).
- lint: PASS, no output.
- npm test: PASS, 46 files / 542 tests.
- build: PASS (Compiled successfully; `/tools/m/address-dedup` listed).
- doctor: PASS, No issues found (score unavailable, expected).
- test:e2e: PASS, 42 passed (33.4s).

Deviations / notes:
- Segment is in a LATERAL subquery, not a plain column in `keyed`'s select list (Postgres cannot reference a sibling alias). Still inside `keyed`.
- `padron_locality_or_geo` is exposed raw (key applies upper/trim); the spec was ambiguous on "except".
- Hide-top-bar e2e is conditional (visible iff content overflows): the page container caps width so the table overflows even at 3840px, so the no-overflow state is not reachable in e2e. The hide logic is unit-untested (no DOM test infra); verified only through that conditional.
- Group header title is the match key (no copy button; nested button inside the toggle would be invalid).
- Header toggle spans the full table width, so with horizontal scroll its label scrolls out of view (sticky columns out of scope).

---

## Brief 6 report — scrollbars at desktop width (not committed)

Status: DONE.

Root cause (evidence, Chromium with `--enable-features=OverlayScrollbar`, `--hide-scrollbars` removed):
- Hypothesis 2 (ancestor grows to max-content) NOT reproduced: frame right 1248 <= 1280 and 1572 <= 1920; scrollWidth 2421 > clientWidth 1222/1230; page does not overflow.
- Hypothesis 1 partly: top bar existed but was only 10px (global `::-webkit-scrollbar` 8px + border) with a low-contrast thumb (`rgba(100,116,139,.4)` on dark track) -> effectively invisible. Overlay did not collapse it to 1px because the global webkit rule disables overlay.
- Header toggle label scrolled out of view: before, toggleLeft -373.5 (frame left 25) at 1280, -57.5 (frame left 341) at 1920.
- Could not reproduce the clipped right border; added `min-width:0` to ancestors anyway.

Before: topHeight 10 (expected >= 12) FAIL x2; sticky label FAIL x2.
After: topHeight 14 at 1280 and 1920; toggleLeft 25 == frameLeft 25 (1280), 341 == 341 (1920); 6/6 pass.

Changes:
- `ui/DedupScrollFrame.module.css`: `--dedup-scrollbar-size: 14px`; top scroller explicit height + `overflow-x: scroll`; webkit scrollbar styling (track/thumb/hover from theme tokens) on both scrollers; `@supports not selector(::-webkit-scrollbar)` fallback with `scrollbar-width`/`scrollbar-color` (standard props would otherwise override the webkit ones in Chromium).
- `ui/DedupGroupHeaderRow.module.css`: toggle `position: sticky; left: 0; width: fit-content` (side effect: clickable area is now the label, not the whole row).
- `ui/DedupGroupsTab.module.css` `.stack`, `ui/DedupTabs.module.css` `.tabs`: `min-width: 0`.
- New `tests/e2e/flows/address-dedup-scroll.spec.ts`: per-file `test.use` launchOptions (overlay scrollbars, real scrollbars); at 1280x800 and 1920x1080: frame within viewport, content overflows, top bar not display:none and height >= 12, no page overflow, top->content sync, header label stays within frame after scrolling 400px.

Gauntlet (portable Node): modules:routes:check PASS (10 files); lint PASS (no output); npm test PASS 46 files / 542 tests; build PASS; doctor PASS (No issues found, 100/100); test:e2e PASS 48 passed (35.5s).


## Brief 7 report

Status: DONE (uncommitted, branch `fix/address-dedup-internal-units` cut from main).

Changes: duplicateAnalysisQuery.ts (internal_unit_urns CTE, has_internal_units in pool, reasoned_raw + new reasoned override, final SELECT col), constants.ts (HAS_INTERNAL_UNITS, REVIEW_REASONS), dedupLabels.ts (label, description, KEEP reason list), types.ts, mapAnalysisRow.ts, groupFilters.ts (hasReviewRows), summaryView.ts (reviewCount), docs/tools/ADDRESS_DEDUP_MODULE.md. export.ts untouched; $1..$8 unchanged; CSV header test passes unchanged.

Tests: pgliteHarness (3 tables, TRUNCATE, markHasInternalUnits), duplicateAnalysisQuery.test (9 new cases covering all 7 required + LOWEST_URN_KEPT), groupFilters, summaryView, mapAnalysisRow, rowFactory, e2e fixture (group 7) + spec (review filter count 2, Motivo filter test).

Deviations:
1. reasoned_raw's final alias is `base_reason` (CASE untouched), not `decision_reason`: `SELECT *, ... AS decision_reason` over a source already holding decision_reason yields two same-named columns (ambiguous in `decided`).
2. NO_DUPLICATE test: singletons never reach the output, so it runs DUPLICATE_ANALYSIS_SQL with `dup_group_size > 1` swapped to `true` (asserts the replace happened) to observe the singleton row.
3. e2e: new group 7 (DEDUP_GROUP_COUNT 6 -> 7); "Solo para revisar" expectation changed 1 -> 2 groups because the fixture gained a review group, with Grupo 7 badge asserted.

Gauntlet: routes check PASS, lint PASS, npm test 552/552, build PASS, doctor "No issues found", e2e 49 passed.


---

## Fix round 1 report (Brief 7, F1)

Status: DONE (code + tests). Live dashboard numbers UNVERIFIED in the UI (no prod access).

Changes
- `src/modules/address-dedup/services/queries/duplicateAnalysisQuery.ts`: `output_groups` now also keeps groups with a row whose `decision_reason = ANY(ARRAY[...])`; array built from `REVIEW_REASONS` via `REVIEW_REASON_SQL_LIST` (map/join), no new hand-written list.
- `tests/unit/modules/address-dedup/duplicateAnalysisQuery.test.ts`: added "group with no REMOVE row because every removable member is HAS_INTERNAL_UNITS ... default REMOVAL_GROUPS" (3 rows visible); replaced the old "should leave the group out under REMOVAL_GROUPS (the v3 gap, pinned)" with "should list a KEPT_ALONGSIDE_PROTECTED-only group under the default REMOVAL_GROUPS scope".
- `groupFilters.test.ts`: added all-HAS_INTERNAL_UNITS/no-REMOVE group case (toggles in under reviewOnly, hasReviewRows true).
- `summaryView.test.ts`: added reviewCount case for a group with no REMOVE member.

Deviation to confirm: the old v3-gap test asserted the lone-ANTEL+IDE group is EXCLUDED under REMOVAL_GROUPS. That pinned the very behavior F1 calls a latent bug, so I inverted it (not weakened to pass: the spec changed per brief). Brief said "Commit" under out-of-scope text; did NOT commit.

Gauntlet (portable node)
- modules:routes:check: PASS (up to date, 10 files)
- lint: PASS (no output, 0 problems)
- test: PASS 46 files / 555 tests
- build: PASS
- doctor: PASS "No issues found", score 100
- test:e2e: PASS 49/49

Live numbers: I could not run against prod. The 49 groups / 248 rows being visible in the dashboard is UNVERIFIED in the UI; only covered by pglite unit tests and mocked e2e. Orchestrator should re-check against pg-prod. Docs (`docs/tools/ADDRESS_DEDUP_MODULE.md`) not touched this round; check whether it describes REMOVAL_GROUPS as REMOVE-only.


---

## Brief 8 report

Status: DONE. Branch `feat/address-dedup-kpi-drilldown` cut from the tip of `fix/address-dedup-internal-units` (tree was clean; deviation authorised by caller). Not committed.

Changes (all under `src/modules/address-dedup/ui/` unless noted):
- `useDedupGroupFilters.ts`: `applyPreset` (wholesale `setCriteria` + `resetView(1)`); `updateCriteria` unchanged.
- `DedupResultsView.tsx`: `handleKpiSelect` (applyPreset + switch to `DedupTab.GROUPS`), passed as `onKpiSelect`.
- `DedupSummaryTab.tsx`: forwards `onKpiSelect` to `DedupKpiCards` only.
- `DedupKpiCards.tsx`: per-card `onClick`; module-level `REMOVE_PRESET`/`KEEP_PRESET`/`REVIEW_PRESET` built from `EMPTY_CRITERIA`/`DecisionFilter`; Grupos/Filas use `EMPTY_CRITERIA`.
- `DedupKpiCard.tsx`: optional `onClick`; renders `<button type="button">` when set, else the same `<div>` as before.
- `DedupKpiCard.module.css`: `.clickable` (reset, hover with `--bg-card-hover` + lift, `:focus-visible` outline in `--accent-cyan`). No transition added (`glass-panel` already has one).
- `tests/e2e/flows/address-dedup.spec.ts`: 4 new tests (A eliminar preset -> 4 groups; Para revisar preset -> 2 groups; Para revisar then A eliminar replaces, not merges; Grupos card clears the review filter).
- `docs/tools/ADDRESS_DEDUP_MODULE.md`: new "KPI drill-down" subsection.

Gauntlet (portable node v24.19.0):
- modules:routes:check: PASS (up to date, 10 route files)
- lint: PASS (eslint, no output, exit 0)
- npm test: PASS (46 files, 555 tests)
- build: PASS
- doctor: PASS ("No issues found!")
- test:e2e: PASS (53 passed)

Deviations: base branch as instructed above. No docs/issues file (feature, not bug).
Notes: edited files were rewritten with LF line endings by my script; git reports LF->CRLF warnings only (autocrlf), diff stat is small. Nothing else left undone.


---

## Brief 9 report

Status: DONE (all of Brief 9 plus the addendum). Branch `feat/address-dedup-removal-execution`, cut from the tip of `feat/address-dedup-kpi-drilldown` (tree was clean except the `TO_IMPLEMENTER.md` addendum edit, which carried over). Nothing committed. Nothing was run against any real database: pglite only, all tests hermetic.

### What was built
Backend (all under `src/modules/address-dedup/`):
- `removalConstants.ts`, `removalTypes.ts`: removal constants (tables, blocker reasons, the 9 locked tables, audit table name, advisory namespace, pending text, flow phases) and types.
- `domain/removal.ts`: `RemovalRefusedError`, `assertConfirmation`, `assertExecutable` (blockers, empty plan, fingerprint), `assertTargetsInScope`, `assertDeletedMatchesPlan`, `buildBlockers`.
- `services/queries/removalPlanQuery.ts`: ONE statement: the analysis query embedded as a CTE, REMOVE targets, per-target guards, snapshot, `md5` fingerprint.
- `services/queries/resolveRemovalPlan.ts`: the single shared resolution function (simulate and execute both call it) plus the `pg_catalog` master-reference scan.
- `services/queries/removalExecution.ts`: 9-table lock, global guard, locking of referencing tables, ordered deletes with a per-table count check.
- `services/queries/removalAudit.ts`: advisory lock, replay lookup, lazy `CREATE TABLE`, audit insert.
- `services/queries/mapRemovalRow.ts`, `services/runInTransaction.ts`, `services/RemovalRepository.ts`, `services/PgRemovalRepository.ts`.
- `services/DedupOrchestrator.ts`: `simulateRemoval` / `executeRemoval`. The constructor now takes the removal repository as a REQUIRED second argument.
- `api/removalHandlers.ts`, `api/httpResponses.ts`, `api/requestReaders.ts`, `api/handlers.ts`: new handlers `simulateRemoval`/`executeRemoval`; the response helpers and body readers of `api/handlers.ts` were moved (verbatim) into the two new files so the removal handlers share them without an import cycle.
- `module.routes.json`, `manifest.ts`, generated `src/app/api/m/address-dedup/removal/{simulate,execute}/route.ts` (via `npm run modules:routes`).
- One-word change in `services/PgAddressRepository.ts`: `createPgClient` is now `export`ed so the removal repository reuses the same client factory. `runDuplicateAnalysis` and its read-only transaction are untouched.
- `constants.ts`: `REMOVE_REASONS`; `data/dedupLabels.ts` `REASONS_BY_DECISION[REMOVE]` now reads it (same three values).

UI: `domain/removalFlow.ts` (pure reducer), `data/removalLabels.ts`, `ui/operationId.ts`, `ui/useDedupRemoval.ts`, `ui/DedupRemoval{Panel,Dialog,Form,PlanView,ResultView,Reminder}.tsx` + CSS modules, `dedupClient.ts` (two calls), wiring in `DedupSummaryTab`, `DedupResultsView`, `DedupDashboard`.

Docs: `docs/tools/ADDRESS_DEDUP_MODULE.md`, new section 6 "Removal (the write path)".

UI placement (your call, as the brief allowed): a panel under the KPI cards on the Resumen tab, not the Grupos toolbar and not the "A eliminar" KPI (that KPI is now a drill-down button, and the Grupos toolbar is filter state; the removal always acts on the whole fresh REMOVE set, never on the filter). Flow: "Confirmar y eliminar" opens a dialog, responsable + motivo, "Simular baja", plan view (total, by fuente, rows per table, fingerprint, blockers), then a SEPARATE "Ejecutar eliminación" (disabled while blockers exist or total is 0). The result view shows counts deleted, operation id and a permanent reminder (also shown on the plan view) that Solr removal and the materialized-view refresh are manual (wording of `carto.baja_direccion` plus an explicit sentence).

### What the scope check actually enforces (exact)
1. No request field can name an address. Handlers build the orchestrator request ONLY from connection, provinceId, protectedSiblingRemovesLone and (execute) operationId/responsable/motivo/expectedFingerprint. Test: a body carrying `urns`, `addressIds`, `decision`, `scope` reaches the repository with none of them (`removalHandlers.test.ts` asserts the exact key sets and that the urn string is absent from the request).
2. The target set is computed in `REMOVAL_PLAN_SQL` from a fresh run of the exact `DUPLICATE_ANALYSIS_SQL` (embedded as a CTE, trailing `;` stripped, same `$1..$8`): a urn is a target only if EVERY analysis row carrying it satisfies `decision = 'REMOVE' AND fuente = ANY(removable)` (`HAVING bool_and(...)`). HAS_INTERNAL_UNITS and KEPT_ALONGSIDE_PROTECTED rows are KEEP in that query, so they cannot enter `targets`. Not a flag, not a default.
3. `has_foreign_reason`: per target, `decision_reason <> ALL(the three REMOVE reasons)`; the JS side throws (`assertTargetsInScope`) if the count is non-zero. HONEST CAVEAT: with the current analysis SQL this can never be non-zero (REMOVE is defined by those same three reasons), so it is a tripwire against a future edit of the decision CASE; I could only unit-test the assertion function, not provoke it from data.
4. Deletes use the ids/masters/urns returned by that same fresh query inside the execute transaction; nothing from the request. Each DELETE count must equal the plan's count for that table or the transaction rolls back.
5. The write is unreachable without a matching fingerprint: `deleteRemovalTargets` is called only after `assertExecutable(resolved.plan, expectedFingerprint)` passes (no blockers, total > 0, recomputed fingerprint equals the confirmed one). Before that point the only statements are BEGIN, SETs, advisory lock, audit-table lookup, LOCK TABLE, the guard SELECTs and the plan SELECT.

Tests that pin this (pglite, real SQL): the plan contains only REMOVE rows and its snapshot contains none of the HAS_INTERNAL_UNITS/kept urns; execute with a hand-crafted RepositoryRequest carrying `urns/addressIds/masterIds/decision` of the internal-units door deletes nothing of it (its address, master, iaap and internal_address survive) and the internal urn never appears in any bound statement value; every DELETE's bound values equal exactly the two REMOVE rows' ids/masters/urns.

### Guards from the reference: ported vs NOT ported
Ported (simulate returns them as `blockers` with urn + reason list; execute throws with zero writes while any exists; no silent skipping; the unblocked remainder is never deleted):
- non-blank urn (URN_BLANK);
- exactly one address + master (URN_NOT_FOUND, URN_AMBIGUOUS, which also covers "another master with the same urn");
- master not shared by another address (MASTER_SHARED);
- door means an access_point row (NOT_A_DOOR) and not also an internal_address (IS_INTERNAL);
- no internal_address_access_point row with id_access_point = door (HAS_INTERNAL_UNITS);
- door not itself an internal of another door (LINKED_AS_INTERNAL, my addition, from the iaap.id_internal_address delete predicate);
- dynamic catalog scan of every other `carto` table (relkind r/p) with `id_address_master` / `address_master_id` / `addresses_master_id` (MASTER_REFERENCED, detail `schema.table (column)`); those tables are also locked SHARE ROW EXCLUSIVE in execute BEFORE they are scanned.
Also ported: 9-table SHARE ROW EXCLUSIVE lock, comments_address / plural_entity_access_point global abort, advisory xact lock, replay semantics and message, fingerprint-mismatch abort, same-transaction audit, delete order, `lock_timeout 5s`, READ COMMITTED, non-blank operation/responsable/motivo/huella.

NOT ported, and why:
- Numeric reference (id) resolution: Brief 9 resolves by URN only.
- Id expansion to "door + its internals", "relation points at a missing internal_address", "internal related to ANOTHER door": moot, because any door with ANY iaap row is blocked outright (internals are out of scope), so there is never an internal set to expand or cross-check.
- "internal_address ids unique" and "access_point row only for the door": moot without internals; door-also-internal is IS_INTERNAL.
- The set-level `cardinality(masters) = cardinality(ids) = cardinality(urns)` check: replaced by its per-urn equivalent (each target urn must resolve to exactly one master and one address, and the master must not be shared). I believe per-urn implies the set-level check but did not write a separate one. Say so if you want it literal.
- The `search_path = pg_catalog, carto` function setting: not applicable (no function). Everything table-like is schema-qualified `carto.*`; unqualified built-ins (`md5`, `format`, `hashtext`, `quote_ident`, `to_regclass`) rely on `pg_catalog` being implicitly first. Low risk, stated.
- The advisory-lock key is the addendum's `carto.address-dedup.removal`, NOT `carto.baja_direccion`, so this app and a concurrent `carto.baja_direccion(...)` call do not serialise on the advisory lock; they still serialise on the shared table locks.
- The `referencia` / `incluir_internas` audit columns: replaced by a `parametros` jsonb.
- A `current_setting('transaction_isolation')` assertion: the explicit `BEGIN ISOLATION LEVEL READ COMMITTED` sets it; no extra check.
- simulate takes NO locks: Postgres refuses `LOCK ... SHARE ROW EXCLUSIVE` in a READ ONLY transaction, so simulate's blocker view is not lock-protected; execute re-checks everything under lock.

### Final audit-table DDL
`carto.cgeo_2192_baja_masiva_operacion`, created ONLY when `to_regclass` says it is missing (I deliberately avoid `CREATE TABLE IF NOT EXISTS`, which checks schema CREATE privilege even when the table exists):

```sql
CREATE TABLE carto.cgeo_2192_baja_masiva_operacion (
  operacion uuid PRIMARY KEY,
  huella text NOT NULL,
  responsable text NOT NULL,
  motivo text NOT NULL,
  parametros jsonb NOT NULL,
  ejecutor_bd text NOT NULL DEFAULT current_user,
  resultado jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
)
```

RISK for you: I do not know the shape the CGEO-2192 script gives this table. If that script created it first with different columns (especially no `parametros` / `snapshot`), the replay lookup or the audit INSERT fails. The whole transaction then rolls back, so it fails SAFE (nothing deleted), but the feature is unusable until the shapes agree. Please compare against `CGEO-2192/prod/v3/delete_removal_candidates.sql` before any real run. The table is created lazily right before the audit insert, inside the same transaction, so an aborted run creates nothing.

### What pglite cannot faithfully model (untested)
- Concurrency of any kind: `LOCK TABLE ... SHARE ROW EXCLUSIVE` and the locks on referencing tables are issued and asserted (statement text and order) but never contended; `lock_timeout` never fires; `pg_advisory_xact_lock` is issued but never blocks (single session), so two concurrent executes of one operation id are not exercised.
- READ COMMITTED interleaving (another session committing between my statements). `BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE` is asserted as the first statement; behaviour under contention is not.
- Read-only enforcement by the server: I assert simulate sends `BEGIN READ ONLY`, no write/LOCK statement, and zero row changes, but did not try to make Postgres reject a write inside it.
- The dynamic catalog scan only runs against a toy schema (one extra table I create); real `carto` has more tables, partitions (relkind p), odd column types (the `col::text` cast) and permissions.
- Real column types: fixtures use int ids; prod ids may be bigint (arrays are cast `::bigint[]` and ids kept as strings in JS to stay safe) but this was not run against bigint.
- Real `carto.v_address_build`, real scale (thousands of targets in array params, snapshot jsonb size in the audit row), `statement_timeout`, privileges (CREATE TABLE in carto, DELETE grants), triggers/FKs of the real schema, `current_user`.
- The HAS_INTERNAL_UNITS blocker (iaap.id_access_point = door) is unreachable from data: the analysis flags the same join as HAS_INTERNAL_UNITS (KEEP) first, so such a urn never becomes a target. It is implemented and documented but NOT independently tested; the other eight blockers each have a test that makes them fire.

### Deviations / decisions to confirm
1. The simulate/execute requests also accept optional `protectedSiblingRemovesLone` (same validation as `analyze`). The addendum lists the request fields "only"; without the toggle the plan would silently differ from what a user who ticked "Elimina duplicados de IDE" saw in the dashboard. It only changes which rows are REMOVE (still REMOVE-only, still server-derived). Easy to drop if you disagree.
2. Execute order: advisory lock, replay lookup, THEN table locks (per the addendum: lookup right after the advisory lock). Brief 9's step list has the locks first. The replay path therefore locks no business table.
3. The orchestrator constructor's second argument is required; I updated the 7 `new DedupOrchestrator(...)` call sites in two existing test files to pass a `FakeRemovalRepository` (constructor arguments only, no assertion touched).
4. UI copy that said "Solo lectura" (dashboard description, home card, manifest description) is no longer true; reworded.
5. The server answers a deliberate refusal (fingerprint drift, blockers, replay with other params, comments/plural guard) with HTTP 409; validation with 400; anything else 500, password scrubbed from every message (tested).
6. `operationId` is generated by the browser per dialog open (`crypto.randomUUID`, with a `getRandomValues` fallback for plain http), kept across a failed execute (so a retry is idempotent) and regenerated on "Volver a simular". The server generates one only if absent. A failed execute leaves the user on the plan view with the error and the button still enabled.
7. The snapshot is stored in the audit row and NOT returned to the browser (it can be large); the simulate response is fingerprint + counts + blockers.
8. Noticed but left alone: `PgAddressRepository` and `runInTransaction` now duplicate ~15 lines of connect/begin/close logic (I did not touch the read path, as instructed); the new removal e2e spec duplicates two small helpers from the existing dedup spec instead of refactoring it. Partial/selective removal is only noted as a later idea in the docs.

### Tests
New files:
- `pgRemovalRepository.test.ts` (37, pglite, real SQL):
  - simulate: plan is REMOVE-only with a HAS_INTERNAL_UNITS row in the mix; per-table counts; fingerprint determinism and sensitivity; read-only / rolled back / no writes; empty plan; six parametrised blocker cases (shared master, not a door, is internal, linked as internal, urn not found, ambiguous urn) plus MASTER_REFERENCED, and an unrelated referenced master not blocking.
  - execute: deletes exactly the planned rows of the 7 tables and leaves the review rows; audit row contents; exact statement order (BEGIN READ COMMITTED, lock_timeout, advisory lock before the audit lookup, LOCK TABLE of all 9, catalog scan, plan, 7 DELETEs in order, audit INSERT, single COMMIT, no ROLLBACK); separate connection from simulate; referencing tables locked before the scan; drift between simulate and execute throws with zero writes, no audit table and ROLLBACK; replay with the same id returns the stored result and deletes nothing even with a new candidate present; replay with different responsable/motivo/toggle throws; comments_address / plural_entity_access_point row throws before any DELETE; blockers plus a correct fingerprint refuse and delete none of the remainder; empty plan refused; hand-crafted request cannot delete the HAS_INTERNAL_UNITS door; DELETE bound values are exactly the resolved ids; a trigger that makes the 6th delete fail rolls back the 5 earlier ones; reuse of a pre-existing audit table; invalid confirmation refused before any connection is opened.
- `removalDomain.test.ts`, `removalHandlers.test.ts` (validation 400s, snapshot not leaked, only whitelisted fields forwarded, server-generated id, 409 vs 500, password scrubbing), `removalOrchestration.test.ts`, `removalFlow.test.ts` (18; execute unreachable from the form, only reachable through a simulation, blocked/empty plans never executable, in-flight guard, restart/close/reopen), `fakeRemovalRepository.ts` (helper).
- `pgliteHarness.ts` extended (access_point, internal_address, territorial_unit_access_point, compact_address, comments_address, plural_entity_access_point tables; door/internal-unit helpers; a statement-recording pglite client).
- `addressDedupManifest.test.ts`: one test added (removal endpoints are POST-only). Existing tests: no assertion changed or removed.
- e2e `tests/e2e/flows/address-dedup-removal.spec.ts` (9, API mocked) with `fixtures/dedupRemovalFixtures.ts`: dialog opens with no request made and no "Ejecutar" button; simulate stays disabled until responsable AND motivo are non-blank; simulate then a SEPARATE execute click (simulate called once, execute zero times until the click); the execute body carries the simulated fingerprint, the confirmation, a UUID operationId and exactly the whitelisted keys (no address list); blocked plan disables execute and lists the reasons; a 409 shows the message and "Volver a simular" returns to the form; cancel after simulate executes nothing; reopening starts clean; the action is disabled when the analysis has no REMOVE rows. One initial failure was the suite's console-error guard on the mocked 409 ("Failed to load resource"); fixed with the suite's own `allowConsoleErrors` in that one test.
- Note on my own authoring: my first expectation for "master shared" (only MASTER_SHARED) was wrong; a shared master correctly also fires URN_AMBIGUOUS and NOT_A_DOOR (the second address has no access_point). I corrected my new test to the true behaviour; the code was right.

### Gauntlet (portable node `C:\Alekos\Tools\node24portable`, final run after the last code change)
- `npm run modules:routes:check`: PASS, "Generated module routes are up to date (12 route file(s))."
- `npm run lint`: PASS, 0 errors, 0 warnings (an unused-variable warning in one of my own tests was fixed first).
- `npm test`: PASS, "Test Files 51 passed (51)" and "Tests 647 passed (647)".
- `npm run build`: PASS, "Compiled successfully"; route table lists `/api/m/address-dedup/removal/execute` and `/removal/simulate`.
- `npm run doctor`: PASS, "Score: 100 / 100", "No issues found!" (it flagged one `js-set-map-lookups` in my first `buildBlockers`; refactored to a Map/Set index and re-ran).
- `npm run test:e2e`: PASS, "62 passed (39.9s)" (53 existing + 9 new).
- Pre-existing failures: none observed.

### Not done / follow-ups
- Not run against any real DB, by instruction. Before first real use: verify the audit-table shape against the CGEO-2192 script, and run simulate against dev to compare the REMOVE count with the raw script's.
- No `docs/issues/` file (feature, not a bug). Nothing committed.


---

## Brief 9 fix round 1 report

Status: DONE (all six items). Branch `feat/address-dedup-removal-execution`, nothing committed, pglite only, no real database touched, read-only analysis path (`PgAddressRepository` / `runDuplicateAnalysis` / `DUPLICATE_ANALYSIS_SQL`) untouched.

### Correction to the Brief 9 report
The "Uncertainties" line claiming ids "are kept as strings in JS" was wrong at the time: `to_jsonb(bigint[])` emitted JSON numbers, so `JSON.parse` rounded anything above 2^53 before `mapRemovalRow.toIdList` could stringify it. Fixed in this round (item 1); the original line is left as is.

### Changes
1. Ids as strings (F3). `removalPlanQuery.ts`: `address_ids`, `master_ids` and the per-verdict `masterIds` now `to_jsonb(...::text[])`. `mapRemovalRow.ts` unchanged in behaviour (`String(entry)`), comment added. Deletes still bind with `::bigint[]`. Harness columns changed to `bigint`/`bigserial`. Test: ids 9007199254740992 (kept neighbour) and 9007199254740993 (target); the delete removes exactly ...993, ...992 survives in address and addresses_master, and the DELETE calls receive `["9007199254740993"]`.
2. Protected sources (F1), `pgRemovalRepository.test.ts`: (a) IDE+ANTEL+TLK, toggle off: plan = TLK only, IDE and the lowest-urn ANTEL survive in addresses_master, address, access_point, territorial_unit_access_point and compact_address; (b) toggle on: targets = ANTEL+TLK, IDE survives in all tables; (c) the ANTEL row is asserted KEPT_ALONGSIDE_PROTECTED by the real analysis and absent from targets and snapshot.
3. Audit-table shape (F2). `removalAudit.assertAuditTableUsable` reads `information_schema.columns`; if the table exists and misses any of `AUDIT_REQUIRED_COLUMNS` it throws `RemovalRefusedError("La tabla de auditoria carto.cgeo_2192_baja_masiva_operacion existe con otra estructura; faltan columnas: parametros, ejecutor_bd, snapshot.")` (HTTP 409 through the existing mapping). Called in execute right after the advisory lock (before the replay lookup, any table lock and any delete) and in simulate before the plan. Tests: execute throws, all seven tables unchanged, no DELETE/LOCK/INSERT issued, ROLLBACK last; simulate throws before the analysis statement. Existing "reuse audit table" test (full shape) still green.
4. Length caps. `RESPONSABLE_MAX_LENGTH = 120`, `MOTIVO_MAX_LENGTH = 1000` in `removalConstants.ts`; validated in `removalHandlers.ts` after trim (400, Spanish message naming the limit); `FormField` (ui-kit) gained an optional `maxLength` prop and `DedupRemovalForm` passes both. Tests: handler boundary max accepted / max+1 rejected for both fields (it.each); e2e asserts the `maxlength` attributes.
5. Known limits documented in `docs/tools/ADDRESS_DEDUP_MODULE.md` ("Known limits": infra-match tables not locked, pglite cannot model locks, no Solr/MV refresh). No locks added.
6. URN list. SQL: new `target_list` column built from the same `targets` CTE that `target_count` counts, `ORDER BY urn COLLATE "C"`. `RemovalPlan.targets` / `RemovalSimulationPayload.targets: {urn, fuente}[]`, mapper, handler payload, `dedupClient` types. Execute does not accept it (the existing "no address list" handler and e2e body-key tests are green unchanged). UI: new `DedupRemovalTargetList.tsx` + CSS module, rendered inside `DedupRemovalPlanView` (review step only): count header, one read-only `<textarea>` (urn, tab, fuente per line), "Copiar URN" (newline-separated urns) and "Descargar CSV". Pure builders in `domain/removalPlanExport.ts` (CSV with header and CRLF, reusing `escapeCsvCell`/`CSV_LINE_BREAK`, now exported from `domain/export.ts`; filename `address-dedup-removal-plan-<provinceId>-<fingerprint[0..8]>.csv`). Blob download extracted to `ui/downloadBlob.ts` (revokes the URL after the click) and reused by `downloadExport`.

### Tests added
- `pgRemovalRepository.test.ts`: targets (only REMOVE, sorted with a text-vs-numeric order case, count = `counts.total`, equals snapshot urns and byFuente, kept/HAS_INTERNAL_UNITS urns absent), empty targets, 3 protected-source cases, 2 bigint cases, 2 audit-shape cases.
- `removalPlanExport.test.ts` (new): CSV header/CRLF, empty, quoting, URN text, filename.
- `removalHandlers.test.ts`: payload now includes `targets`; length-cap boundaries.
- `address-dedup-removal.spec.ts`: new test: list hidden before simulate, visible in review, readonly, count equals `removal-total`, line urns equal the fixture, copy puts the urns on the clipboard, download name and content match, nothing executed; new test for `maxlength`.
- Fixtures/fakes updated for `targets` (`fakeRemovalRepository.ts`, `dedupRemovalFixtures.ts`, `removalFlow.test.ts`).
- One existing e2e assertion made stricter-compatible, not weaker: the blocked-plan test's `getByText("cgeo:Antel:address:id:102")` now uses `{ exact: true }` because the target textarea legitimately contains that urn too (strict-mode violation otherwise); it still asserts the blocker code element is visible.

### Gauntlet (portable node 24.19.0)
- `npm run modules:routes:check`: PASS, "Generated module routes are up to date (12 route file(s))."
- `npm run lint`: PASS, eslint no output after the run header.
- `npm test`: PASS, `Test Files 52 passed (52)`, `Tests 666 passed (666)` (run after all unit/test code was in place).
- `npm run build`: PASS, route table lists `/api/m/address-dedup/removal/execute` and `/removal/simulate`.
- `npm run doctor`: PASS, `Score: 100 / 100`, "No issues found!".
- `npm run test:e2e`: PASS, `64 passed (39.5s)` (first run had 2 failures from my own new test and the strict-mode locator described above; fixed, rerun green).

### Unverified / plainly stated
- Nothing was run against a real Postgres: bigint round trip, `information_schema` check and `COLLATE "C"` are verified on pglite only. The real `pg` driver returns bigint as strings anyway, and `::bigint[]` binds are unchanged.
- Remaining precision gap (documented in the module doc): the snapshot jsonb is parsed with `JSON.parse` and re-serialised into the audit row, so a bigint beyond 2^53 inside the STORED snapshot (not the ids used for delete, not the fingerprint, which is md5 in SQL) would be rounded. Fix would be to carry the snapshot as text; left alone as out of scope.
- The target list is capped nowhere: for a very large set the response and textarea grow linearly (a few thousand rows is fine by design).
- Clipboard e2e normalises `\r\n` to `\n` because Chromium on Windows returns CRLF from `readText`.


---

## Brief 9 fix round 2 report

Status: DONE. Not committed. pglite only; no real database touched.

### Changes
- `removalConstants.ts`: `AUDIT_TABLE` = `carto.baja_direccion_operacion`; `AUDIT_REQUIRED_COLUMNS` = the 9 real columns. Old table name and all DDL removed.
- `domain/removal.ts`: `buildRemovalReference(parameters)` -> `address-dedup:province=<id>;protectedSiblingRemovesLone=<bool>`.
- `removalTypes.ts`: `RemovalAuditRecord` (result + provinceId + protectedSiblingRemovesLone + targets) = the `resultado` payload.
- `services/queries/removalAudit.ts`: rewritten. No CREATE anywhere. `assertRemovalPreconditions` (table exists, 9 columns, SELECT+INSERT on audit table via `has_table_privilege(current_user,...)`, DELETE on the 7 deletion tables) with Spanish 409 `RemovalRefusedError`s. Insert = the 8 columns `baja_direccion` inserts (`ejecutor_bd` = `current_user`, `incluir_internas` false, `creado_en` default). Replay compares referencia / incluir_internas / huella / responsable / motivo; returns the stored result with `recovered: true` (only the 7 `RemovalResult` fields, scope/targets not leaked).
- `services/PgRemovalRepository.ts`: simulate calls the preconditions before resolving the plan; execute calls them after the advisory lock and before the idempotency lookup, lock tables and any delete.
- `tests/.../pgliteHarness.ts`: creates `carto.baja_direccion_operacion` with the real shape in schema and on every reset (drop + create).
- `tests/.../pgRemovalRepository.test.ts`: see below.
- `docs/tools/ADDRESS_DEDUP_MODULE.md` section 6: new audit table, prod prerequisite with the DDL, preconditions, row contents, execute step list renumbered, "shared with CGEO-2192" language removed, stored-snapshot caveat removed.

### Tests (all in pgRemovalRepository.test.ts)
- Re-pointed at the new table (not weakened): rollback/drift/empty-plan cases that asserted "audit table absent" now assert `countRows(AUDIT_TABLE) === 0` (the table always exists now); ordering test greps `INSERT INTO carto.baja_direccion_operacion`.
- One existing assertion adjusted: the simulate read-only test's write-statement regex now ignores the two `has_table_privilege` SELECTs, whose text contains the words INSERT/DELETE as privilege names. Still asserts no real DELETE/INSERT/UPDATE/LOCK/COMMIT/CREATE.
- Removed the "reuse the audit table when CGEO-2192 created it first" test (concept deleted).
- New: audit row exact values (referencia string, incluir_internas false, ejecutor_bd, huella, creado_en, full `resultado` equality incl. counts, deletedByTable, sorted targets, pending message, no snapshot); missing table -> execute and simulate refuse with exact message, zero writes, no statement matching /CREATE/i; no CREATE on a successful run either; missing columns -> refusal naming them (execute and simulate); replay refused with different fingerprint, province, toggle, responsable, motivo.
- Privileges: fake scripted client asserts the exact privilege statements/params, they run before the first LOCK, and refusal (SELECT, INSERT, both, DELETE on named tables, and simulate) issues no DELETE/LOCK/INSERT/CREATE/analysis. Plus real pglite roles (`CREATE ROLE app_limited` + `SET ROLE`): missing INSERT refused, missing DELETE on `carto.compact_address` refused, tables unchanged.

### Gauntlet (portable node)
- `npm run modules:routes:check`: PASS ("Generated module routes are up to date (12 route file(s))")
- `npm run lint`: PASS (no output)
- `npm test`: PASS, 52 files, 678 tests
- `npm run build`: PASS (removal routes listed)
- `npm run doctor`: PASS ("No issues found!")
- `npm run test:e2e`: PASS, 64 passed. No e2e/mock text mentioned the old table or "se crea la tabla", so none changed.

### Unverified / notes
- pglite runs as superuser `postgres`; the role tests do exercise `has_table_privilege` for real, but column-level grants, ownership, PUBLIC grants, `ALTER DEFAULT PRIVILEGES` and the real prod role setup are not modelled. `has_table_privilege` on a table the role cannot even see (no schema USAGE) would error rather than return false; that surfaces as a 500, not a 409.
- Privilege check is not a guarantee: a trigger or RLS on the deletion tables could still fail at delete time (rolls back, zero writes).
- Locks, advisory lock, READ COMMITTED and the dynamic catalog scan remain untested for concurrency (unchanged from round 1).
- Stored `resultado.targets` can be thousands of urns (jsonb); size not benchmarked.
- Brief 9 / fix round 1 reports above still describe the old `cgeo_2192_baja_masiva_operacion` table; superseded by this round, history not rewritten.
- Helper scripts used a scratchpad outside the repo; CGEO-2192 files untouched.

---

## Brief 10 report — simulate speed: set-based master_shared (branch `fix/address-dedup-removal-simulate-speed`, uncommitted)

Status: DONE.

Changes
- `src/modules/address-dedup/services/queries/removalPlanQuery.ts`: new CTE `master_address_counts` (count(DISTINCT address_id) per master over `resolved`); `verdicts` now LEFT JOINs it and uses `coalesce(bool_or(mac.address_total > 1), false) AS master_shared`. No subquery against `carto.address` remains in `verdicts`. Doc comment updated.
- `src/modules/address-dedup/services/queries/resolveRemovalPlan.ts`: `findReferencedMasters` now filters `col = ANY($1::bigint[])` (param side cast, column side untouched, so an index can be used); `::text` kept only on the SELECT output so ids still leave as strings.
- `tests/unit/modules/address-dedup/removalPlanMasterShared.test.ts` (new, 7 tests): sibling blocks MASTER_SHARED; several siblings; single-address master not flagged; shared + unshared together flag only the shared; both targets shared both flagged; byte-identical fixture (fingerprint `a2dc54a0d81c231bbaaba14c21f56a68`, counts, blockers, targets) captured from the OLD SQL before any edit and passing on the new one; structural test (no `FROM carto.address other` / correlated address subquery, `master_address_counts` present).

Other per-row scan audit: remaining correlated EXISTS hit `access_point` (pk), `internal_address`, `internal_address_access_point` (about 3.8k rows, unindexed) - left as the brief said. `snapshot_doc` and the rows_by_table counts are single `= ANY(...)` passes. Simulate and execute share `resolveRemovalPlan`; nothing else differs. Existing tests untouched and green.

Gauntlet (portable node)
- modules:routes:check: PASS (12 route files up to date)
- lint: PASS (no output)
- test: PASS 53 files / 685 tests
- build: PASS
- doctor: PASS (No issues found)
- test:e2e: PASS 64 passed

Deviations / notes
- Brief asked "two targets sharing one master" test: a master maps to exactly one urn (m.urn = t.urn), so two targets cannot share one master. I tested the closest real cases: several sibling rows on one master, and two targets each with a shared master (both flagged).
- Edge equivalence reasoned: master with no address rows gives address_total 0 (not shared); NULL master gives no join match (not shared); same as old EXISTS.
- The `::bigint[]` cast assumes the scanned columns are integer/bigint (per brief). A text-typed `id_address_master`-like column in some table would now error instead of match; pglite cannot show that.

Could NOT measure: no real DB used, so the actual speedup (10.3 s per 100 targets before; expected near-constant after) is unverified. pglite tests prove equivalence of results only. Suggest running simulate against DEV and a one-off EXPLAIN ANALYZE to confirm the SubPlan on `address other` is gone and that an `address` hash/seq scan runs once.
