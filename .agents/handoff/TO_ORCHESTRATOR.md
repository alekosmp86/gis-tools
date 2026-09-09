# Fix Round 2 — Implementation Report for Orchestrator

**Branch**: `feat/watcher-edit-source`  
**Author**: Gemini 3.8 Flash (Implementer)  
**Status**: Gauntlet 5/5 GREEN (Routes Check, Lint, 312 Tests, Turbopack Build, React Doctor 100/100).  
**Test Delta**: 305 tests -> 312 tests (7 added, 0 altered, 0 deleted).

---

## 1. Findings Resolution Summary (R1 – R6)

### R1 [MAJOR] — Extract `EditSourceForm` from `WatchedSourceCard`
- **Resolution**:
  - Created `src/modules/cartography-watcher/ui/EditSourceForm.tsx` and `EditSourceForm.module.css`.
  - Extracted the edit form UI, `editUrl` state, `editError` state, and submit/cancel logic from `WatchedSourceCard`.
  - Props: `initialUrl`, `isSubmitting`, `onSubmit(url): Promise<void>`, `onCancel()`.
  - Moved `.form`, `.label`, `.input`, `.errorMessage`, `.actions`, `.saveButton`, `.cancelButton` into `EditSourceForm.module.css`.
  - Left `.editButton` and `.actionsGroup` in `WatchedSourceCard.module.css` as card chrome.
  - `WatchedSourceCard.tsx` now only manages `isEditing: boolean` and renders `<EditSourceForm>` when active, reducing card component complexity.
  - As instructed, `EditSourceForm` is kept distinct from `AddSourceForm`.

### R2 [MAJOR] — Deduplicate collision check via `assertReferenceIsFree`
- **Resolution**:
  - Extracted private helper method in `src/modules/cartography-watcher/services/WatcherOrchestrator.ts`:
    ```ts
    private assertReferenceIsFree(
      sources: ReadonlyArray<WatchedSource>,
      portalHost: string,
      datasetSlug: string,
      exceptSourceId?: string
    ): void
    ```
  - Both `addSource` (no `exceptSourceId`) and `updateSource` (`exceptSourceId = sourceId`) now call this helper.
  - The Spanish collision message and case-insensitive matching logic are defined in exactly one place.
  - The `derivedId` check remains in `addSource` where it specifically belongs.

### R3 [MAJOR] — Decompose `renameSourceDir` in `VaultStorageService`
- **Resolution**:
  - Split `renameSourceDir` in `src/modules/cartography-watcher/services/VaultStorageService.ts`:
    - `renameSourceDir` retains the 4-state outcome determination (`SOURCE_ABSENT`, `DESTINATION_EXISTS`, `FAILED`, `RENAMED`).
    - Extracted private `rewriteSidecarPaths(destinationDir, newSlug): Promise<void>` to handle iterating and rewriting `relativeFilePath` across all `.meta.json` sidecars.
  - Per-sidecar error isolation from Round 1 is preserved.
  - Preserved the architectural invariant comment on `renameSourceDir`.

### R4 [MAJOR] — Move domain logic to `domain/sourceOverrides.ts`
- **Resolution**:
  - Created `src/modules/cartography-watcher/domain/sourceOverrides.ts`:
    - `isUntouchedDefault(source: WatchedSource): boolean`: Pure comparison against `DEFAULT_WATCHED_SOURCES`.
    - `mergeOverridesOverDefaults(persistedRows: ReadonlyArray<WatchedSource>): WatchedSource[]`: Partitions persisted rows, applies overrides over defaults with `isDefault: true`, appends custom rows with `isDefault: false`, and ignores impostor defaults.
  - `WatchedSourcesStorageService.loadSources` now parses disk contents and delegates directly to `mergeOverridesOverDefaults(persistedRows)`.
  - `WatchedSourcesStorageService.persist` now uses `isUntouchedDefault` from the domain layer.
  - Added unit test suite `tests/unit/modules/cartography-watcher/sourceOverrides.test.ts` (7 tests covering both functions hermetically without temp directory I/O).

### R5 [MINOR] — Tighten `onUpdate` prop contract
- **Resolution**:
  - `WatchedSourceCardProps.onUpdate` signature tightened from `(sourceId: string, url: string) => Promise<unknown> | void` to `(sourceId: string, url: string) => Promise<void>`.
  - Prevents accidental `void` return types that would break error catching and prematurely close the edit form on failure.

### R6 [MINOR] — Extract `resolvePendingSourceId` helper in `WatcherDashboard`
- **Resolution**:
  - Extracted `resolvePendingSourceId(removeVariables, isRemoving, updateVariables, isUpdating): string | null` above the component in `src/modules/cartography-watcher/ui/WatcherDashboard.tsx`, matching the existing `indexSummariesBySourceId` and `sumPendingResources` pattern.
  - Replaced the chained ternary expression in the component body with a clean declarative call.

---

## 2. Items Explicitly Kept Out of Scope
- No behaviour changed; all 305 existing test specifications remain strictly intact and unchanged.
- `AddSourceForm` and `EditSourceForm` kept separate per R1 guidance.
- HTTP status codes and default re-stamping rules unchanged.
- No git commits made.

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

### Gate 3: Vitest Unit Tests (312 / 312 Passed)
```
> gis-tools@0.1.0 test
> vitest run

Test Files  29 passed (29)
     Tests  312 passed (312)
  Duration  2.67s
```

### Gate 4: Next.js Turbopack Production Build
```
> gis-tools@0.1.0 build
> next build

▲ Next.js 16.3.2 (Turbopack)
✓ Running next.config.ts took 39ms
  Creating an optimized production build ...
✓ Compiled successfully in 4.8s
  Running TypeScript ...
  Finished TypeScript in 3.1s ...
  Collecting page data using 11 workers ...
  Generating static pages using 11 workers (14/14) in 803ms
  Finalizing page optimization ...

Route (app)
├ ƒ /api/m/cartography-watcher/sources/update
└ ○ /tools/m/cartography-watcher
```

### Gate 5: React Doctor
```
> gis-tools@0.1.0 doctor
> react-doctor

✔ Scanned 229 files in 8.1s
React Doctor — gis-tools
Score: 100 / 100 Great
✔ No issues found!
```

---

## 4. Modified & Added Files Summary

- **New files**:
  - `src/modules/cartography-watcher/domain/sourceOverrides.ts` (R4 domain logic)
  - `src/modules/cartography-watcher/ui/EditSourceForm.tsx` (R1 component)
  - `src/modules/cartography-watcher/ui/EditSourceForm.module.css` (R1 styles)
  - `tests/unit/modules/cartography-watcher/sourceOverrides.test.ts` (R4 tests)
- **Modified files**:
  - `src/modules/cartography-watcher/services/WatcherOrchestrator.ts` (R2 helper)
  - `src/modules/cartography-watcher/services/VaultStorageService.ts` (R3 split)
  - `src/modules/cartography-watcher/services/WatchedSourcesStorageService.ts` (R4 delegation)
  - `src/modules/cartography-watcher/ui/WatchedSourceCard.tsx` (R1 composition & R5 type)
  - `src/modules/cartography-watcher/ui/WatchedSourceCard.module.css` (R1 style cleanup)
  - `src/modules/cartography-watcher/ui/WatcherDashboard.tsx` (R6 helper)
