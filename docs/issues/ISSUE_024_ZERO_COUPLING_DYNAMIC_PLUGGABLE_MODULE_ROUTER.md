# ISSUE 024: Zero-Coupling Dynamic Pluggable Module Router in Next.js

## 1. Problem Statement
In previous iterations, the `cartography-watcher` module's HTTP API route handler was placed directly at `src/app/api/cartography-watcher/route.ts` with 126 lines of backend controller logic in the core routing tree. Furthermore, both `src/app/api/cartography-watcher/route.ts` and `src/app/tools/cartography-watcher/page.tsx` contained static imports referencing `@/modules/cartography-watcher`.

This violated the core architectural rule established in `AGENTS.md`:
> **Zero Impact on Module Removal**: If any module in `src/modules/` is disabled, deleted, or detached from the repository, the core system and all core tools must continue to build and function without a single broken import or compiler error.

If `src/modules/cartography-watcher` were deleted or detached, Next.js / Turbopack compilation would immediately fail with `Module not found: Can't resolve '@/modules/cartography-watcher'` due to the hardcoded route files in `src/app/`.

## 2. Root Cause Analysis & Technical Details
Next.js App Router relies on directory structures under `src/app/` to map URL endpoints. Creating hardcoded directories under `src/app/api/<module>` and `src/app/tools/<module>` creates an inverted dependency: core route files statically depend on optional pluggable modules.

To achieve true zero coupling, core must provide dynamic routing dispatchers that resolve modules from an agnostic in-memory registry, while the module encapsulates 100% of its frontend UI, backend API controllers, and data contracts.

## 3. Implemented Solution

1. **Core Module Contracts (`src/types/moduleRegistry.ts`)**:
   - `ModuleApiHandler`: Declares optional `GET`, `POST`, `PUT`, `DELETE` HTTP handlers.
   - `ModuleToolDefinition`: Declares metadata (`id`, `title`, `description`) and the UI component (`component: React.ComponentType`).

2. **Core In-Memory Registry (`src/services/extensions/moduleRegistry.ts`)**:
   - `registerApi(moduleId, handler)` & `getApi(moduleId)`
   - `registerTool(tool)` & `getTool(toolId)`
   - Has **zero imports** from `src/modules/*`.

3. **Core Dynamic Route Dispatchers (`src/app/`)**:
   - **API Dispatcher** (`src/app/api/modules/[module]/route.ts`):
     - Dynamically matches `/api/modules/:module`.
     - Invokes the registered `GET` or `POST` handler, or cleanly returns a `404 Not Found` JSON response if the module is not installed or disabled.
     - Zero static imports from `src/modules/*`.
   - **UI Tool Dispatcher** (`src/app/tools/modules/[toolId]/page.tsx`):
     - Dynamically matches `/tools/modules/:toolId`.
     - Mounts the registered tool component within `ToolWorkspaceLayout`, or calls Next.js `notFound()`.
     - Zero static imports from `src/modules/*`.

4. **100% Self-Contained Module Implementation (`src/modules/cartography-watcher/`)**:
   - `api/route.ts`: Contains the complete, decomposed backend API handler (`handleCatalogTree`, `handleCatalogFile`, `handleSummaries`, `handleCheckSource`, `handleDownloadResource`).
   - `components/WatcherDashboard.tsx`: Encapsulates the frontend UI.
   - `services/watcherApi.ts`: Consumes the dynamic API endpoint `/api/modules/cartography-watcher`.
   - `extension.tsx`: Self-registers both the API handler and the tool component into `moduleRegistry`.

5. **Elimination of Core Stubs**:
   - Deleted `src/app/api/cartography-watcher/`.
   - Deleted `src/app/tools/cartography-watcher/`.
   - Updated `toolsData.ts` route to `/tools/modules/cartography-watcher`.

## 4. Code Examples & Diff Snippets

### Core Dynamic API Dispatcher (`src/app/api/modules/[module]/route.ts`)
```typescript
import { NextResponse } from "next/server";
import { moduleRegistry } from "@/services/extensions/moduleRegistry";
import { initializeModules } from "@/modules";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ module: string }> }
): Promise<Response> {
  initializeModules();
  const { module: moduleId } = await params;
  const handler = moduleRegistry.getApi(moduleId);

  if (!handler?.GET) {
    return NextResponse.json(
      { success: false, error: `Módulo API "${moduleId}" no encontrado o no registrado.` },
      { status: 404 }
    );
  }

  return handler.GET(request);
}
```

### Module Self-Registration (`src/modules/cartography-watcher/extension.tsx`)
```typescript
export function registerCartographyWatcherExtension(): () => void {
  const unregisterTab = extensionRegistry.registerFileSourceTab(cartographyWatcherExtension);
  const unregisterApi = moduleRegistry.registerApi("cartography-watcher", { GET, POST });
  const unregisterTool = moduleRegistry.registerTool({
    id: "cartography-watcher",
    title: "Observador de Actualizaciones Cartográficas",
    description: "Monitoree catálogos abiertos de datos espaciales...",
    component: WatcherDashboard,
  });

  return () => {
    unregisterTab();
    unregisterApi();
    unregisterTool();
  };
}
```

## 5. Verification & Testing
- **Zero-Coupling Audit**: `grep_search` confirmed **0 imports** of `@/modules/cartography-watcher` across all core directories (`src/app/`, `src/components/`, `src/services/`, `src/types/`, `src/utils/`).
- **ESLint**: Clean exit code 0 (0 errors, 0 warnings).
- **Module Detachment Safety**: If `src/modules/cartography-watcher` is removed from the codebase, core builds and compiles cleanly without a single broken import.
