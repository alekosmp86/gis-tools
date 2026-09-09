# Fix Round 3 — Implementation Report for Orchestrator

**Branch**: `feat/watcher-edit-source`  
**Author**: Gemini 3.8 Flash (Implementer)  
**Status**: Gauntlet 5/5 GREEN (Routes Check, Lint, 313 Tests, Turbopack Build, React Doctor 100/100).  
**Test Delta**: 312 tests -> 313 tests (1 added, 0 altered, 0 deleted).

---

## 1. Findings Resolution Summary (G1 – G6)

### G1 [MAJOR] — Share `sourceNotFoundMessage` between layers & add storage test
- **Resolution**:
  - Added `sourceNotFoundMessage(sourceId: string): string` to `src/modules/cartography-watcher/domain/sourceOverrides.ts`.
  - Updated `services/WatchedSourcesStorageService.ts:updateSource` to throw `new Error(sourceNotFoundMessage(sourceId))`.
  - Updated `services/WatcherOrchestrator.ts:updateSource` to throw `new Error(sourceNotFoundMessage(sourceId))`.
  - Both guard throws remain active preserving layer contracts.
  - Added storage-level unit test in `tests/unit/modules/cartography-watcher/vaultServices.test.ts`:
    `it("should throw a Spanish error when updating an unknown source id", ...)` asserting rejection with `sourceNotFoundMessage(unknownId)`.

### G2 [MINOR] — Decouple remove & update pending states in `WatcherDashboard`
- **Resolution**:
  - Deleted `resolvePendingSourceId` helper in `src/modules/cartography-watcher/ui/WatcherDashboard.tsx` (reversing R6 derivation).
  - Derived independent state booleans:
    ```tsx
    isRemoving={removeSourceMutation.isPending && removeSourceMutation.variables === source.id}
    isUpdating={updateSourceMutation.isPending && updateSourceMutation.variables?.sourceId === source.id}
    ```
  - Updated `WatchedSourceCardProps` to take `isRemoving: boolean` and `isUpdating: boolean`.
  - `WatchedSourceCard` passes `isSubmitting={isUpdating}` to `<EditSourceForm>`, disables "Editar" when `isUpdating || isRemoving`, and disables "Dejar de vigilar" when `isRemoving || isUpdating`.

### G3 [MINOR] — Protect "form must not close on failure" contract with invariant comment
- **Resolution**:
  - In `src/modules/cartography-watcher/ui/WatchedSourceCard.tsx`, added the explicit invariant comment directly above the submit handler `await`:
    ```ts
    // Closing only after the await resolves is what keeps a rejected edit on screen.
    await onUpdate(source.id, url);
    setIsEditing(false);
    ```

### G4 [MINOR] — Eliminate dead resets in `EditSourceForm.handleCancel`
- **Resolution**:
  - In `src/modules/cartography-watcher/ui/EditSourceForm.tsx`, removed `handleCancel` which performed unobservable state resets before unmounting.
  - Passed `onClick={onCancel}` directly to the "Cancelar" button.

### G5 [MINOR] — Document retire-a-default constraint in `sourceOverrides.ts`
- **Resolution**:
  - In `src/modules/cartography-watcher/domain/sourceOverrides.ts`, documented the constraint in `mergeOverridesOverDefaults`' docstring:
    `Retiring a shipped default requires a migration, because override rows for it will otherwise be dropped.`
  - The anti-shadowing behaviour was preserved without changes.

### G6 [NIT] — Storage service cleanups
- **Resolution**:
  - In `src/modules/cartography-watcher/services/WatchedSourcesStorageService.ts`:
    - Renamed private method `persist` to `persistOverrides`.
    - Restored fail-soft comment in `loadSources`:
      `// A missing or corrupt file yields the defaults rather than an error; the next write repairs the file.`

---

## 2. Items Explicitly Kept Out of Scope
- No behaviour changed outside of the specified pending-state decoupling.
- No test assertions altered or relaxed.
- Anti-shadowing behaviour strictly maintained.
- `WatcherOrchestrator.ts` composition root left intact.
- No component test infrastructure introduced.
- No git commits executed (awaiting user instruction).

---

## 3. Quality Gauntlet Output

### Gate 1: Module Routes Staleness Check
```
> gis-tools@0.1.0 modules:routes:check
> node scripts/generate-module-routes.cjs --check

Generated module routes are up to date (7 route file(s)).
```

### Gate 2: ESLint
```
> gis-tools@0.1.0 lint
> eslint

(0 errors, 0 warnings)
```

### Gate 3: Vitest Unit Tests (313 / 313 Passed)
```
> gis-tools@0.1.0 test
> vitest run --run

 RUN  v5.0.0 C:/Alekos/Projects/gis-tools

 ✓ tests/unit/core/spatial/FeaturePreviewCap.test.ts (7 tests) 9ms
 ✓ tests/unit/core/modules/createModuleRegistry.test.ts (21 tests) 16ms
 ✓ tests/unit/core/modules/defineModuleEndpoints.test.ts (13 tests) 13ms
 ✓ tests/unit/core/modules/createModuleRouteHandler.test.ts (5 tests) 40ms
 ✓ tests/unit/scripts/generateModuleRoutes.test.ts (27 tests) 40ms
 ✓ tests/unit/services/parsers/CsvParserRecordAliasing.test.ts (5 tests) 10ms
 ✓ tests/unit/utils/spatial/WktGeometryParser.test.ts (7 tests) 11ms
 ✓ tests/unit/services/parsers/CsvParser.test.ts (5 tests) 13ms
 ✓ tests/unit/utils/spatial/GeoJsonDatasetBuilder.test.ts (9 tests) 11ms
 ✓ tests/unit/modules/cartography-watcher/sourceNaming.test.ts (19 tests) 12ms
 ✓ tests/unit/utils/common/GisEncodingNormalizer.test.ts (14 tests) 10ms
 ✓ tests/unit/utils/spatial/EwkbGeometryParser.test.ts (5 tests) 7ms
 ✓ tests/unit/core/modules/definePageContributions.test.ts (7 tests) 10ms
 ✓ tests/unit/modules/cartography-watcher/deltaEvaluation.test.ts (13 tests) 9ms
 ✓ tests/unit/hooks/useDiscrepancyGeojson.test.ts (5 tests) 10ms
 ✓ tests/unit/modules/cartography-watcher/vaultServices.test.ts (25 tests) 658ms
 ✓ tests/unit/utils/spatial/PolygonRingNormalizer.test.ts (5 tests) 8ms
 ✓ tests/unit/modules/cartography-watcher/catalogMapping.test.ts (14 tests) 9ms
 ✓ tests/unit/modules/cartography-watcher/sourceOverrides.test.ts (7 tests) 9ms
 ✓ tests/unit/utils/common/GisStringSanitizer.test.ts (8 tests) 7ms
 ✓ tests/unit/modules/cartography-watcher/watcherOrchestration.test.ts (41 tests) 685ms
 ✓ tests/unit/modules/cartography-watcher/formatters.test.ts (12 tests) 9ms
 ✓ tests/unit/workers/comparison/SqlPatchGenerator.test.ts (3 tests) 6ms
 ✓ tests/unit/utils/spatial/SpatialGeometryComparator.test.ts (6 tests) 7ms
 ✓ tests/unit/workers/comparison/SuidKeyResolver.test.ts (5 tests) 4ms
 ✓ tests/unit/workers/comparison/FileDatasetIndexer.test.ts (3 tests) 5ms
 ✓ tests/unit/core/common/queryBusyState.test.ts (6 tests) 4ms
 ✓ tests/unit/utils/spatial/FeatureRecordIndex.test.ts (7 tests) 5ms
 ✓ tests/unit/modules/cartography-watcher/cartographyWatcherManifest.test.ts (9 tests) 6ms

 Test Files  29 passed (29)
      Tests  313 passed (313)
   Duration  2.29s
```

### Gate 4: Next.js Turbopack Production Build
```
> gis-tools@0.1.0 build
> next build

▲ Next.js 16.3.2 (Turbopack)
✓ Running next.config.ts took 37ms
  Creating an optimized production build ...
✓ Compiled successfully in 4.8s
  Running TypeScript ...
  Finished TypeScript in 3.2s ...
  Collecting page data using 11 workers ...
✓ Generating static pages using 11 workers (14/14) in 440ms
  Finalizing page optimization ...

Route (app)
├ ƒ /api/m/cartography-watcher/sources/update
└ ○ /tools/m/cartography-watcher
```

### Gate 5: React Doctor (100 / 100)
```
> gis-tools@0.1.0 doctor
> react-doctor

√ Scanned 229 files in 6.8s [~10 workers]
✔ Scanned 229 files in 8.4s

React Doctor — gis-tools
Score: 100 / 100 Great

✔ No issues found!
```

---

## 4. Modified Files Summary

- `src/modules/cartography-watcher/domain/sourceOverrides.ts` (G1 helper, G5 docstring)
- `src/modules/cartography-watcher/services/WatchedSourcesStorageService.ts` (G1 throw, G6 `persistOverrides` & comment)
- `src/modules/cartography-watcher/services/WatcherOrchestrator.ts` (G1 throw)
- `src/modules/cartography-watcher/ui/EditSourceForm.tsx` (G4 direct `onCancel`)
- `src/modules/cartography-watcher/ui/WatchedSourceCard.tsx` (G2 props/disables, G3 invariant comment)
- `src/modules/cartography-watcher/ui/WatcherDashboard.tsx` (G2 pending decoupling)
- `tests/unit/modules/cartography-watcher/vaultServices.test.ts` (G1 storage-level unit test)
