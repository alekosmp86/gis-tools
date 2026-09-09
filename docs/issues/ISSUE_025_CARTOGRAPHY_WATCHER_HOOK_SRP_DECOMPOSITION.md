# Issue 025: Cartography Watcher Hook Single Responsibility Principle (SRP) Decomposition

## 1. Problem Statement
The custom hook `useCartographyWatcher.ts` (283 lines) had grown into a monolithic "God Hook" juggling 12 individual `useState` hooks, exposing 19 properties, and coordinating 5 distinct, colliding domains:
1. LocalStorage reading/writing, URL slug extraction, and title formatting.
2. Batch polling telemetry and status badge dictionary management across all sources.
3. Probing individual remote CKAN catalog deltas.
4. Orchestrating binary resource downloads and imperatively mutating both `checkResult` and `sourceSummaries` caches.
5. Holding presentation-level search and format filter state without performing the filtering itself.

Additionally, raw string literals (`"TODOS"`, `"Personalizado"`) were used for comparisons and state initialization, violating repository clean code standards.

## 2. Root Cause Analysis & Technical Details
- **Mixed Lifecycle & Concerns**: Persistent configuration management (`localStorage`) was tightly coupled with transient network state (`isChecking`, `downloadingResourceId`) and presentation state (`filterQuery`, `selectedFormat`).
- **Complex Cross-Cache State Machine**: When a resource was downloaded, the download callback had to manually traverse `checkResult.resources` to replace the delta item, recalculate `updatesCount`, and then imperatively mutate `sourceSummaries[selectedSourceId]` to decrement `updatesCount` and re-evaluate `SourceBadgeState`.
- **Presentation State Leaks**: Filter queries and format selections were held in the hook while the actual resource filtering and unique format collection were computed in `WatcherDashboard.tsx`.

## 3. Implemented Solution
The monolithic hook was refactored into focused, single-responsibility modules following the Single Responsibility Principle (SRP) and Open/Closed Principle (OCP):

1. **Domain Constants & Types (`src/modules/cartography-watcher/types/watcher.ts`)**:
   - Added `WATCHED_SOURCE_CATEGORY` (`DEFAULT`, `CUSTOM`) and `CATALOG_FILTER_ALL` (`"TODOS"`) to eliminate raw string literals.
2. **Pure Utility Modules**:
   - `src/modules/cartography-watcher/utils/watcherUrls.ts`: Contains pure functions `extractSlugFromUrl` and `formatTitleFromSlug`.
   - `src/modules/cartography-watcher/utils/watcherCalculations.ts`: Contains pure deterministic transformation functions:
     - `deriveBadgeStateFromResult`
     - `applyDownloadedResourceDelta`
     - `recalculateSummaryAfterDownload`
3. **Atomic Custom Hooks**:
   - `useWatchedSources`: Encapsulates `localStorage` persistence, custom source additions, and active source selection.
   - `useSourceSummaries`: Encapsulates batch telemetry polling across sources and status badge dictionary management.
   - `useSourceInspection`: Encapsulates active catalog probing, resource binary downloading, and notification alerts.
   - `useResourceFilter`: Encapsulates search queries, format filtering, and memoizes `availableFormats` and `filteredResources`.
4. **High-Level Orchestrator Facade (`useCartographyWatcher.ts`)**:
   - Composes the atomic sub-hooks into a clean, backward-compatible interface.
5. **Component Simplification (`WatcherDashboard.tsx`)**:
   - Simplified to consume `availableFormats` and `filteredResources` directly from the hook, removing redundant inline Set transformations and filter logic.

## 4. Code Examples & Diff Snippets

### Before (Monolithic state & inline imperative cross-cache mutations):
```typescript
// Imperative cross-cache mutation in download callback
downloadResourceApi(sourceUrl, resourceId).then((result) => {
  setDownloadingResourceId(null);
  if (result.ok) {
    const updatedDelta = result.data.delta;
    setCheckResult((previous) => {
      if (!previous) return previous;
      const updatedResources = previous.resources.map((item) =>
        item.resource.id === resourceId ? updatedDelta : item
      );
      const newUpdatesCount = updatedResources.filter(
        (item) => item.status === DeltaStatus.UPDATE_AVAILABLE || item.status === DeltaStatus.NOT_DOWNLOADED
      ).length;
      return { ...previous, updatesCount: newUpdatesCount, resources: updatedResources };
    });
    setSourceSummaries((previous) => {
      const currentSummary = previous[selectedSourceId];
      if (!currentSummary) return previous;
      const remainingUpdates = Math.max(0, currentSummary.updatesCount - 1);
      return {
        ...previous,
        [selectedSourceId]: {
          ...currentSummary,
          updatesCount: remainingUpdates,
          status: remainingUpdates === 0 ? SourceBadgeState.UP_TO_DATE : SourceBadgeState.UPDATE_AVAILABLE,
        },
      };
    });
  }
});
```

### After (Pure state transformations and clean hook delegation):
```typescript
// Pure transformer in watcherCalculations.ts:
export function applyDownloadedResourceDelta(
  currentResult: WatcherSourceCheckResult,
  downloadedDelta: WatchResourceDelta
): WatcherSourceCheckResult {
  const updatedResources = currentResult.resources.map((item) =>
    item.resource.id === downloadedDelta.resource.id ? downloadedDelta : item
  );
  const newUpdatesCount = updatedResources.filter(
    (item) => item.status === DeltaStatus.UPDATE_AVAILABLE || item.status === DeltaStatus.NOT_DOWNLOADED
  ).length;
  return { ...currentResult, updatesCount: newUpdatesCount, resources: updatedResources };
}

// In useSourceInspection.ts:
setCheckResult((previous) => (previous ? applyDownloadedResourceDelta(previous, updatedDelta) : previous));
options?.onDownloadSuccess?.(updatedDelta);
```

## 5. Build & Server Boundary Fixes
During production build verification (`npm run build`), five underlying compilation issues were identified and resolved:
1. **Server vs. Client Boundary Isolation**:
   - `src/app/api/modules/[module]/route.ts` was importing from `@/modules`, pulling in `extension.tsx` and the entire React client UI component tree into a server Route Handler.
   - **Fix**: Created `src/modules/server.ts` to register API handlers in an isolated, pure server runtime context with zero UI dependencies.
2. **Missing `"use client"` Directives**:
   - Added `"use client";` to `WatcherDashboard.tsx`, `CatalogTreeSelector.tsx`, `SourceSelector.tsx`, `ResourceCard.tsx`, `extension.tsx`, and all client hooks.
3. **TypeScript Typing Corrections**:
   - Updated `FileDropzoneProps.formatBadges` from `string[]` to `readonly string[]` to prevent TS4104 assignment mismatch with `dropzoneFormatBadges`.
   - Updated `patchSourceSummary` updater signature in `useSourceSummaries.ts` to permit returning `SourceCheckSummary | undefined`.
4. **CSS Module Selector Purity**:
   - In `SpatialMapPreview.module.css`, un-scoped `:global(.leaflet-popup-content-wrapper)` selectors were scoped under the local parent `.mapContainer :global(...)`.
5. **Turbopack Cache Reset**:
   - Cleared stale lock files from `.next/` created during concurrent development runs.

## 6. Verification & Testing
- **Unit Tests**: Created `tests/unit/modules/cartography-watcher/watcherCalculations.test.ts` covering URL slug extraction, title formatting, badge state derivation, download delta replacement, and summary update recalculations.
- **ESLint**: `npm run lint` passes with 0 errors and 0 warnings.
- **React Doctor**: `npm run doctor` scores **100 / 100 Great** with 0 issues.
- **Production Build**: `npm run build` (Turbopack) compiles cleanly in 13.0s with all 13 routes generated.

