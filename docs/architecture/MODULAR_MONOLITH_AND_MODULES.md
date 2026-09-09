# Modular Monolith — Core, UI Kit and Extension Modules

Architecture reference for the layer split and the module system. The prescriptive checklist for
adding a module lives in `.agents/rules/module_authoring.md`; this document explains what the
machinery is and why it is shaped this way.

---

## 1. The goal

Everything that existed before this work is **core**: the five tools, the viewers, the parsers, the
comparison engines. The module system exists for what comes *next*. The property being bought is
narrow and specific:

> Adding a capability must touch nothing but its own folder plus one registry line, and deleting it
> must leave the application working.

If a module can be deleted without a second thought, it can also be added without one. Everything
below is in service of that.

## 2. Layers

| Layer | Holds | May import |
|---|---|---|
| `src/core/` | domain types, spatial math, parsers, db access, streaming, module contracts | `core` only |
| `src/ui-kit/` | shared React components and hooks | `core`, `ui-kit` |
| `src/app/tools/*`, `src/components/tools/*` | today's features, treated as core features | `core`, `ui-kit` |
| `src/modules/<id>/` | a module's ui, api handlers, types, manifest | `core`, `ui-kit`, own folder |
| `src/app/modules.registry.ts` | the composition root: the only file naming every module | `core`, `modules` |

**The invariant:** nothing in `core/` or `ui-kit/` may import from `modules/`, and no module may
import another module. Cross-module needs go through contracts defined in `src/core/modules/`.

`core/` is additionally **headless**: no `react`, no `react-dom`, no `next/*`. That is what would
let it run outside the browser and outside Next one day, and it is checked by lint rather than
remembered.

These zones are expressed as `no-restricted-imports` groups in `eslint.config.mjs`. They were landed
*before* the refactor that needed them, while they were still trivially satisfiable — enforcement
added after a refactor only documents the violations that already crept in.

## 3. Contracts and the registry

`src/core/modules/contracts.ts` defines what a module is: an id, display metadata, endpoints,
navigation entries and UI contributions. Core depends on the *shape* and never on an instance.

The manifest is generic over its UI contribution type so core can stay headless — it knows a module
may carry UI, but not what UI *is*. `src/ui-kit/modules/contracts.ts` supplies the concrete
`UiContribution` and re-exports `AppModuleManifest`, the type module authors implement.

`createModuleRegistry` takes the manifests from the composition root and answers questions about
them. It validates at construction, so a misconfigured module fails loudly at startup instead of
producing a route that quietly never resolves:

- module ids must be usable as URL segments and folder names;
- two modules may not claim the same id;
- two endpoints may not resolve to the same method and path.

The registry is query-only. Nothing registers after construction, and an empty module list is a
valid, fully working application — which is what makes removing the last module a non-event.

## 4. UI extension slots

Named slots render whatever the registry has for them and nothing when empty, so a page with no
contributions renders exactly as it did before the slot existed.

```
moduleRegistry.uiContributions()          layout.tsx (server)
        │
        ▼
ModuleContributionsProvider (client context)
        │
        ▼
<ModuleSlot slot={UiSlot.HOME_TOOL_GRID} />
        │
        ▼
ModuleErrorBoundary per contribution  ──▶ throws are logged and dropped
```

`ui-kit` may not import the composition root, so the application shell reads the registry and feeds
the provider. ui-kit therefore stays unaware of which modules exist, or whether any exist at all.

The error boundary is the load-bearing part: it makes **"module broken" and "module removed" behave
identically**. A contribution that throws during render is dropped and the host page continues.

**Currently mounted:** `HOME_TOOL_GRID` only, in `src/app/page.tsx`. `TOOL_SIDEBAR`, `MAP_TOOLBAR`
and `NAV_PRIMARY` are defined in the contract but not yet rendered by any host, and
`registry.navigation()` has no consumer yet. A contribution aimed at an unmounted slot renders
nowhere, silently. Mounting one is a deliberate core-side change.

## 5. Endpoint generation

Modules contribute HTTP endpoints, but Next discovers routes from the filesystem. The bridge is a
build-time generator that emits real route files, which keeps per-route configuration (`runtime`,
`dynamic`) available instead of hiding the whole module surface behind one catch-all route.

### The pipeline

```
src/modules/reports/module.routes.json ─┬─▶ manifest.ts
                                        │     defineModuleEndpoints(json, handlers)
                                        │        └─▶ registry ──┐
                                        │                       │ resolved per request
                                        └─▶ generate-module-routes.cjs                │
                                              └─▶ src/app/api/m/reports/**/route.ts ──┘
                                                    createModuleRouteHandler(registry, METHOD, path)
```

One JSON file, read by both halves. The manifest binds handlers to it; the generator emits routes
from it. Neither side can add an endpoint the other does not know about.

### Why JSON

The generator is a plain Node script and cannot import a TypeScript manifest without a loader. Three
options were weighed:

1. **Declarative JSON per module** — chosen. One source of truth, no new dependency.
2. **Convention-based discovery** (glob `api/**/handler.ts`) — rejected: it moves the endpoint
   surface into file names, away from the manifest the registry validates.
3. **A TypeScript loader** (`tsx` / `ts-node`) — rejected on install risk behind the local TLS
   interception, and because importing a manifest at generate time drags the module's entire import
   graph — `pg`, core services — into a build script.

The mirrored constants this forces on the generator (methods, runtimes, dynamic modes, path
arithmetic) are held to core's copies by a unit test, so the mirror cannot quietly become a second
source of truth.

### What a generated route looks like

```ts
/**
 * GENERATED FILE — DO NOT EDIT.
 * ...
 */
import { moduleRegistry } from "@/app/modules.registry";
import { ModuleHttpMethod } from "@/core/modules/contracts";
import { createModuleRouteHandler } from "@/core/modules/createModuleRouteHandler";

const ROUTE_PATH = "reports/registros";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = createModuleRouteHandler(moduleRegistry, ModuleHttpMethod.GET, ROUTE_PATH);
```

Two properties are deliberate:

- **The route never imports a module.** It names one only as a string and asks the registry who
  serves it, so the composition root keeps its monopoly even over generated code.
- **Resolution happens per request, not at module load.** A route file left behind by a deleted
  module answers 404 instead of crashing the server at boot.

Methods sharing a path are folded into one file, because that is how Next models a route. Two
methods on one path asking for different `runtime` or `dynamic` values is therefore rejected at
generation rather than resolved by whichever declaration was read last.

`runtime` and `dynamic` exist on the contract *because* the generator honours them. They were
removed from an earlier revision of the contracts precisely because nothing read them: a module
could declare `runtime: EDGE`, be served on Node, and get no signal. **Configuration the system
silently ignores is worse than configuration it does not offer.**

### Staleness controls

Generated routes are committed, so review sees the served surface. That makes staleness the risk,
and it is closed from three directions:

| Control | Protects |
|---|---|
| `predev` / `prebuild` npm hooks | dev and build always regenerate first |
| `npm run modules:routes:check` in the gauntlet | a committed stale tree fails loudly |
| A unit test asserting `--check` passes | drift fails `npm test` even if the gauntlet is skipped |

`--check` reports three kinds of drift by name: `missing` (declared, not emitted), `outdated`
(hand-edited or regenerated differently) and `orphaned` (emitted for a module that no longer
declares it). Regeneration removes orphans and prunes the directories they leave behind.

The residual gap is a contributor running `next build` directly, bypassing the npm hook. The
`--check` gate is what catches that at review time.

## 6. The deletion property

Removing a module is: delete the folder, delete the registry line, run `npm run modules:routes`.

Everything else follows on its own — generated routes vanish with their directories, slots render
nothing, the registry answers every query with nothing. Nothing under `src/app/api/db/**` or in any
tool is touched, because nothing there ever knew the module existed.

This is the acceptance test for the whole architecture, and it is exercised as one: add → works,
delete → nothing breaks, restore → works, gauntlet green at each step.

## 7. The reference module

`src/modules/status` is the worked example: minimal, but a real module rather than a fixture. It
publishes the server's uptime, Node version and execution environment at `GET /api/m/status`, and
contributes a card to the home tool grid that polls it.

| Piece | File | Note |
|---|---|---|
| Declaration | `module.routes.json` | one `GET ""`, `runtime: nodejs`, `dynamic: force-dynamic` |
| Manifest | `manifest.ts` | takes its `id` from the declaration, so folder, prefix and id cannot disagree |
| Types | `types.ts` | owned by the module; nothing here belongs in core |
| Logic | `serverStatusSnapshot.ts` | pure: clock and process readings are injected |
| Handler | `api/statusHandler.ts` | thin: reads the process, delegates, serialises |
| UI | `ui/ServerStatusCard.tsx` | `"use client"`, renders with no props, owns its own fetching |

The split between handler and builder is the part worth copying. A handler that reads `process` and
`Date.now()` inline can only be tested by mocking the world; injecting both leaves the real logic —
uptime maths, unit boundaries, the clamp for a backwards clock, environment normalisation — covered
by ordinary deterministic tests.

### What the acceptance test established

| Step | Result |
|---|---|
| **Add** | endpoint served; uptime advanced 0 → 2 s across two requests with an unchanged start instant, proving `dynamic: force-dynamic` reached the generated route; card server-rendered into the grid; an undeclared method returned 405 |
| **Delete** | `git status` empty — the tree byte-identical to the commit before the module existed; route table back to baseline; 148 tests green; `/api/m/status` 404 |
| **Restore** | everything back, 169 tests green, gauntlet clean |

Until this ran, the extension points were a hypothesis. They are now demonstrated: **add → works,
delete → nothing breaks, restore → works**, with the gauntlet green at each step.

### Two properties the pilot exposed

- **A module's deletion set is three things**, not two: the folder, the registry line, and
  `tests/unit/modules/<id>/`. Tests live with the repository's other tests rather than inside the
  module, so they must be removed deliberately.
- **Removal can only be measured against a clean `.next`.** An incremental build keeps the removed
  module's chunks and inflates every page by roughly 4 KB — indistinguishable from a leak until you
  rebuild from scratch, at which point the pages match the pre-module baseline exactly.

And one cost to keep in view: a UI contribution adds a constant ~386 B to **every** page, because
the contributions list is threaded through the root layout rather than per page. Fine at this scale;
if it stops being fine, the shell can pass only the contributions whose slots a page mounts.

## 8. Module-owned pages

Slots decorate a host page. A module that needs a route of its own declares a page beside its
endpoints, in the same file:

```json
{
  "moduleId": "cartography-watcher",
  "endpoints": [ ... ],
  "pages": [{ "path": "", "title": "Observador de Actualizaciones Cartográficas" }]
}
```

`definePageContributions` binds each declaration to a component with the same two-way check the
endpoints get, and the generator emits `src/app/tools/m/<id>/<path>/page.tsx`. The emitted page
resolves through the registry, exports the declared title as document metadata, and calls
`notFound()` when nothing owns the path — the page-shaped equivalent of an unserved route returning
404 rather than crashing at boot.

The alternative was a dynamic `[toolId]` dispatcher: one route file matching every module page.
Generated pages were chosen for the same reasons as generated endpoints — the route table shows what
is actually served, and a stale tree is caught by `--check` instead of failing at request time.

## 9. Slots that carry context

A contribution renders with no props. That is right for a card, and useless for a file picker that
must know what its host accepts and where to hand the result back.

`FILE_SOURCE_TABS` is the first slot to solve this. The host publishes a value; the contribution
reads it through a hook:

```tsx
// host: src/components/tools/db-csv-sync/CsvUploader.tsx
<FileSourceSlotProvider value={{ toolId, format, onSelectFile: processFile, isLoading }}>
  <ModuleTabbedSlot slot={UiSlot.FILE_SOURCE_TABS} defaultLabel="Subir desde PC">
    <FileDropzone ... />
  </ModuleTabbedSlot>
</FileSourceSlotProvider>

// contribution: src/modules/cartography-watcher/ui/CatalogTreeSelector.tsx
const { format, onSelectFile, isLoading } = useFileSourceSlot();
```

Two properties keep this safe:

- **`ModuleTabbedSlot` renders its children alone when nothing is contributed.** No tab strip, no
  wrapper — the uploader is byte for byte what it was before the slot existed.
- **The contribution returns a real `File`**, exactly what the local dropzone would have produced.
  The host cannot tell where it came from, so nothing in core learns that catalogues exist.

`UiContribution` gained optional `label` and `Icon` for hosts that draw chrome around a
contribution. Both are ignored by slots that render contributions bare.

### The client-reference rule

A manifest is evaluated on the server. React can pass a *client reference* across that boundary but
not an arbitrary function-bearing object, so **every component a manifest names must come from a
`"use client"` module — icons included**. A lucide icon imported straight into a manifest fails the
production build with *"Functions cannot be passed directly to Client Components"*. Re-export it
from a `"use client"` file in the module and the problem disappears.

This is the same rule that already applied to `Component`; it simply becomes visible the first time
a contribution carries a second component.

## 10. How the generator itself was verified

Before the reference module existed, the generator was proved with a throwaway `diagnostics` module
carrying three endpoints, including a dynamic `[id]` segment. It was deleted afterwards, so nothing
in the tree corresponds to it; the results are kept because they cover ground the status module
does not — multiple endpoints, a dynamic segment, and every direction of drift:

- `npm run build` listed all three under `/api/m/diagnostics/**`;
- a live server returned each handler's payload, and an undeclared method returned 405 from Next;
- drift was caught in all three directions (hand-edited file, declaration ahead of the tree,
  orphans from a deleted module);
- deleting the module's folder emptied the generated tree, pruned its directories, and left the
  hand-written routes under `src/app/api/db/**` untouched;
- with zero modules registered, the route table and the rendered pages are identical to what they
  were before any of this existed.

## 11. Map of the machinery

| File | Responsibility |
|---|---|
| `src/core/modules/contracts.ts` | what a module is: manifest, endpoints, methods, runtime, dynamic, registry shape |
| `src/core/modules/createModuleRegistry.ts` | builds and validates the registry; resolves endpoints by method and path |
| `src/core/modules/defineModuleEndpoints.ts` | binds `module.routes.json` declarations to handlers, checking both directions |
| `src/core/modules/createModuleRouteHandler.ts` | per-request dispatch used by generated routes |
| `src/core/modules/moduleRoutePaths.ts` | the path arithmetic registry, binder and generator all agree on |
| `src/ui-kit/modules/contracts.ts` | `UiSlot`, `UiContribution`, `AppModuleManifest` |
| `src/ui-kit/modules/ModuleSlot.tsx` | renders a slot's contributions in order, nothing when empty |
| `src/ui-kit/modules/ModuleErrorBoundary.tsx` | isolates a failing contribution from its host page |
| `src/ui-kit/modules/ModuleContributionsContext.tsx` | carries contributions from the shell to the slots |
| `src/app/modules.registry.ts` | the composition root — the only file naming a module |
| `scripts/generate-module-routes.cjs` | emits and verifies `src/app/api/m/**` |
| `eslint.config.mjs` | the layer boundaries, as lint errors |
| `src/modules/status/**` | the reference module: declaration, manifest, types, logic, handler, UI |
| `tests/unit/modules/status/**` | its tests — part of its deletion set |
| `src/core/modules/definePageContributions.ts` | binds page declarations to components, checking both directions |
| `src/ui-kit/modules/ModuleTabbedSlot.tsx` | a slot offering its contributions beside the host content |
| `src/ui-kit/modules/FileSourceSlotContext.tsx` | the context a file-source host publishes to its contributions |
| `src/modules/cartography-watcher/**` | the full-shape example: endpoints, an owned page, domain and services |
