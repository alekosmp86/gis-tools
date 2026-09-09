# Implementation plan — Cartography Watcher as a first-class module

> The previous mission (modular monolith: core, ui-kit, extension modules, phases 1–8) is complete and
> merged. Its record lives in git history and in `docs/architecture/MODULAR_MONOLITH_AND_MODULES.md`.

## Goal
Rebuild the cartography watcher — recovered from `stash@{0}` on `feat/cartography-watcher-service` —
as a module that obeys the rules now in force, instead of the parallel module system it shipped with.

The feature: watch open CKAN portals (catalogodatos.gub.uy / IDEuy) for republished cartographic
datasets, detect deltas against a local vault, cache downloads server-side, and let the DB-CSV and
DB-Shapefile sync tools pull a departmental file straight from the catalogue instead of forcing a
manual portal visit, download and file-picker dance.

## What the stash got right, and what changes

The stash built its own module system: a mutable singleton registry, import-time side-effect
registration, and catch-all dispatchers at `/api/modules/[module]` and `/tools/modules/[toolId]`.
The domain work underneath it is sound and is preserved almost intact.

| Stash | Here |
|---|---|
| catch-all `/api/modules/[module]` with `?action=` dispatch | one declared path per endpoint, generated into `/api/m/cartography-watcher/**` |
| `/tools/modules/[toolId]` dynamic dispatcher | a **generated page route**, resolved through the registry (new core capability) |
| `extensionRegistry` singleton + `useSyncExternalStore` | a `FILE_SOURCE_TABS` UI slot with host-supplied context (new core capability) |
| registration by import side effect into global state | the manifest, named once in the composition root |
| two composition roots (`modules/index.ts`, `modules/server.ts`) | one `src/app/modules.registry.ts` |
| sources in `localStorage` **and** `sources.json`, reconciled optimistically | server-side `sources.json` only |
| `WatcherApiAction` string dispatch table | REST paths; the router does the dispatching |

Preserved as-is because it is good: the three-tier delta evaluation (hash → timestamp → size), the
vault layout with sidecar metadata, transparent read-through caching, and the CKAN URL/slug parsing.

---

## Phase A — Core capability: module-owned pages
**Files:** `src/core/modules/**`, `src/ui-kit/modules/**`, `scripts/generate-module-routes.cjs`

A module cannot own a page today. Slots decorate host pages; there is no way to contribute a whole
route. The watcher dashboard needs one.

- Extend the declaration file with an optional `pages` array (`path`, `title`), so one file still
  describes a module's whole routed surface.
- `definePageContributions` binds declarations to components, checked both ways like endpoints.
- Registry gains `pages()` / `findPage(routePath)`.
- The generator emits `src/app/tools/m/<id>/<path>/page.tsx`: resolves through the registry, calls
  `notFound()` when nothing serves it, exports `metadata` from the declared title. It never imports
  a module — same property the endpoint routes have.
- `--check`, `predev` and `prebuild` cover pages exactly as they cover endpoints.

**Done when:** a module declaring a page is served at `/tools/m/<id>`, and deleting it removes the
route file and leaves the app building.

## Phase B — Core capability: slots that carry context
**Files:** `src/ui-kit/modules/**`, `src/components/tools/db-csv-sync/CsvUploader.tsx`,
`src/components/tools/db-shapefile-sync/ShapefileUploader.tsx`

A contribution renders with no props, which is right for a card and useless for a file picker that
must hand a `File` back to its host.

- Add `UiSlot.FILE_SOURCE_TABS`, plus `FileSourceSlotContext` in ui-kit: the host publishes
  `{ toolId, format, onSelectFile, isLoading }`, the contribution reads it through a hook.
- Add `ModuleTabbedSlot`: renders its children alone when nothing is contributed — byte-identical to
  today — and a tab strip plus the active panel when something is. `UiContribution` gains optional
  `label` and `Icon` for hosts that draw chrome around a contribution.
- Mount the slot in both uploaders. With no modules registered they behave exactly as they do now.

**Done when:** both uploaders render unchanged with zero modules, and host a tab when one contributes.

## Phase C — The module: domain and services
**Files:** `src/modules/cartography-watcher/**`

- `domain/` — pure, no `fs`, no `fetch`: delta evaluation, vault naming, catalogue mapping and format
  predicates, portal URL parsing, summary derivation, Spanish formatters.
- `services/` — I/O only: `CkanPortalClient` (injectable fetch), `VaultStorageService` (injectable
  root), `WatchedSourcesStorageService`, and `WatcherOrchestrator` composing them.
- Dependencies are injected at every seam, so the logic is testable without network or disk.

## Phase D — The module: endpoints, page, contributions
- Endpoints, one path each: `GET sources`, `POST sources`, `POST sources/remove`, `GET summaries`,
  `GET catalog`, `GET catalog/file`, `POST resources/download`.
- Page: the dashboard at `/tools/m/cartography-watcher`.
- Contributions: a home-grid card, and the catalogue tree into `FILE_SOURCE_TABS`.
- `src/data/toolsData.ts` is **not** touched — the module brings its own card.

## Phase E — Tests
Domain logic against real calculations; services against a temp vault directory; the CKAN client
against an injected fetch; handlers against an injected orchestrator; the manifest for binding, page
declaration and slot targeting. Component rendering is not covered — the suite has no DOM runner.

## Phase F — Verification and documentation
- Gauntlet; live run against the real portal (reachable: `ide-ejes-vias-circulacion` currently
  publishes 21 resources, 19 of them departmental CSVs).
- Deletion proof: folder + registry line + test folder, regenerate, clean `.next`, gauntlet.
- Document the two new core capabilities in the authoring rule and the architecture doc, and the
  module itself under `docs/tools/`.

---

## Deliberately out of scope
- **Auto-load by query parameter.** The stash let the dashboard hand a file to a sync tool through
  `?sourceSlug=&resourceId=`, which required core uploaders to know about an extension's `autoLoad`.
  The catalogue tab reaches the same outcome from inside the tool, so the extra contract is not
  bought yet.
- **Vault eviction.** The vault grows without bound, as it did in the stash. Worth solving; not now.

## Known limitation being carried
A handler receives only the `Request`, so a declared dynamic segment (`[id]`) has to be read by
parsing the URL. That is why removal is `POST sources/remove` with a body rather than
`DELETE sources/[id]`. Passing route params into handlers is a candidate follow-up.

---

## Outcome

All phases delivered. `npm test` 301 cases across 29 files; lint, build and doctor clean
(100 / 100, zero findings); the generated tree matches its declarations.

### Core capabilities added

| Capability | Files |
|---|---|
| Module-owned pages | `core/modules/contracts.ts`, `definePageContributions.ts`, `createModuleRegistry.ts`, the generator |
| Slots that carry context | `ui-kit/modules/ModuleTabbedSlot.tsx`, `FileSourceSlotContext.tsx`, both uploaders |

`ToolWorkspaceLayout`, `Header` and `Footer` moved from `src/components/layout/` into
`src/ui-kit/components/layout/`. All five tool pages already shared them, and a module page needs
the same shell to look native — modules may not import `@/components/*`.

### Verified against the live portal

`catalogodatos.gub.uy` was reachable throughout, so the module was exercised against real data
rather than a fixture:

- `catalog?format=CSV` returned both shipped sources with 19 departmental CSVs each.
- A cold `catalog/file` transferred 1 278 337 bytes and wrote `flores.csv` with its sidecar; the
  next request returned identical bytes without transferring the file again.
- `summaries` reported `NOT_DOWNLOADED, 20/21 pendientes` for a source with one file downloaded.
- The generated page, the home card and both API surfaces render and answer.

### Deletion proof

Folder, registry line and test folder removed, tree regenerated, `.next` cleared: route table back
to baseline, 188 tests green, lint and build clean. Restored: 301 tests, doctor 100 / 100.

### Defects found and fixed during the build

1. **The badge contradicted its own count.** A source with one file downloaded and twenty missing
   reported *al día* beside "20 pendientes". This is the misleading zero-delta state the original
   ISSUE_021 set out to kill — fixed there in the count, but the badge rule kept the old shape. The
   badge now agrees with the count: a stale copy outranks a missing one, and nothing else is
   "up to date".
2. **The cache served stale files for ever.** `getResourceFile` returned whatever was in the vault
   without checking whether the portal had republished it. It now re-checks metadata on every
   request and re-fetches when superseded. That also removed the need for a separate forced-download
   endpoint, which had no caller left.
3. **A matching checksum was being overruled by a newer timestamp**, causing pointless re-downloads
   of unchanged files. A checksum that matches now settles the question.
4. **Icons could not cross the RSC boundary.** A lucide icon referenced from a manifest is evaluated
   on the server and fails the production build. Every component a manifest names must come from a
   `"use client"` module; the rule is documented and the module re-exports its icon accordingly.

### Not verified

The catalogue tab renders inside an uploader that only mounts after a live PostgreSQL connection,
and the suite has no DOM runner, so the tab strip itself was never rendered end to end. What is
covered: the contribution reaches the client (it appears in the RSC payload), the slot renders
children alone when nothing is contributed, and every piece of logic behind the tab. Driving it
would need Playwright with a stubbed database.

### Carried forward

- A handler receives only the `Request`, so a declared `[id]` segment must be parsed out of the URL.
  Passing route params into handlers is the obvious follow-up.
- The vault grows without bound.
- `useFileSourceSlot` is an unused export in a tree with no file-source contribution registered; the
  doctor flags it in that state only.
