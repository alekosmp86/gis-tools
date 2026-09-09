# Module Authoring Rules

> Canonical source for adding, changing and removing modules. `AGENTS.md` carries the condensed
> version — keep both in sync. Background and rationale live in
> `docs/architecture/MODULAR_MONOLITH_AND_MODULES.md`.

## 1. Decide first: module or core?

| The work is… | Where it goes |
|---|---|
| A new capability that could be switched off without anyone missing it | `src/modules/<id>/` |
| A change to one of the five existing tools | The tool's own folder. **Not** a module. |
| Domain logic, parsers, spatial math, DB access, streaming | `src/core/` |
| A component two or more tools will share | `src/ui-kit/` |

Nothing that exists today is a module. Modules are for what comes next. Do not migrate a working
tool into a module because the machinery exists.

## 2. Layers and the invariant

| Layer | Holds | May import |
|---|---|---|
| `src/core/` | domain types, spatial math, parsers, db access, streaming, module contracts | `core` only. **No React, no `next/*`.** |
| `src/ui-kit/` | shared React components and hooks | `core`, `ui-kit` |
| `src/app/tools/*`, `src/components/tools/*` | today's features, treated as core features | `core`, `ui-kit` |
| `src/modules/<id>/` | one module's ui, api handlers, types, manifest | `core`, `ui-kit`, its own folder (relative imports) |
| `src/app/modules.registry.ts` | the composition root: the only file naming every module | `core`, `modules` |

**The invariant: nothing in `core/` or `ui-kit/` may import from `modules/`, and no module may
import another module.** Cross-module needs go through a contract defined in `src/core/modules/`.

This is enforced in `eslint.config.mjs`, not by review. A violation fails `npm run lint`.

## 3. Module anatomy

```
src/modules/reports/
  module.routes.json    the routed surface: endpoints and owned pages
  manifest.ts           id, name, endpoints, pages, navigation, ui contributions
  types.ts              types owned by this module
  domain/               pure logic: no fs, no fetch, no React
  services/             I/O, with every dependency injectable
  api/handlers.ts       thin handlers bound to the declarations
  ui/ReportsCard.tsx    "use client" components contributed to slots
```

**Two worked examples exist.** `src/modules/status` is the minimal one: a single endpoint and a
home-grid card. `src/modules/cartography-watcher` is the full shape: seven endpoints, a page it
owns, a domain layer separated from its services, and a contribution that hands a file back to its
host. Read whichever is closer to what you are building.

**The minimal example lives in `src/modules/status`** — one endpoint, one nav entry, one UI
contribution, its own types and its own tested logic. Read it before writing a new module; the
steps below are what it does.

Route files under `src/app/api/m/**` are **generated** from `module.routes.json`. They are committed
so the served surface is visible in review, and they are never hand-edited.

## 4. The recipe

### Step 1 — Declare the HTTP surface

`src/modules/reports/module.routes.json`. `moduleId` MUST equal the folder name; it becomes a URL
segment, so it is lowercase letters, digits and hyphens only.

```json
{
  "moduleId": "reports",
  "endpoints": [
    { "path": "", "method": "GET", "runtime": "nodejs", "dynamic": "force-dynamic" },
    { "path": "registros/[id]", "method": "GET" },
    { "path": "registros", "method": "POST" }
  ]
}
```

- `path` is relative to the module and carries no leading slash. `""` serves the module root.
- `method` is one of `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- `runtime` (`nodejs` | `edge`) and `dynamic` (`auto` | `force-dynamic` | `force-static` | `error`)
  are optional; omit them to take the host default.
- Next configures `runtime` and `dynamic` **per file**, and every method on one path shares one
  file. Two methods on the same path MUST declare the same values, or generation fails.
- A module with no endpoints declares `"endpoints": []`, or ships no JSON file at all.

### Step 2 — Write the handlers

`src/modules/reports/api/handlers.ts`. Handlers take and return the Web platform `Request` /
`Response`. **Never** `NextRequest`, `NextResponse` or anything from `next/*`: a module must stay
liftable to another host.

```ts
import type { ModuleEndpointHandler } from "@/core/modules/contracts";

export const describeModule: ModuleEndpointHandler = () =>
  Response.json({ success: true, module: "reports" });

export const readReport: ModuleEndpointHandler = (request) =>
  Response.json({ success: true, url: request.url });
```

### Step 3 — Bind declarations to handlers in the manifest

`src/modules/reports/manifest.ts`. The manifest imports the *same* JSON the generator reads, so the
served surface and the registered surface cannot drift.

```ts
import { defineModuleEndpoints } from "@/core/modules/defineModuleEndpoints";
import type { AppModuleManifest } from "@/ui-kit/modules/contracts";
import routeDeclarations from "./module.routes.json";
import { describeModule, readReport, writeReport } from "./api/handlers";

export const reportsModule: AppModuleManifest = {
  id: routeDeclarations.moduleId,
  name: "Reportes",
  endpoints: defineModuleEndpoints(routeDeclarations, {
    GET: describeModule,
    "GET registros/[id]": readReport,
    "POST registros": writeReport,
  }),
};
```

Handler map keys are `"<METHOD> <path>"`, or the bare method for the module root. The binding is
checked both ways at startup: a declaration with no handler throws, and a handler nothing declared
throws. Neither is a warning — fix the declaration or delete the handler.

### Step 4 — Contribute UI (optional)

A contribution is `{ slot, id, order?, Component, label?, Icon? }`. The component renders with no
props, so it owns its own data fetching, and it MUST carry `"use client"` if it uses hooks or
browser APIs.

```ts
ui: [{ slot: UiSlot.HOME_TOOL_GRID, id: "reports.card", order: 100, Component: ReportsCard }],
```

**Every component a manifest references must come from a `"use client"` module — icons included.**
The manifest is evaluated on the server, and React can only pass a client reference across that
boundary. A lucide icon imported straight into the manifest fails the production build with
*"Functions cannot be passed directly to Client Components"*. Re-export it from a `"use client"`
file in the module and reference that instead:

```ts
// ui/contributionIcons.ts
"use client";
export { FolderTree as CatalogTabIcon } from "lucide-react";
```

**Mounted slots today:**

| Slot | Host | Notes |
|---|---|---|
| `HOME_TOOL_GRID` | `src/app/page.tsx` | cards beside the core tools |
| `FILE_SOURCE_TABS` | both sync uploaders | alternative file sources; see below |
| `TOOL_SIDEBAR`, `MAP_TOOLBAR`, `NAV_PRIMARY` | *nothing* | declared but unrendered |

A contribution sent to an unmounted slot renders nowhere and fails silently. Mounting one is a
core-side change — make it deliberately and separately, never as a side effect of adding a module.

`navigation` entries are collected and sorted by the registry but no host consumes them yet.

#### Contributing a file source

`FILE_SOURCE_TABS` is the first slot whose contributions need something back from their host. The
uploader publishes `{ toolId, format, onSelectFile, isLoading }` and the contribution reads it:

```tsx
const { format, onSelectFile, isLoading } = useFileSourceSlot();
```

`ModuleTabbedSlot` renders the host's own dropzone alone when nothing is contributed — byte for
byte what the uploader looked like before — and a tab strip when something is. Give such a
contribution a `label` and an `Icon`, or its tab is titled with its raw id.

Hand back a real `File`, exactly what the local dropzone would have produced, so the host cannot
tell the difference.

### Step 5 — Own a page (optional)

A module can own a whole route, not just decorate someone else's. Declare it beside the endpoints
in the same file:

```json
"pages": [{ "path": "", "title": "Observador Cartográfico" }]
```

and bind a component to it in the manifest:

```ts
pages: definePageContributions(routeDeclarations, { "": WatcherDashboard }),
```

It is served at `/tools/m/<id>/<path>`, and `""` owns `/tools/m/<id>`. The generator emits the route
file, exports the declared `title` as the document title, and calls `notFound()` when no module owns
the path — so a route left behind by a deleted module 404s instead of crashing.

The page component is an ordinary client component. Wrap it in `ToolWorkspaceLayout` from ui-kit to
get the same shell as a core tool: header, footer, and the link back to the portal.

### Step 6 — Register it in the composition root

`src/app/modules.registry.ts` is the only file permitted to name a module. Two lines:

```ts
import { reportsModule } from "@/modules/reports/manifest";

const activeModules: ReadonlyArray<AppModuleManifest> = [reportsModule];
```

### Step 7 — Generate the routes

```
npm run modules:routes
```

Commit what it emits. `predev` and `prebuild` run it automatically, so a forgotten regeneration
still serves correctly in dev — the committed tree is what the gate protects.

### Step 8 — Test it, next to the other tests

Module tests live in `tests/unit/modules/<id>/`, matching the repository's test layout. Cover the
module's own logic against real calculations (`.agents/rules/testing_standards.md` applies in full),
its handlers' responses, and its manifest: that the endpoint is bound to the intended handler, that
the declared `runtime`/`dynamic` survive, and that the contribution targets a slot a host actually
mounts.

Keep the logic worth testing out of the handler. `src/modules/status` injects the clock and the
process readings into a pure builder, so its uptime maths and Spanish rendering are covered
deterministically without mocking anything.

**These tests are part of the module's deletion set.** Removing a module means removing three
things: the folder, the registry line, and `tests/unit/modules/<id>/`. Left behind, they fail the
suite on imports that no longer resolve.

## 5. Hard rules

1. **Never hand-edit anything under `src/app/api/m/**`.** It is generated, carries a do-not-edit
   banner, and `npm run modules:routes:check` fails the moment it diverges. Change
   `module.routes.json` and regenerate.
2. **Never import a module outside the composition root.** Not from `core/`, not from `ui-kit/`, not
   from a page, not from another module. Generated routes name a module only as a *string* and
   resolve the handler through the registry, which is what preserves this.
3. **Never import `next/*` or React inside `src/core/`.** Core is headless.
4. **A module owns its types.** Put them in the module folder. Add to `src/core/types/` only when
   core itself needs the type; add to `src/core/modules/` only when it is a contract *between*
   modules and the host.
5. **Handlers speak Web `Request`/`Response`**, never Next types.
6. **A module must be deletable.** Its deletion set is three things: the folder, the registry line,
   and `tests/unit/modules/<id>/`. Remove them, regenerate, and the application must build and
   behave exactly as before. If anything else needs touching, the module leaked and the leak is the
   bug.
7. **A contribution must tolerate failure.** Slots wrap every contribution in an error boundary that
   drops it and logs; do not defeat this by throwing during module load instead of during render.
8. **Inherited standards still apply inside a module**: Spanish UI text, Lucide icons only, zero
   inline styles (`.module.css` alongside the component), no single-letter identifiers, atomic
   components, single-responsibility functions, const objects instead of raw string literals.

## 6. Before you call it done

Run the gauntlet from `.agents/rules/testing_branch_workflow.md`, then prove deletability:

1. `npm run modules:routes:check` — generated tree matches the declarations.
2. `npm run lint` — 0 errors, 0 warnings.
3. `npm test` — all suites green. New handlers and module logic need unit tests under
   `tests/unit/`, following `.agents/rules/testing_standards.md`.
4. `npm run build` — the new routes appear in the route table as `/api/m/<id>/...`.
5. `npm run doctor` — zero findings.
6. **Deletion proof**: remove the folder, the registry line and the test folder, regenerate, run the
   gauntlet again, and confirm the route table is back to its previous state with no core route
   touched. `git status` should come back empty. Restore and confirm once more.
   **Delete `.next` before measuring the result**: an incremental build keeps the removed module's
   chunks and inflates every page, which looks exactly like a leak that is not there.

## 7. Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Generated module routes are stale: missing/outdated/orphaned …` | The committed tree does not match the declarations | `npm run modules:routes`, commit the result |
| `declares "GET x" … but supplies no handler` | Declaration added, handler map not updated | Add the handler under that exact key |
| `supplies handlers for "…", which module.routes.json does not declare` | Handler with no declaration | Declare the endpoint or delete the handler |
| `declares moduleId "a" but lives in folder "b"` | Copy-pasted declaration file | Make them match; the id is the URL prefix |
| `Conflicting configuration for route "…"` | Two methods on one path asking for different `runtime`/`dynamic` | Align them; Next configures per file |
| `Duplicate module id` / `Invalid module id` | Registry validation at startup | One registration per module; lowercase id |
| Route answers 404 with "Ningún módulo registrado atiende…" | Route file exists but no module serves it | The module was removed without regenerating, or the registry line is missing |
| Contribution renders nowhere, no error | The target slot is not mounted in any host page | Use `HOME_TOOL_GRID`, or mount the slot as a separate core change |
| `Modules may not be imported here` (lint) | Something other than the composition root named a module | Route it through the registry |
| Stale `.next` type errors naming files from another branch | Cached Next type artifacts after a branch switch | Delete `.next` and rebuild |
| Pages still larger after deleting a module | Incremental `.next` still holds its chunks | `rm -rf .next` and rebuild before measuring |
| Test suite fails on unresolved `@/modules/<id>/...` imports | Module deleted, its test folder left behind | Delete `tests/unit/modules/<id>/` too |
| Build fails with *"Functions cannot be passed directly to Client Components"* | A component — often a lucide icon — reaches the manifest from a server module | Re-export it from a `"use client"` file and reference that |
| A contribution throws *"useFileSourceSlot debe usarse dentro de…"* | It is rendered outside the slot that publishes the context | Contribute it to `FILE_SOURCE_TABS`, not another slot |
| A page route 404s although the module is registered | The generated tree is stale, or the declared path does not match the manifest key | `npm run modules:routes`, and check the key is the normalised path |
| Handler cannot read a `[id]` path segment | Handlers receive only the `Request` | Parse `new URL(request.url).pathname`, or take the value from the body |
