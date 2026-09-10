# Implementer Hand-off: Extract Shared Wizard Steps (Target 1 of 2)

> **Mission**: Extract shared wizard steps (Steps 3, 4, and 5) from `db-csv-sync`, `db-shapefile-sync`, and `db-db-sync` into pure step-factory functions in `src/components/tools/db-sync-common/wizardSteps.tsx`.  
> **Branch**: `refactor/sync-wizard-shared-steps` (cut from `main`)  
> **Status**: **FIX ROUND 1 COMPLETE & VERIFIED** (All 7 gates green, 23/23 Playwright specs passing with zero assertion changes, 313 unit tests byte-identical, zero bytes in `tests/` modified)

---

## 1. Fix Round 1 Resolution

| Finding | Severity | Resolution & Implementation Details | Verification |
|---|---|---|---|
| **R1** | **MAJOR** | **Eliminated directory-wide ESLint suppression `src/app/tools/**/*.{ts,tsx}`**. Reverted `eslint.config.mjs` byte-for-byte to `main`. Added localized line-level suppressions (`// react-doctor-disable-next-line react-hooks-js/refs` followed by `// eslint-disable-next-line react-hooks/refs`) strictly above the 6 factory call sites across `db-csv-sync/page.tsx`, `db-shapefile-sync/page.tsx`, and `db-db-sync/page.tsx`. Other tool pages (`db-table-viewer`, `file-viewer`, `cartography-watcher`) retain full React Compiler ref protections. | `git diff main -- eslint.config.mjs` is empty. `npm run lint` passes with 0 errors and 0 warnings. `npm run doctor` scores 100/100 Great. |
| **R2** | **MINOR** | **Tightened `BuildSuidMappingStepParams.isMappingReady` contract**. Made `isMappingReady: boolean` required (removed `?`) in `src/components/tools/db-sync-common/wizardSteps.tsx`. Replaced `canProceed: params.isMappingReady ?? true` with `canProceed: params.isMappingReady`. All three calling pages already supplied `isMappingReady` explicitly. | TypeScript compilation and Next.js production build pass cleanly with no dead fallback logic. |

---

## 2. Architectural Conformance & Binding Decisions

All binding decisions specified in `TO_IMPLEMENTER.md` remain strictly honored:

| Decision | Status | Verification & Implementation Detail |
|---|---|---|
| **D1 (Scope discipline)** | **VERIFIED** | Refactor is strictly limited to extracting steps 3, 4, and 5 across the three sync tools. `ComparisonResultsView.tsx` and all other components remain completely untouched. |
| **D2 (No generic shell)** | **VERIFIED** | No `<SyncWizardShell>` component or hook was introduced. Steps 1 and 2 remain hand-written per page. `db-db-sync`'s two-database connection setup remains completely independent from the file uploader setups. |
| **D3 (Pure step factories)** | **VERIFIED** | Created `src/components/tools/db-sync-common/wizardSteps.tsx` exposing `buildSuidMappingStep`, `buildSyncParametersStep`, and `buildResultsStep`. No state or hooks inside the factories; state and refs stay in the host pages. |
| **D4 (String preservation)** | **VERIFIED** | Every heading, card title, subtitle, and button label was preserved byte-for-byte. Identical text was hardcoded inside the factories; tool-varying text was passed via parameters (`cardSubtitle`, `cardSubtitleWhenReady`). |
| **D5 (No shell/remount touch)** | **VERIFIED** | `WizardOrchestrator.tsx`, `StepIndicator.tsx`, and the `key={`step-content-${activeStep.id}`}` remount behavior were not touched. |
| **D6 (Safety net zero changes)** | **VERIFIED** | All 23 Playwright specs passed with **zero assertion or locator modifications** (`git diff main -- tests/` is completely empty). |
| **D7 (State & ref ownership)** | **VERIFIED** | Host pages retain all `useState`, `useRef`, event handlers, and step 1 (and step 2 for `db-db-sync`). Only step object construction was migrated to the factories. |

---

## 3. File Surface & LOC Delta

* **New Source File**: `src/components/tools/db-sync-common/wizardSteps.tsx` (130 lines) — **this is the only new source file in the codebase**.
* **Documentation Produced**:
  * `docs/issues/ISSUE_028_WIZARD_STEP_FACTORY_REF_PASSING_REACT_COMPILER.md`: Detailed analysis of React Compiler vs. procedural factory ref passing and future containerization options.
  * `docs/README.md`: Issue 028 indexed in root documentation index.
* **Modified Page Files (`git diff main --stat`)**:
  * `src/app/tools/db-csv-sync/page.tsx`: 108 lines modified (42 insertions(+), 66 deletions(-)).
  * `src/app/tools/db-db-sync/page.tsx`: 110 lines modified (43 insertions(+), 67 deletions(-)).
  * `src/app/tools/db-shapefile-sync/page.tsx`: 106 lines modified (38 insertions(+), 68 deletions(-)).
  * Total across pages: **3 files changed, 123 insertions(+), 201 deletions(-)** (net -78 lines).
* **Test Suite Untouched**:
  * `git diff main -- tests/` is **0 files, 0 lines, 0 bytes** modified.

---

## 4. Quality Gauntlet Telemetry (Real Output)

### Gate 1: Module Routes Check
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

stdout | tests/unit/scripts/generateModuleRoutes.test.ts > generate-module-routes: staleness check > should report the committed tree as up to date
Generated module routes are up to date (7 route file(s)).

 ✓ tests/unit/core/modules/createModuleRegistry.test.ts (21 tests) 21ms
 ✓ tests/unit/scripts/generateModuleRoutes.test.ts (27 tests) 50ms
 ✓ tests/unit/core/modules/createModuleRouteHandler.test.ts (5 tests) 44ms
 ✓ tests/unit/core/modules/defineModuleEndpoints.test.ts (13 tests) 13ms
 ✓ tests/unit/core/modules/definePageContributions.test.ts (7 tests) 10ms
 ✓ tests/unit/utils/spatial/WktGeometryParser.test.ts (7 tests) 11ms
 ✓ tests/unit/services/parsers/CsvParserRecordAliasing.test.ts (5 tests) 13ms
 ✓ tests/unit/utils/spatial/GeoJsonDatasetBuilder.test.ts (9 tests) 12ms
 ✓ tests/unit/services/parsers/CsvParser.test.ts (5 tests) 15ms
 ✓ tests/unit/modules/cartography-watcher/sourceOverrides.test.ts (7 tests) 10ms
 ✓ tests/unit/modules/cartography-watcher/sourceNaming.test.ts (19 tests) 14ms
 ✓ tests/unit/hooks/useDiscrepancyGeojson.test.ts (5 tests) 11ms
 ✓ tests/unit/modules/cartography-watcher/vaultServices.test.ts (25 tests) 714ms
 ✓ tests/unit/modules/cartography-watcher/catalogMapping.test.ts (14 tests) 10ms
 ✓ tests/unit/workers/comparison/SuidKeyResolver.test.ts (5 tests) 6ms
 ✓ tests/unit/workers/comparison/FileDatasetIndexer.test.ts (3 tests) 7ms
 ✓ tests/unit/utils/common/GisEncodingNormalizer.test.ts (14 tests) 11ms
 ✓ tests/unit/core/spatial/FeaturePreviewCap.test.ts (7 tests) 10ms
 ✓ tests/unit/utils/spatial/PolygonRingNormalizer.test.ts (5 tests) 8ms
 ✓ tests/unit/utils/spatial/EwkbGeometryParser.test.ts (5 tests) 9ms
 ✓ tests/unit/modules/cartography-watcher/deltaEvaluation.test.ts (13 tests) 10ms
 ✓ tests/unit/modules/cartography-watcher/formatters.test.ts (12 tests) 10ms
 ✓ tests/unit/modules/cartography-watcher/watcherOrchestration.test.ts (41 tests) 1016ms
 ✓ tests/unit/utils/spatial/SpatialGeometryComparator.test.ts (6 tests) 8ms
 ✓ tests/unit/utils/common/GisStringSanitizer.test.ts (8 tests) 9ms
 ✓ tests/unit/utils/spatial/FeatureRecordIndex.test.ts (7 tests) 7ms
 ✓ tests/unit/workers/comparison/SqlPatchGenerator.test.ts (3 tests) 8ms
 ✓ tests/unit/core/common/queryBusyState.test.ts (6 tests) 5ms
 ✓ tests/unit/modules/cartography-watcher/cartographyWatcherManifest.test.ts (9 tests) 7ms

 Test Files  29 passed (29)
      Tests  313 passed (313)
   Start at  14:46:08
   Duration  2.76s (transform 45%, tests 29%, import 19%, worker 6%)
```

### Gate 4: Next.js Production Build (Turbopack)
```
> gis-tools@0.1.0 prebuild
> npm run modules:routes

> gis-tools@0.1.0 modules:routes
> node scripts/generate-module-routes.cjs

Generated module routes already up to date (7 route file(s)).

> gis-tools@0.1.0 build
> next build

▲ Next.js 16.3.4 (Turbopack)
✓ Running next.config.ts took 38ms

  Creating an optimized production build ...
✓ Compiled successfully in 714ms
  Running TypeScript ...
  Finished TypeScript in 2.5s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (14/14) in 481ms
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

### Gate 5: React Doctor Health Audit
```
> gis-tools@0.1.0 doctor
> react-doctor

✔ Scanned 241 files in 580ms

React Doctor — gis-tools
Score: 100 / 100 Great

✔ No issues found!
```

### Gate 6: Playwright End-to-End Suite (23/23 Specs Passing)
```
> gis-tools@0.1.0 test:e2e
> playwright test

Running 23 tests using 6 workers

[1/23] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:31:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe agregar una nueva fuente vigilada desde el formulario
[2/23] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:44:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe mantener el formulario abierto, conservar la URL ingresada y mostrar el error si el servidor rechaza la edición
[3/23] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:97:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe expandir el árbol del catálogo y filtrar por formato al seleccionar recursos en sync tools
[4/23] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:9:7 › Módulo: Observador Cartográfico (/tools/m/cartography-watcher) › debe listar fuentes vigiladas y sus estados en el dashboard
[5/23] [chromium] › tests\e2e\flows\comparison-results.spec.ts:55:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe cargar la vista de resultados con pestaña por defecto (Tabla) y KPIs de resumen
[6/23] [chromium] › tests\e2e\flows\comparison-results.spec.ts:96:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe filtrar los registros en la tabla al hacer clic en las tarjetas KPI
[7/23] [chromium] › tests\e2e\flows\comparison-results.spec.ts:138:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe filtrar la tabla mediante el campo de búsqueda de texto libre
[8/23] [chromium] › tests\e2e\flows\comparison-results.spec.ts:157:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe alternar pestañas entre Tabla y Script SQL, mostrando el parche generado con exclusión mutua
[9/23] [chromium] › tests\e2e\flows\comparison-results.spec.ts:197:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe alternar a la pestaña de Mapa, visualizar el contenedor y mostrar estado vacío con filtro sin geometrías
[10/23] [chromium] › tests\e2e\flows\comparison-results.spec.ts:220:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe permitir ejecutar el script SQL en base de datos y marcar la pestaña como ejecutada
[11/23] [chromium] › tests\e2e\flows\comparison-results.spec.ts:246:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe mostrar el estado de error cuando la consulta de registros falla
[12/23] [chromium] › tests\e2e\flows\comparison-results.spec.ts:265:7 › Vista Común: ComparisonResultsView (Resultados y Discrepancias) › debe mostrar el estado de carga mientras se consultan registros y luego mostrar el resumen
[13/23] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:14:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[14/23] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:31:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe bloquear la conexión y mostrar mensaje de validación con campos vacíos
[15/23] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:46:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas
[16/23] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:179:7 › Herramienta: Sincronización DB vs. Archivo CSV (/tools/db-csv-sync) › debe mostrar alerta de error cuando el servidor falla al obtener columnas (HTTP 500)
[17/23] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:50:7 › Herramienta: Sincronización DB vs. DB (/tools/db-db-sync) › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[18/23] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:65:7 › Herramienta: Sincronización DB vs. DB (/tools/db-db-sync) › debe validar credenciales requeridas en el paso 1
[19/23] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:77:7 › Herramienta: Sincronización DB vs. DB (/tools/db-db-sync) › debe permitir navegar el flujo completo entre DB Origen y DB Destino (Pasos 1 al 5) y retroceder
[20/23] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:10:7 › Herramienta: Sincronización DB vs. Shapefile (/tools/db-shapefile-sync) › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[21/23] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:25:7 › Herramienta: Sincronización DB vs. Shapefile (/tools/db-shapefile-sync) › debe validar credenciales requeridas y bloquear avance en paso 1
[22/23] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:37:7 › Herramienta: Sincronización DB vs. Shapefile (/tools/db-shapefile-sync) › debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas
[23/23] [chromium] › tests\e2e\smoke.test.ts:7:7 › GIS Tools Application Smoke Tests › should verify app home page loads successfully
  23 passed (23.4s)
```

### Gate 7: Vitest Coverage Summary (`src/core/**`)
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

---

## 5. Non-Commit Adherence
* In strict adherence to project and agent rules (`NEVER execute git commit automatically`), **no git commit has been executed**.
* All working changes remain staged/ready in the working tree for review or user commit instruction.
