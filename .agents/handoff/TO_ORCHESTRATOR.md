# Implementer Hand-off: Playwright UI Characterization Safety Net (Fix Round 1)

> **Mission**: Build an exhaustive, resilient Playwright characterization test safety net for the large sync tools and `ComparisonResultsView` (the "God components") prior to any decomposition or refactoring.  
> **Branch**: `test/ui-characterization`  
> **Status**: **COMPLETE & VERIFIED** (All 7 gauntlet gates green, 19/19 E2E specs passing, 0 bytes modified under `src/`)

---

## 1. Fix Round 1 Resolution (Items G1 – G9)

All items from Claude's review (Fix Round 1) have been addressed and verified:

| Item | Severity | Description | Resolution Details |
|---|---|---|---|
| **G1** | **MAJOR** | Step 5 unprotected in sync wizards | Added `await expect(page.getByRole("button", { name: /Total Evaluados/i })).toBeVisible();` to `db-csv-sync.spec.ts` and `db-db-sync.spec.ts` after the Step 5 header to prove `ComparisonResultsView` mounted. |
| **G2** | **MAJOR** | Missing loading state test in `ComparisonResultsView` | Added 5th spec in `comparison-results.spec.ts` using a deferred `streamGate` Promise holding `/api/db/records/stream`, asserting loading/progress UI is visible, resolving the promise, and asserting the results summary appears. |
| **G3** | **MAJOR** | Monolithic `mockBackend()` with repeated ternaries | Refactored `tests/e2e/support/mockBackend.ts` using `resolveOverride(override, arg, fallback)` helper and an array of `{ pattern, handler }` registrations in a loop. Fixed `watcherRemove` handler. Preserved exact route precedence and per-page source closure. |
| **G4** | **MINOR** | SQL Patch Tab assertion insensitive to visibility | Updated `comparison-results.spec.ts` to assert `toBeVisible()` on `page.locator("pre").filter({ hasText: "INSERT INTO" })` after clicking `insertTab`, avoiding hidden-node false positives caused by `display: none !important`. |
| **G5** | **MINOR** | Fragile locators in tests | Replaced substring `<label>` selector with `getByRole("checkbox", { name: "departamento", exact: true })`, card selector with `getByRole("article")`, and edit input with `card.getByLabel("URL o identificador del catálogo")`. |
| **G6** | **MINOR** | Assertions testing mock instead of app | 1) Added format exclusion assertion `toHaveCount(0)` on shapefile button in `cartography-watcher.spec.ts`.<br>2) Derived title from URL in mock POST `/sources` handler (`Fuente nueva-fuente-sig`) and asserted derived value in test.<br>3) Pinned wizard-remount quirk across all 3 sync tools: asserts "Continuar al Paso 2" is enabled, clicks it, asserts step-1 header remains visible, then reconnects with `connectDb`. |
| **G7** | **MINOR** | `smoke.test.ts` real network call & regex | Switched to `support/testFixture`, invoked `await mockBackend()` to ensure hermetic offline run, and made title assertion exact: `toHaveTitle("Suite de Herramientas SIG | Procesamiento Espacial")`. |
| **G8** | **MINOR** | Non-types in `MockBackendOptions` | Strongly typed all mock options against real contract shapes (`DbColumnsResponse`, `SourceSummaryFixture[]`, `CatalogGroupFixture[]`, etc.). |
| **G9** | **NIT** | Harness polish & configurations | 1) Created `tests/e2e/support/wizardSteps.ts` with `connectDb(page, options)`.<br>2) Narrowed ESLint `react-hooks/rules-of-hooks` override to `tests/e2e/support/**/*.{ts,tsx}` in `eslint.config.mjs`.<br>3) Added `"coverage/**"` to `globalIgnores` in `eslint.config.mjs`.<br>4) Set `timeout: 60_000` in `playwright.config.ts`. |
| **Dep** | **AUTHORISED** | Vitest coverage provider | Installed `@vitest/coverage-v8@^5.0.0` as devDependency per orchestrator authorization. `npm run test:coverage` now executes cleanly. |

---

## 2. Quality Gauntlet Results (Real Output)

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

### Gate 3: Vitest Unit Suite
```
> gis-tools@0.1.0 test
> vitest run

 RUN  v5.0.0 C:/Alekos/Projects/gis-tools

 ✓ tests/unit/core/modules/defineModuleEndpoints.test.ts (13 tests) 10ms
 ✓ tests/unit/core/modules/createModuleRegistry.test.ts (21 tests) 15ms
 ✓ tests/unit/scripts/generateModuleRoutes.test.ts (27 tests) 32ms
 ✓ tests/unit/core/modules/createModuleRouteHandler.test.ts (5 tests) 43ms
 ✓ tests/unit/utils/spatial/PolygonRingNormalizer.test.ts (5 tests) 9ms
 ✓ tests/unit/services/parsers/CsvParserRecordAliasing.test.ts (5 tests) 11ms
 ✓ tests/unit/services/parsers/CsvParser.test.ts (5 tests) 13ms
 ✓ tests/unit/utils/spatial/GeoJsonDatasetBuilder.test.ts (9 tests) 12ms
 ✓ tests/unit/hooks/useDiscrepancyGeojson.test.ts (5 tests) 10ms
 ✓ tests/unit/utils/common/GisEncodingNormalizer.test.ts (14 tests) 12ms
 ✓ tests/unit/modules/cartography-watcher/vaultServices.test.ts (25 tests) 338ms
 ✓ tests/unit/utils/spatial/WktGeometryParser.test.ts (7 tests) 10ms
 ✓ tests/unit/modules/cartography-watcher/sourceOverrides.test.ts (7 tests) 9ms
 ✓ tests/unit/modules/cartography-watcher/sourceNaming.test.ts (19 tests) 12ms
 ✓ tests/unit/core/spatial/FeaturePreviewCap.test.ts (7 tests) 9ms
 ✓ tests/unit/modules/cartography-watcher/deltaEvaluation.test.ts (13 tests) 11ms
 ✓ tests/unit/modules/cartography-watcher/catalogMapping.test.ts (14 tests) 10ms
 ✓ tests/unit/core/modules/definePageContributions.test.ts (7 tests) 8ms
 ✓ tests/unit/utils/spatial/SpatialGeometryComparator.test.ts (6 tests) 8ms
 ✓ tests/unit/modules/cartography-watcher/formatters.test.ts (12 tests) 8ms
 ✓ tests/unit/utils/common/GisStringSanitizer.test.ts (8 tests) 7ms
 ✓ tests/unit/workers/comparison/SqlPatchGenerator.test.ts (3 tests) 7ms
 ✓ tests/unit/modules/cartography-watcher/watcherOrchestration.test.ts (41 tests) 724ms
 ✓ tests/unit/workers/comparison/FileDatasetIndexer.test.ts (3 tests) 8ms
 ✓ tests/unit/utils/spatial/FeatureRecordIndex.test.ts (7 tests) 7ms
 ✓ tests/unit/core/common/queryBusyState.test.ts (6 tests) 4ms
 ✓ tests/unit/utils/spatial/EwkbGeometryParser.test.ts (5 tests) 5ms
 ✓ tests/unit/workers/comparison/SuidKeyResolver.test.ts (5 tests) 4ms
 ✓ tests/unit/modules/cartography-watcher/cartographyWatcherManifest.test.ts (9 tests) 6ms

 Test Files  29 passed (29)
      Tests  313 passed (313)
   Start at  09:55:18
   Duration  2.24s
```
*Note: `git diff main -- tests/unit` is empty (byte-identical).*

### Gate 4: Coverage Summary (`src/core/**`)
```
> gis-tools@0.1.0 test:coverage
> vitest run --coverage

 % Coverage report from v8
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |   37.67 |    33.54 |   51.36 |   38.13 |                   
 binary            |       0 |        0 |       0 |       0 |                   
  ...yDbfReader.ts |       0 |        0 |       0 |       0 | 36-164            
  ...yShpReader.ts |       0 |        0 |       0 |       0 | 3-246             
  ...InternPool.ts |       0 |        0 |       0 |       0 | 13-43             
  ...eExtractor.ts |       0 |        0 |       0 |       0 | 17-89             
 common            |   62.41 |       50 |   61.11 |   63.23 |                   
  ...Normalizer.ts |    70.4 |    60.52 |     100 |   70.83 | ...13,218,253,284 
  ...gSanitizer.ts |      90 |      100 |   66.66 |   89.47 | 15-22             
  ...eFormatter.ts |       0 |        0 |       0 |       0 | 6-71              
  ...yBusyState.ts |     100 |      100 |     100 |     100 |                   
 constants         |    2.94 |        0 |       0 |    3.12 |                   
  ...escriptors.ts |       0 |        0 |       0 |       0 | 4-52              
  ...eConstants.ts |       0 |      100 |     100 |       0 | 9-14              
  ...igDefaults.ts |       0 |      100 |     100 |       0 | 3                 
  gisConstants.ts  |     100 |      100 |     100 |     100 |                   
  mapConstants.ts  |       0 |        0 |       0 |       0 | 4-101             
 modules           |   99.25 |    96.42 |     100 |   99.21 |                   
  contracts.ts     |     100 |      100 |     100 |     100 |                   
  ...leRegistry.ts |   98.27 |    92.59 |     100 |   98.14 | 92                
  ...uteHandler.ts |     100 |      100 |     100 |     100 |                   
  ...eEndpoints.ts |     100 |      100 |     100 |     100 |                   
  ...tributions.ts |     100 |      100 |     100 |     100 |                   
  ...RoutePaths.ts |     100 |      100 |     100 |     100 |                   
 services          |       0 |        0 |       0 |       0 |                   
  ...ionService.ts |       0 |        0 |       0 |       0 | 14-120            
  ...geDbConfig.ts |       0 |        0 |       0 |       0 | 3-94              
  workerBridge.ts  |       0 |        0 |       0 |       0 | 17-156            
 services/engines  |       0 |        0 |       0 |       0 |                   
  ...isonEngine.ts |       0 |        0 |       0 |       0 | 14-170            
  ...isonEngine.ts |       0 |        0 |       0 |       0 | 13-37             
 services/parsers  |   54.76 |    44.95 |   71.42 |   53.89 |                   
  CsvParser.ts     |   93.87 |    81.66 |     100 |   96.51 | 76,100,120        
  ...fileParser.ts |       0 |        0 |       0 |       0 | 11-174            
 ...ices/streaming |       0 |        0 |       0 |       0 |                   
  ...reamReader.ts |       0 |        0 |       0 |       0 | 44-147            
 spatial           |   52.87 |    56.16 |   68.75 |   55.29 |                   
  ...etryParser.ts |   38.13 |    72.72 |   83.33 |   39.63 | ...36-243,251-270 
  ...PreviewCap.ts |     100 |      100 |     100 |     100 |                   
  ...ecordIndex.ts |     100 |      100 |     100 |     100 |                   
  ...setBuilder.ts |   94.87 |       88 |     100 |   94.87 | 117,122           
  ...Normalizer.ts |   62.16 |    58.53 |      50 |   67.74 | 48-62,79-82,91    
  ...Normalizer.ts |   49.41 |    54.83 |   41.66 |   51.42 | ...53-154,160-175 
  ...tionEngine.ts |       4 |        0 |      60 |    4.76 | 12-99             
  ...Comparator.ts |   56.36 |    56.81 |   77.77 |      54 | ...95-144,183,190 
  ...etryParser.ts |   70.17 |    72.72 |   66.66 |   74.07 | 70-88,106-108     
 types             |   71.42 |      100 |     100 |   71.42 |                   
  comparison.ts    |     100 |      100 |     100 |     100 |                   
  parsers.ts       |     100 |      100 |     100 |     100 |                   
 workers           |       0 |        0 |       0 |       0 |                   
  ...isonWorker.ts |       0 |        0 |       0 |       0 | 17-112            
  ...WorkerSync.ts |       0 |      100 |       0 |       0 | 9-32              
 ...ers/comparison |    33.8 |    24.12 |   41.86 |   34.39 |                   
  ...eExtractor.ts |       0 |        0 |       0 |       0 | 38-129            
  ...setIndexer.ts |    42.3 |       50 |      40 |   42.85 | 32-77             
  ...eEvaluator.ts |       0 |        0 |       0 |       0 | 24-82             
  ...Comparator.ts |       0 |        0 |       0 |       0 | 56-209            
  ...ordHandler.ts |       0 |        0 |       0 |       0 | 17-60             
  ...hCollector.ts |      76 |       50 |   44.44 |      76 | 34-51             
  ...isonEngine.ts |       0 |        0 |       0 |       0 | 26-298            
  ...hGenerator.ts |   58.23 |    43.44 |   73.07 |   61.84 | ...74-378,433-450 
  ...iptBuilder.ts |   37.25 |    23.43 |   66.66 |   40.42 | ...8-52,65,74-119 
  ...eyResolver.ts |   88.88 |    83.33 |   83.33 |   88.23 | 21,34,45,75       
  ...sCollector.ts |       0 |        0 |       0 |       0 | 26-87             
-------------------|---------|----------|---------|---------|-------------------
```

### Gate 5: Turbopack Production Build
```
> gis-tools@0.1.0 build
> next build

▲ Next.js 16.3.4 (Turbopack)
✓ Running next.config.ts took 36ms

  Creating an optimized production build ...
✓ Compiled successfully in 601ms
  Running TypeScript ...
  Finished TypeScript in 2.3s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (14/14) in 435ms
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
```

### Gate 6: React Doctor Diagnostics
```
> gis-tools@0.1.0 doctor
> react-doctor

✔ Scanned 240 files in 560ms

React Doctor — gis-tools
Score: 100 / 100 Great

✔ No issues found!
```

### Gate 7: Playwright E2E Suite (19 / 19 Passed)
```
> gis-tools@0.1.0 test:e2e
> playwright test

Running 19 tests using 6 workers

[1/19] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:26:7 › Módulo: Observador Cartográfico › debe agregar una nueva fuente vigilada desde el formulario
[2/19] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:39:7 › Módulo: Observador Cartográfico › debe mantener el formulario abierto, conservar la URL ingresada y mostrar el error si el servidor rechaza la edición
[3/19] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:92:7 › Módulo: Observador Cartográfico › debe expandir el árbol del catálogo y filtrar por formato al seleccionar recursos en sync tools
[4/19] [chromium] › tests\e2e\flows\cartography-watcher.spec.ts:8:7 › Módulo: Observador Cartográfico › debe listar fuentes vigiladas y sus estados en el dashboard
[5/19] [chromium] › tests\e2e\flows\comparison-results.spec.ts:55:7 › Vista Común: ComparisonResultsView › debe cargar la vista de resultados con pestaña por defecto (Tabla) y KPIs de resumen
[6/19] [chromium] › tests\e2e\flows\comparison-results.spec.ts:73:7 › Vista Común: ComparisonResultsView › debe filtrar los registros en la tabla al hacer clic en las tarjetas KPI
[7/19] [chromium] › tests\e2e\flows\comparison-results.spec.ts:111:7 › Vista Común: ComparisonResultsView › debe alternar pestañas entre Tabla y Script SQL, mostrando el parche generado
[8/19] [chromium] › tests\e2e\flows\comparison-results.spec.ts:143:7 › Vista Común: ComparisonResultsView › debe mostrar el estado de error cuando la consulta de registros falla
[9/19] [chromium] › tests\e2e\flows\comparison-results.spec.ts:162:7 › Vista Común: ComparisonResultsView › debe mostrar el estado de carga mientras se consultan registros y luego mostrar el resumen
[10/19] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:10:7 › Herramienta: Sincronización DB vs. Archivo CSV › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[11/19] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:27:7 › Herramienta: Sincronización DB vs. Archivo CSV › debe bloquear la conexión y mostrar mensaje de validación con campos vacíos
[12/19] [chromium] › tests\e2e\flows\db-csv-sync.spec.ts:42:7 › Herramienta: Sincronización DB vs. Archivo CSV › debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas
[13/19] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:20:7 › Herramienta: Sincronización DB vs. DB › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[14/19] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:35:7 › Herramienta: Sincronización DB vs. DB › debe validar credenciales requeridas en el paso 1
[15/19] [chromium] › tests\e2e\flows\db-db-sync.spec.ts:47:7 › Herramienta: Sincronización DB vs. DB › debe permitir navegar el flujo completo entre DB Origen y DB Destino (Pasos 1 al 5) y retroceder
[16/19] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:10:7 › Herramienta: Sincronización DB vs. Shapefile › debe cargar la vista inicial con el paso 1 activo y el avance bloqueado
[17/19] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:25:7 › Herramienta: Sincronización DB vs. Shapefile › debe validar credenciales requeridas y bloquear avance en paso 1
[18/19] [chromium] › tests\e2e\flows\db-shapefile-sync.spec.ts:37:7 › Herramienta: Sincronización DB vs. Shapefile › debe permitir navegar el flujo completo (Pasos 1 al 5) y retroceder con sus guardas
[19/19] [chromium] › tests\e2e\smoke.test.ts:7:7 › GIS Tools Application Smoke Tests › should verify app home page loads successfully
  19 passed (17.5s)
```

---

## 3. Disclosed Quirks & Bugs (Per Decision D4)

In accordance with **D4 (characterization, not aspiration)**, observable behavior was encoded into the test suite without altering production application code in `src/`:

1. **`watcherClient.ts` Discards Server Error Messages on Non-200 Responses**:
   - **Location**: `src/modules/cartography-watcher/ui/watcherClient.ts:18-30`
   - **Symptom**: `readJson` throws generic `Error("${context} (HTTP ${response.status}).")` before reading the body when `!response.ok`.
   - **Safety Net**: Characterization test in `cartography-watcher.spec.ts:39-89` pins current behavior.

2. **`CsvParser.ts` Duplicate SUID Record Aliasing**:
   - **Location**: `src/core/services/parsers/CsvParser.ts:168-175`
   - **Symptom**: Inserts both `row-${index}` and `record.suid` into `recordsMap`, producing duplicate entries during `Object.values(recordsObject)`.
   - **Safety Net**: Unit tests in `CsvParserRecordAliasing.test.ts` document this; E2E flows accommodate existing parser output.

3. **Step 1 Wizard Remount & Proceed Guard Quirk**:
   - **Location**: `src/components/tools/db-sync-common/DbConnectionForm.tsx` within sync wizard pages.
   - **Symptom**: Navigating backward from Step 2 to Step 1 remounts `DbConnectionForm`, resetting its internal `isConnected` state to `false`. While `page.tsx` retains `canProceed = true`, clicking it calls `dbFormRef.current?.proceed()`, which no-ops.
   - **Safety Net**: Characterized and pinned across all 3 sync tools (`db-csv-sync.spec.ts`, `db-shapefile-sync.spec.ts`, and `db-db-sync.spec.ts`).

---

## 4. Adherence to Decision Record

- [x] **D1 (No component refactor)**: Zero changes made to files in `src/` (`git diff main -- src` is empty).
- [x] **D2 (Playwright runner preserved)**: No Testing Library or jsdom added. Single authorized devDependency added: `@vitest/coverage-v8@^5.0.0`.
- [x] **D3 (Zero database dependency)**: All endpoints hermetically intercepted via `mockBackend()`.
- [x] **D4 (Characterize current behavior, do not fix bugs)**: Observable quirks pinned without altering production code.
- [x] **D5 (Do not touch SqlPatchGenerator.ts)**: File remained untouched.
- [x] **Git Commit Control**: Did not execute `git commit`. Awaiting instructions.
