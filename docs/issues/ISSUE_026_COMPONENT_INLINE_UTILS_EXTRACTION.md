# Issue 026: Component Inline Utility Function Extraction

## 1. Problem Statement
In `src/modules/cartography-watcher/components/ResourceCard.tsx`, utility functions for byte formatting (`formatBytes`), date formatting (`formatDate`), and sync URL generation (`getTargetSyncUrl`) were declared inline within the React component file (lines 29–70).

Furthermore, audit of the module revealed that `formatBytes` and `formatDate` had been redundantly duplicated across four separate component files:
- `ResourceCard.tsx`
- `ResourceVaultSection.tsx`
- `CatalogTreeSelector.tsx`
- `WatcherDashboard.tsx`

This violated our function decomposition, atomic component architecture, and DRY (Don't Repeat Yourself) clean code standards.

## 2. Root Cause Analysis & Technical Details
- **Component Bloat & Lack of Separation of Concerns**: Pure formatting and string transformation calculations were tied to presentation components instead of being isolated in a dedicated utility module.
- **Code Duplication**: Independent components implemented their own versions of `formatBytes` and `formatDate` with minor subtle variations instead of sharing a canonical implementation.

## 3. Implemented Solution
1. **Created Canonical Utility Module (`src/modules/cartography-watcher/utils/watcherFormatters.ts`)**:
   - `formatBytes(bytes?: number | null): string`: Converts bytes to human-readable MB or KB strings with fallback for missing/zero values.
   - `formatDate(dateString?: string | null, includeTime?: boolean): string`: Formats ISO date strings into DD/MM/YYYY (with optional HH:mm display).
   - `getTargetSyncUrl(format?: string | null, sourceSlug?: string, resourceId?: string): string | null`: Pure URL generator for target synchronization tools (`/tools/db-csv-sync` or `/tools/db-shapefile-sync`).
2. **Component Refactoring**:
   - Refactored `ResourceCard.tsx` to remove lines 29–70 and import from `watcherFormatters`.
   - Refactored `ResourceVaultSection.tsx` to remove inline `formatDate`.
   - Refactored `CatalogTreeSelector.tsx` to remove duplicate inline `formatBytes` and `formatDate`.
   - Refactored `WatcherDashboard.tsx` to remove duplicate inline `formatDate`.
3. **Module Barrel Export**:
   - Exported `watcherFormatters` from `src/modules/cartography-watcher/index.ts`.
4. **Unit Test Suite**:
   - Created `tests/unit/modules/cartography-watcher/watcherFormatters.test.ts` covering boundary conditions, missing/zero values, date formatting with/without time, and URL route derivation.

## 4. Code Examples & Diff Snippets

### Before (Inline in ResourceCard.tsx):
```typescript
function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "Desconocido";
  const megaBytes = bytes / (1024 * 1024);
  if (megaBytes >= 1) return `${megaBytes.toFixed(2)} MB`;
  const kiloBytes = bytes / 1024;
  return `${kiloBytes.toFixed(1)} KB`;
}

function formatDate(dateString?: string | null): string { ... }
function getTargetSyncUrl(format?: string | null, sourceSlug?: string, resourceId?: string): string | null { ... }
```

### After (Imported from canonical utility module):
```typescript
import {
  formatBytes,
  formatDate,
  getTargetSyncUrl,
} from "../utils/watcherFormatters";
```

## 5. Verification & Testing
- **Unit Tests**: `watcherFormatters.test.ts` passes with 100% coverage across all test cases.
- **ESLint**: `npm run lint` passes with 0 errors and 0 warnings.
- **React Doctor**: `npm run doctor` scores **100 / 100 Great** with 0 issues.
- **Production Build**: `npm run build` (Turbopack) passes cleanly in 2.9s with all 13 routes generated.
