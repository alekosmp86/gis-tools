# Issue 031: Cartography Watcher Endpoint Desync & SSR Module Initialization

## 1. Problem Statement
When navigating to the Cartography Watcher dashboard in the browser, an alert banner displayed the following error:
```
JSON.parse: unexpected character at line 1 column 1 of the JSON data
```
Additionally, the browser developer console recorded two failing network requests:
1. `GET http://localhost:3000/tools/modules/cartography-watcher [HTTP/1.1 404 Not Found]`
2. `XHR GET http://localhost:3000/api/cartography-watcher?url=... [HTTP/1.1 404 Not Found]`

## 2. Root Cause Analysis & Technical Details
1. **Endpoint Desynchronization in `watcherApi.ts`**:
   - Following the migration in Issue 024 to a unified dynamic module API router (`/api/modules/[module]`), `API_BASE_URL` was defined as `"/api/modules/cartography-watcher"`.
   - While `fetchSourcesSummariesApi`, `downloadResourceApi`, and `fetchCatalogTreeApi` were updated to use `API_BASE_URL`, `fetchSourceCheckApi` on line 61 still had a hardcoded legacy endpoint:
     ```ts
     const response = await fetch(`/api/cartography-watcher?url=${encodeURIComponent(sourceUrl)}`);
     ```
   - Since `/api/cartography-watcher` no longer exists as a static route, Next.js returned a 404 HTML response (`<!DOCTYPE html>...`).
   - `fetchSourceCheckApi` called `await response.json()` without checking `response.ok`, attempting to parse the HTML string as JSON, which threw `SyntaxError: JSON.parse: unexpected character at line 1 column 1 of the JSON data`.
2. **SSR Initialization Guard in `ModuleExtensionProvider.tsx`**:
   - In `ModuleExtensionProvider.tsx`, `initializeModules()` was wrapped in `if (typeof window !== "undefined")`.
   - During server-side rendering (SSR) of `src/app/tools/modules/[toolId]/page.tsx`, `window` is undefined. Consequently, `moduleRegistry.getTool(toolId)` returned `undefined`, causing Next.js to trigger `notFound()` (HTTP 404) during initial document SSR before client hydration kicked in.

## 3. Implemented Solution
1. **Synchronized Endpoint & Added Defensive Response Guards in `watcherApi.ts`**:
   - Updated `fetchSourceCheckApi` to use `${API_BASE_URL}?url=${encodeURIComponent(sourceUrl)}`.
   - Added `if (!response.ok)` status guards prior to `await response.json()` across `fetchSourceCheckApi`, `fetchSourcesSummariesApi`, `downloadResourceApi`, and `fetchCatalogTreeApi`. If an HTTP error occurs, it returns an explicit error object (`Error HTTP 404...`) without crashing JSON deserialization.
2. **Eager Module Registration on SSR in `ModuleExtensionProvider.tsx`**:
   - Removed the `if (typeof window !== "undefined")` guard so that `initializeModules()` executes eagerly during both SSR module evaluation and client hydration.

## 4. Code Examples & Diff Snippets

### Before (`src/modules/cartography-watcher/services/watcherApi.ts`):
```ts
export async function fetchSourceCheckApi(sourceUrl: string): Promise<ApiResult<WatcherSourceCheckResult>> {
  try {
    const response = await fetch(`/api/cartography-watcher?url=${encodeURIComponent(sourceUrl)}`);
    const payload = (await response.json()) as { ... };
    if (!response.ok || !payload.success || !payload.data) { ... }
    return { ok: true, data: payload.data };
  } catch (error) { ... }
}
```

### After (`src/modules/cartography-watcher/services/watcherApi.ts`):
```ts
export async function fetchSourceCheckApi(sourceUrl: string): Promise<ApiResult<WatcherSourceCheckResult>> {
  try {
    const response = await fetch(`${API_BASE_URL}?url=${encodeURIComponent(sourceUrl)}`);

    if (!response.ok) {
      return {
        ok: false,
        error: `Error HTTP ${response.status} al consultar el catálogo de datos.`,
      };
    }

    const payload = (await response.json()) as {
      success: boolean;
      data?: WatcherSourceCheckResult;
      error?: string;
    };
    if (!payload.success || !payload.data) {
      return { ok: false, error: payload.error || "No se pudo consultar el catálogo de datos." };
    }
    return { ok: true, data: payload.data };
  } catch (error) { ... }
}
```

### Before (`src/providers/ModuleExtensionProvider.tsx`):
```tsx
// Eager initialization on browser load
if (typeof window !== "undefined") {
  initializeModules();
}
```

### After (`src/providers/ModuleExtensionProvider.tsx`):
```tsx
// Eager initialization on module load (both SSR of client components and browser hydration)
initializeModules();
```

## 5. Verification & Testing
- `npm run lint`: Exited 0 with 0 errors and 0 warnings.
- `npm run doctor`: 100 / 100 Great maintainability score across 207 scanned files.
- `npm run build`: Production Next.js Turbopack build succeeded cleanly in 1.2s.
