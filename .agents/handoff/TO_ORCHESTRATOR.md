# Implementer Hand-off: Playwright UI Characterization Safety Net (Fix Round 2)

> **Mission**: Build an exhaustive, resilient Playwright characterization test safety net for the large sync tools and `ComparisonResultsView` (the "God components") prior to any decomposition or refactoring.  
> **Branch**: `test/ui-characterization`  
> **Status**: **COMPLETE & VERIFIED** (All 8 quality gates green, 22/22 E2E specs passing, 0 bytes modified under `src/`)

---

## 1. Fix Round 2 Resolution (Items H1 – H10)

All items from Claude's review (Fix Round 2) have been implemented and verified:

| Item | Severity | Description | Resolution Details |
|---|---|---|---|
| **H1** | **MAJOR** | Tab mutual exclusion is never asserted | Added explicit `toBeHidden()` assertions in `tests/e2e/flows/comparison-results.spec.ts`: after switching to SQL tab, asserted `page.getByRole("table").toBeHidden()`; asserted `insertPre.toBeHidden()` when `updatePre` is visible; asserted `updatePre.toBeHidden()` when `insertPre` is visible; and asserted `sqlTabPanel.toBeHidden()` and `page.getByRole("table").toBeVisible()` upon returning to the table tab. |
| **H2** | **MAJOR** | Map tab and its subtree are unreached | Added 6th spec in `tests/e2e/flows/comparison-results.spec.ts` navigating to Step 5 of the shapefile tool, clicking the "Mapa de Discrepancias Espaciales" tab, asserting the map container is visible (`getByText(/MAPA DE DISCREPANCIAS ESPACIALES/i)` and `getByRole("combobox", { name: /Seleccionar mapa base/i })`) and the discrepancies table is hidden (`toBeHidden()`). Then filtered by the "Solo en Base de Datos" KPI card (where spatial geometries are null in the fixtures), and asserted the empty-state alert: `"No se encontraron discrepancias para el filtro seleccionado."`. |
| **H3** | **MAJOR** | Step-indicator back-navigation unreached | In `tests/e2e/flows/db-csv-sync.spec.ts`, after reaching Step 3, asserted that step-4 and step-5 stepper items do **not** expose `role="button"`. Then clicked the `"PASO 1"` button on the stepper, asserted that Step 1's heading (`"Configuración de Conexión a Base de Datos"`) mounted, and resumed forward progression. |
| **H4** | **MAJOR** | `db-csv-sync` and `db-db-sync` assert no comparison outcome | 1) In `db-csv-sync.spec.ts`: mapped `suid` as SUID and attributes `departamento`/`codigo`, asserting the descriptor-specific KPI card `"Solo en Archivo CSV"` and the concrete data row `getByRole("cell", { name: "PAD-002" })`.<br>2) In `db-db-sync.spec.ts`: configured a non-degenerate `recordsStream` per `table_name` in `beforeEach` so the target replica differs from the source (`B2_REPLICA_DIFF`), asserting the descriptor-specific KPI card `"Solo en DB Origen"` and the missing source row `getByRole("cell", { name: "3", exact: true })`.<br>3) In `comparison-results.spec.ts`: tightened `/Solo en Archivo/i` to exact `"Solo en Archivo Shapefile"`. |
| **H5** | **MAJOR** | Loading assertion cannot fail on regression | In `comparison-results.spec.ts`, eliminated the loose regex alternation between the two ternary branches and asserted the deterministic `ProgressBar` branch output: `await expect(page.getByText("Conectando a base de datos PostgreSQL...")).toBeVisible()` along with the progress counter `await expect(page.getByText("0%")).toBeVisible()`. |
| **H6** | **MINOR** | Assertions checking labels rather than values | 1) In `cartography-watcher.spec.ts`: replaced label searches and `.first()` calls with exact value assertions (`"4"`, `"Sin novedades"`, `"Al día"`, `"Actualización disponible"`) and scoped definition metrics for `"1 archivo pendiente"`.<br>2) In `mockBackend.ts` / `cartography-watcher.spec.ts`: returned a deterministic fixed title `"Nueva Fuente SIG E2E"` from mock POST `/sources` and asserted that exact title rendering. |
| **H7** | **MINOR** | Untested paths behind unused mock options | 1) Added SQL execution test in `comparison-results.spec.ts` exercising `SqlPatchExecuteButton` -> `SqlExecutionModal` -> mock `/api/db/execute` -> feedback, asserting the `(Ejecutado)` tab marker appears.<br>2) Added Step 1 connection failure test in `db-csv-sync.spec.ts` (`columnsStatus: 500`), asserting error alert rendering with `allowConsoleErrors(/Failed to load resource/)`.<br>3) Pruned unused options (`testDb`, `watcherRemove`, `watcherCatalogFile`) from `MockBackendOptions`. |
| **H8** | **MINOR** | Harness hardening | 1) Refactored `allowConsoleErrors(pattern?: RegExp)` in `testFixture.ts` to filter matching console error messages (default `/Failed to load resource/`) while keeping `pageerror` and unhandled rejections active.<br>2) Added `await page.unrouteAll({ behavior: "ignoreErrors" })` to `mockBackend.ts` to prevent double-registration leaks.<br>3) Fixed `watcherSources` GET handler in `mockBackend.ts` to return mutated `currentSources` instead of the stale initial seed.<br>4) Annotated fixture constants in `watcherFixtures.ts` with real domain types (`WatchedSource[]`, `SourceSummary[]`, `CatalogSourceGroup[]`) imported from `@/modules/cartography-watcher/types`. |
| **H9** | **MINOR** | Report corrections | Corrected `DbConnectionForm` path citation, documented Firefox-only hydration mismatch context, and corrected fixture typing description (detailed in Section 3). |
| **H10** | **NIT** | Harness polish & defect extraction | 1) Fixed comment in `dbFixtures.ts:59` to `'B2_MODIFIED'`.<br>2) Corrected `tests/e2e/README.md` to state that console error checks fire in teardown.<br>3) Pinned `checkedAt` in `watcherFixtures.ts` to historical ISO timestamps (`2024-03-01T10:00:00.000Z`).<br>4) Migrated the remaining inline connect preamble in `cartography-watcher.spec.ts` to `connectDb(page)`.<br>5) Extracted the shared D4 remount defect characterization block into `assertStep1RemountQuirk` in `tests/e2e/support/wizardSteps.ts`. |

---

## 2. Quality Gauntlet Results (Real Output)

All 8 quality gates were executed locally with zero failures:

### Gate 1: Module Routes Staleness Check
```
> gis-tools@0.1.0 modules:routes:check
> node scripts/generate-module-routes.cjs --check

Generated module routes are up to date (7 route file(s)).
```

### Gate 2: Linter (ESLint 9)
```
> gis-tools@0.1.0 lint
> eslint
```
*(Clean run: 0 errors, 0 warnings)*

### Gate 3: Vitest Unit Suite (313 Tests Byte-Identical)
```
> gis-tools@0.1.0 test
> vitest run

 RUN  v5.0.0 C:/Alekos/Projects/gis-tools

 ✓ tests/unit/core/modules/createModuleRegistry.test.ts (21 tests) 16ms
 ✓ tests/unit/scripts/generateModuleRoutes.test.ts (27 tests) 37ms
 ✓ tests/unit/core/modules/createModuleRouteHandler.test.ts (5 tests) 42ms
 ✓ tests/unit/core/modules/defineModuleEndpoints.test.ts (13 tests) 13ms
 ✓ tests/unit/modules/cartography-watcher/catalogMapping.test.ts (14 tests) 9ms
 ✓ tests/unit/modules/cartography-watcher/sourceNaming.test.ts (19 tests) 12ms
 ✓ tests/unit/services/parsers/CsvParserRecordAliasing.test.ts (5 tests) 12ms
 ✓ tests/unit/services/parsers/CsvParser.test.ts (5 tests) 12ms
 ✓ tests/unit/utils/spatial/GeoJsonDatasetBuilder.test.ts (9 tests) 12ms
 ✓ tests/unit/modules/cartography-watcher/sourceOverrides.test.ts (7 tests) 10ms
 ✓ tests/unit/utils/spatial/WktGeometryParser.test.ts (7 tests) 10ms
 ✓ tests/unit/utils/spatial/PolygonRingNormalizer.test.ts (5 tests) 10ms
 ✓ tests/unit/modules/cartography-watcher/deltaEvaluation.test.ts (13 tests) 10ms
 ✓ tests/unit/modules/cartography-watcher/vaultServices.test.ts (25 tests) 461ms
 ✓ tests/unit/utils/spatial/SpatialGeometryComparator.test.ts (6 tests) 7ms
 ✓ tests/unit/utils/common/GisEncodingNormalizer.test.ts (14 tests) 11ms
 ✓ tests/unit/modules/cartography-watcher/formatters.test.ts (12 tests) 8ms
 ✓ tests/unit/modules/cartography-watcher/watcherOrchestration.test.ts (41 tests) 492ms
 ✓ tests/unit/core/modules/definePageContributions.test.ts (7 tests) 11ms
 ✓ tests/unit/hooks/useDiscrepancyGeojson.test.ts (5 tests) 10ms
 ✓ tests/unit/utils/common/GisStringSanitizer.test.ts (8 tests) 9ms
 ✓ tests/unit/core/spatial/FeaturePreviewCap.test.ts (7 tests) 12ms
 ✓ tests/unit/workers/comparison/FileDatasetIndexer.test.ts (3 tests) 7ms
 ✓ tests/unit/workers/comparison/SqlPatchGenerator.test.ts (3 tests) 7ms
 ✓ tests/unit/utils/spatial/EwkbGeometryParser.test.ts (5 tests) 6ms
 ✓ tests/unit/utils/spatial/FeatureRecordIndex.test.ts (7 tests) 7ms
 ✓ tests/unit/workers/comparison/SuidKeyResolver.test.ts (5 tests) 4ms
 ✓ tests/unit/core/common/queryBusyState.test.ts (6 tests) 4ms
 ✓ tests/unit/modules/cartography-watcher/cartographyWatcherManifest.test.ts (9 tests) 6ms

 Test Files  29 passed (29)
      Tests  313 passed (313)
   Duration  2.23s
```
*(Verified: `git diff main -- tests/unit` is completely empty).*

### Gate 4: Coverage Summary (`src/core/**`)
```
> gis-tools@0.1.0 test:coverage
> vitest run --coverage

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |   37.67 |    33.54 |   51.36 |   38.13 |                   
 common            |   62.41 |       50 |   61.11 |   63.23 |                   
 constants         |    2.94 |        0 |       0 |    3.12 |                   
 modules           |   99.25 |    96.42 |     100 |   99.21 |                   
 services/parsers  |   54.76 |    44.95 |   71.42 |   53.89 |                   
 spatial           |   52.87 |    56.16 |   68.75 |   55.29 |                   
 types             |   71.42 |      100 |     100 |   71.42 |                   
 workers/comparison|    33.8 |    24.12 |   41.86 |   34.39 |                   
-------------------|---------|----------|---------|---------|-------------------
```

### Gate 5: Playwright E2E Suite (22 / 22 Passed)
```
> gis-tools@0.1.0 test:e2e
> playwright test

Running 22 tests using 6 workers

[1/22] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:44:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe mantener el formulario abierto, conservar la URL ingresada y mostrar el error si el servidor rechaza la edición
[2/22] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:31:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe agregar una nueva fuente vigilada desde el formulario
[3/22] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:97:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe expandir el árbol del catálogo y filtrar por formato al seleccionar recursos en sync tools
[4/22] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:9:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe listar fuentes vigiladas y sus estados en el dashboard
[5/22] [chromium] › tests\e2e\flows\comparison-results.spec.ts:74:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe filtrar los registros en la tabla al hacer clic en las tarjetas KPI
[6/22] [chromium] › tests\e2e\flows\comparison-results.spec.ts:55:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe cargar la vista de resultados con pestaña por defecto (Tabla) y KPIs de resumen
[7/22] [chromium] › tests\e2e\flows\comparison-results.spec.ts:112:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe alternar pestañas entre Tabla y Script SQL, mostrando el parche generado con exclusión mutua
[8/22] [chromium] › tests\e2e\flows\comparison-results.spec.ts:152:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe alternar a la pestaña de Mapa, visualizar el contenedor y mostrar estado vacío con filtro sin geometrías
[9/22] [chromium] › tests\e2e\flows\comparison-results.spec.ts:174:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe permitir ejecutar el script SQL en base de datos y marcar la pestaña como ejecutada
[10/22] [chromium] › tests\e2e\flows\comparison-results.spec.ts:200:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe mostrar el estado de error cuando la consulta de registros falla
[11/22] [chromium] › tests\e2e\flows\comparison-results.spec.ts:219:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe mostrar el estado de carga mientras se consultan registros y luego mostrar el resumen
[12/22] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:14:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[13/22] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:31:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe bloquear la conexión y mostrar mensaje de validación con campos vacíos
[14/22] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:46:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas
[15/22] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:173:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe mostrar alerta de error cuando el servidor falla al obtener columnas (HTTP 500)
[16/22] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:50:7 › Herramienta: Sincronización DB vs. DB (/tools/db-db-sync) › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[17/22] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:65:7 › Herramienta: Sincronización DB vs. DB (/tools/db-db-sync) › debe validar credenciales requeridas en el paso 1
[18/22] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:77:7 › Herramienta: Sincronización DB vs. DB (/tools/db-db-sync) › debe permitir navegar el flujo completo entre DB Origen y DB Destino (Pasos 1 al 5) y retroceder
[19/22] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:10:7 › Herramienta: Sincronización DB vs. Shapefile (/tools/db-shapefile-sync) › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[20/22] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:37:7 › Herramienta: Sincronización DB vs. Shapefile (/tools/db-shapefile-sync) › debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas
[21/22] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:25:7 › Herramienta: Sincronización DB vs. Shapefile (/tools/db-shapefile-sync) › debe validar credenciales requeridas y bloquear avance en paso 1
[22/22] [chromium] › tests\e2e\smoke.test.ts:7:7 › GIS Tools Application Smoke Tests › should verify app home page loads successfully
  22 passed (20.6s)
```
*(Spec count grew from 19 to 22 specs).*

### Gate 6: Turbopack Production Build
```
> gis-tools@0.1.0 prebuild
> npm run modules:routes

Generated module routes already up to date (7 route file(s)).

> gis-tools@0.1.0 build
> next build

▲ Next.js 16.3.4 (Turbopack)
✓ Compiled successfully in 4.4s
  Running TypeScript ...
  Finished TypeScript in 2.5s ...
  Collecting page data using 11 workers ...
✓ Generating static pages using 11 workers (14/14) in 487ms
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

### Gate 7: React Doctor Diagnostics
```
> gis-tools@0.1.0 doctor
> react-doctor

✔ Scanned 240 files in 8.3s

React Doctor — gis-tools
Score: 100 / 100 Great

✔ No issues found!
```

### Gate 8: Scope Discipline (`src/` Untouched)
```
> git diff main -- src/
```
*(Completely empty: 0 files, 0 lines, 0 bytes modified under `src/` across the branch).*

---

## 3. Report Corrections & Observations (Per Item H9)

1. **`DbConnectionForm` File Citation Correction**:
   - The file path in Round 1 was cited as `src/components/tools/db-sync-common/DbConnectionForm.tsx`.
   - The accurate path in this repository is `src/ui-kit/components/DbConnectionForm.tsx`, with its underlying connection state encapsulated in `src/ui-kit/hooks/useDbConnectionForm.ts`.
2. **Firefox-Only Hydration Mismatch Clarification**:
   - The console guard ran green across all specs; however, as noted in the prompt, the dropped hydration mismatch previously reported in the codebase is specific to Firefox.
   - Because our Playwright configuration executes exclusively against Chromium (`projects: [{ name: "chromium" }]`), the green console guard on this run does **not** indicate that the Firefox hydration defect has cleared. It simply confirms that Chromium exhibits zero console errors during navigation and hydration.
3. **Fixture Types vs Domain Contracts**:
   - In Round 1, fixture shapes in `mockBackend.ts` were described as real contracts while actually relying on circular `typeof DEFAULT_WATCHED_SOURCES[number]` definitions.
   - In Round 2, `watcherFixtures.ts` constants were directly annotated using the official domain model interfaces: `WatchedSource[]`, `SourceSummary[]`, and `CatalogSourceGroup[]` imported from `@/modules/cartography-watcher/types`.

---

## 4. Disclosed Quirks & Bug Characterizations (Per Decision D4)

1. **`watcherClient.ts` Discards Server Error Messages on Non-200 Responses**:
   - **Location**: `src/modules/cartography-watcher/ui/watcherClient.ts:18-30`
   - **Pinned Behavior**: In `cartography-watcher.spec.ts`, non-200 responses throw a generic `Error("${context} (HTTP ${response.status}).")` before reading body text.
2. **`CsvParser.ts` Duplicate SUID Record Aliasing**:
   - **Location**: `src/core/services/parsers/CsvParser.ts:168-175`
   - **Pinned Behavior**: Inserts both `row-${index}` and `record.suid` into `recordsMap`.
3. **Step 1 Wizard Remount & Proceed Guard Quirk**:
   - **Location**: `src/ui-kit/components/DbConnectionForm.tsx` within sync wizard pages.
   - **Pinned Behavior**: Shared defect characterization block extracted into `assertStep1RemountQuirk` in `tests/e2e/support/wizardSteps.ts`. When a user navigates back to Step 1 from Step 2, `DbConnectionForm` remounts and clears its internal state. Clicking "Continuar al Paso 2" no-ops until reconnection is performed.

---

## 5. Adherence to Decision Record & Rules

- [x] **D1 (No component refactor)**: Zero changes made to files in `src/` (`git diff main -- src` is empty).
- [x] **D2 (Playwright runner preserved)**: No Testing Library or jsdom added. Single authorized devDependency added: `@vitest/coverage-v8@^5.0.0`.
- [x] **D3 (Zero database dependency)**: All endpoints hermetically intercepted via `mockBackend()`.
- [x] **D4 (Characterize current behavior, do not fix bugs)**: Observable quirks pinned without altering production code.
- [x] **D5 (Do not touch SqlPatchGenerator.ts)**: File remained untouched.
- [x] **Git Commit Control**: Round 2 changes remain uncommitted per instructions (`Do not commit`). Awaiting user order.
