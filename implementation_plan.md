# Implementation plan — Modular monolith: core, ui-kit and extension modules

## Goal
Turn everything that exists today into a stable **core**, and add the machinery for **modules** that
can contribute UI and API endpoints without core ever knowing they exist. Adding a module must touch
nothing but its own folder plus one registry line; deleting it must leave the application working.

## Decisions taken
- **Everything currently in the repository is core.** The four sync tools, the viewers and all shared
  machinery stay. No feature migrates into a module. Modules are for what comes *next*.
- **Core is split**: a headless `core/` with no React, and a `ui-kit/` for shared components.
- **Endpoints are generated at build time** from module manifests into real Next route files, keeping
  per-route configuration (`runtime`, caching, streaming) available.

## Vocabulary
| Layer | Holds | May import |
|---|---|---|
| `src/core/` | domain types, spatial math, parsers, db access, streaming, module contracts | `core` only |
| `src/ui-kit/` | shared React components and hooks | `core`, `ui-kit` |
| existing tools (`src/app/tools/*`, `src/components/tools/*`) | today's features, treated as core features | `core`, `ui-kit` |
| `src/modules/<name>/` | a module's ui, api handlers, types, manifest | `core`, `ui-kit`, own folder |
| `src/app/modules.registry.ts` | the composition root: the only file naming every module | `core`, `modules` |

**The invariant:** nothing in `core/` or `ui-kit/` may import from `modules/`, and no module may import
another module. Cross-module needs go through contracts defined in core.

---

## Phase 1 — Enforce the boundaries before drawing them
**Files:** `eslint.config.mjs`

- Add `import/no-restricted-paths` zones expressing the table above, so a violation is a lint error,
  not a code-review opinion.
- Land this first, while the rules are trivially satisfiable. Enforcement added after a refactor only
  documents the violations that already crept in.

**Done when:** an import from `core/` into `modules/` fails `npm run lint`.

## Phase 2 — Extract the headless core
**Files:** `src/core/**` (moved from `src/utils/spatial`, `src/utils/binary`, `src/utils/common`,
`src/services/**`, `src/types/**`, `src/workers/comparison/**`)

- Move domain logic with no React dependency: geometry parsers, `GeoJsonDatasetBuilder`,
  `FeatureRecordIndex`, `DatabaseStreamReader`, comparison engines, SQL generation, shared types.
- Pure moves plus import-path updates. No behaviour changes, so the existing 82 tests are the safety
  net: they must stay green throughout, and their own import paths update with the code.

**Done when:** `core/` contains no React import, and the suite passes unchanged.

## Phase 3 — Extract the shared UI kit
**Files:** `src/ui-kit/**` (moved from `src/components/shared`, `src/components/ui`, `src/hooks/map`)

- Move genuinely shared components: `SpatialMapPreview` and its map hooks, `AttributeTable`,
  `WizardOrchestrator`, `AlertMessage`, `PaginationControls`, `DbConnectionForm`.
- Tool-specific components stay where they are; this is not a general reshuffle.

**Done when:** the tools import shared UI from `ui-kit/` and nothing from each other.

## Phase 4 — Module contracts and the composition root
**Files:** `src/core/modules/**`, `src/app/modules.registry.ts`

- Define in core, implemented by modules, referenced by neither: a `ModuleManifest` describing the
  module's id, display metadata, navigation entries, UI contributions and endpoint handlers.
- Define a `ModuleRegistry` that accepts manifests and answers questions about them. Core depends on
  the *shape*, never on any instance.
- The composition root is one file listing the active modules. Deleting a module = delete its folder,
  delete its line. Nothing else references it.

**Done when:** the registry resolves an empty module list without core referencing `modules/` at all.

## Phase 5 — UI extension slots
**Files:** `src/ui-kit/slots/**`, host pages

- Add named slots (`home.toolGrid`, `tool.sidebar`, `map.toolbar`, `nav.primary`) that render whatever
  the registry has for that slot and nothing when empty.
- Slots must degrade silently: a page with no contributions renders exactly as it does today. That is
  what makes module removal safe.
- Errors in a module's contribution are caught at the slot boundary, so a broken module cannot take
  down a core page.

**Done when:** existing pages render identically with zero modules registered.

---

## Progress (session of 2026-09-09)

| Phase | State | Commit |
|---|---|---|
| 1 — Enforce boundaries | done | 5c69032 |
| 2 — Extract headless core | done | b58a202 |
| 3 — Extract ui-kit | done | d7c92dc |
| 4 — Contracts, registry, composition root | done | 33db302 |
| 5 — UI extension slots | done | 7e09b60 |
| 6 — Endpoint generation | done | — |
| 7 — Reference module and deletion proof | not started | — |
| 8 — Rules and documentation | done | — |

### Phase 6 decision: declarative JSON per module

The open question was how a plain Node generator reads endpoint declarations without a TypeScript
loader. **Option 1 was chosen**: each module declares its HTTP surface in
`src/modules/<id>/module.routes.json`, and its TypeScript manifest imports the same file and binds a
handler to each declaration through `defineModuleEndpoints`. One source of truth, read by both
halves, and no new dependency behind the local TLS interception.

Convention-based discovery was rejected because it moves the endpoint surface into file names, away
from the manifest the registry validates. A TypeScript loader was rejected on install risk, and
because importing a manifest at generate time would drag the module's whole graph — `pg`, core
services — into a build script.

The binding is checked rather than trusted: a declaration with no handler, or a handler for an
endpoint nobody declared, throws at startup. Methods, runtimes and caching modes arriving from JSON
are validated on both sides, and the generator's mirrored copies of those constants are held to
core's by a unit test.

### Phase 6 as built

- `src/modules/<id>/module.routes.json` — the declaration file: `moduleId` (must match the folder)
  and endpoints of `path`, `method`, optional `runtime` and `dynamic`.
- `src/core/modules/defineModuleEndpoints.ts` — binds declarations to handlers, validating both ways.
- `src/core/modules/createModuleRouteHandler.ts` — per-request dispatch through the registry, so a
  generated route never imports a module and a route left behind by a deleted one answers 404
  instead of crashing at boot.
- `src/core/modules/moduleRoutePaths.ts` — the path arithmetic the registry, the binder and the
  generator all agree on.
- `scripts/generate-module-routes.cjs` — emits one banner-carrying route file per path under
  `src/app/api/m/**`, groups methods that share a path into one file, and rejects two methods on one
  path asking for different runtimes (Next configures those per file).
- `npm run modules:routes` / `modules:routes:check`, wired into `predev`, `prebuild` and the gauntlet.

**Verified** with a temporary `diagnostics` module carrying three endpoints, including a dynamic
`[id]` segment: `npm run build` served all three, a live server answered each of them, an undeclared
method got 405, and deleting the module's folder emptied the generated tree without touching the
hand-written routes under `src/app/api/db/**`. The module was removed again — phase 7 builds the
real pilot.

## Phase 6 — Endpoint generation
**Files:** `scripts/generate-module-routes.cjs`, `package.json`, generated `src/app/api/m/**`

- Read each manifest's endpoint declarations and emit thin Next route files that delegate into the
  module's handler, carrying through any per-route configuration the manifest requests.
- **Reintroduce `ModuleRuntime` and the `runtime` / `dynamic` fields on `ModuleEndpoint`** in the same
  change as the generator that honours them. They were removed from the contracts because nothing
  read them: a module could declare `runtime: EDGE`, be served on Node, and get no signal. Config the
  system silently ignores is worse than config it does not offer.
- Every generated file gets a "generated — do not edit" banner and is committed, so the served surface
  is visible in review.
- **Staleness controls**: wire the generator into `predev` and `prebuild` so it always runs before dev
  and build, and add a `--check` mode that diffs regenerated output against disk and exits non-zero on
  drift. Add `--check` to the quality gauntlet, so a stale tree cannot pass.
- Core's own routes under `src/app/api/db/**` are untouched and remain hand-written.

**Done when:** adding an endpoint to a manifest and running `npm run build` serves it, and committing
a stale tree fails the gauntlet.

## Phase 7 — Reference module and the deletion proof
**Files:** `src/modules/<pilot>/**`

- Build one small real module end to end: its own types, one endpoint, one UI contribution, one nav
  entry.
- **Then delete it**: remove the folder and the registry line, run the full gauntlet, and confirm the
  application builds and behaves exactly as before. Restore it and confirm again.
- This is the acceptance test for the entire architecture. Until it passes, the extension points are
  a hypothesis.

**Done when:** add → works, delete → nothing breaks, restore → works, gauntlet green at each step.

## Phase 8 — Rules and documentation
**Files:** `AGENTS.md`, `.agents/rules/**`, `docs/architecture/**`

- The existing rule places all domain types in `src/types/`. Modules must own their contracts, so the
  rule needs a carve-out: core types in `core/`, module types inside the module, shared contracts in
  `core/modules/`.
- Document the layer table, the invariant, and the module authoring steps.
- Regenerate the dependency graph (`npm run graph`) as visual proof the boundaries hold.

### Phase 8 as built

- `.agents/rules/module_authoring.md` — canonical, prescriptive: module-or-core decision, layer
  table, module anatomy, the six-step recipe, eight hard rules, the done checklist, and a failure
  table mapping each error message the machinery emits to its cause and fix.
- `docs/architecture/MODULAR_MONOLITH_AND_MODULES.md` — the rationale: layers, contracts, registry,
  slots, the generation pipeline, why JSON was chosen over discovery and a TS loader, the staleness
  controls, and a map of every file in the machinery.
- `AGENTS.md` gained a "Modular Monolith & Module Authoring" section pointing at both, and the type
  rule gained its carve-out (core types in `core/types/`, presentation types in `ui-kit/types/`,
  host/module contracts in `core/modules/`, module types inside the module). Mirrored into
  `.agents/rules/coding_guidelines.md`, whose stale `src/types/` and "Alekos" items were corrected.
- Both documents state plainly that only `HOME_TOOL_GRID` is mounted and that
  `registry.navigation()` has no consumer, so nobody contributes into a slot that renders nowhere.

- The dependency graph classifier was taught the new layers: `core/` splits by concern (spatial,
  binary, services, workers, types, constants, module contracts), `ui-kit/` by components, hooks,
  types and extension slots, plus a `module` type carrying extension modules and the composition
  root, and a distinct subtype for generated module routes. The dead `services/` / `utils/` /
  `types/` / `workers/` top-level branches were removed. Regenerated: **160 files, 410 imports, 0
  cycles, 0 unclassified**.

### Finding from the regenerated graph: one upward import in ui-kit

`ui-kit/components/DbConnectionForm.tsx` imports `@/hooks/useDbConnectionForm`, and that hook in turn
imports `@/hooks/useDbQueries` and `@/data/dbConfigData`. ui-kit is supposed to import `core` and
`ui-kit` only.

Lint did not catch it: the ui-kit zone in `eslint.config.mjs` restricts `@/app/*` and
`@/components/tools/*` but never `@/hooks/*`, `@/components/*` or `@/data/*`. The rule is narrower
than the table it was meant to express.

The chain is small and has no upward dependencies of its own, so the fix is mechanical:

| Move | Why |
|---|---|
| `src/hooks/useDbQueries.ts` → `src/ui-kit/hooks/` | depends only on `@tanstack/react-query` and core; consumed by ui-kit and one tool hook |
| `src/hooks/useDbConnectionForm.ts` → `src/ui-kit/hooks/` | single consumer, and it is the ui-kit component itself |
| `src/data/dbConfigData.ts` → `src/core/constants/` | one `DbConfig` default, typed by a core type |

Then widen the ui-kit lint zone to `@/hooks/*`, `@/components/*`, `@/data/*` and `@/providers/*` so
the gap cannot reopen. The lint rule must be widened *after* the moves, or the gauntlet fails on the
existing violation.

**Applied.** `useDbQueries` and `useDbConnectionForm` moved into `src/ui-kit/hooks/`,
`INITIAL_DB_CONFIG` into `src/core/constants/dbConfigDefaults.ts`, and the ui-kit and modules lint
zones now forbid `@/app/*`, `@/components/*`, `@/hooks/*`, `@/data/*` and `@/providers/*` — the
previous `@/components/tools/*` group was narrower than the table it expressed. The regenerated
graph reports **0 boundary violations, 0 cycles, 0 unclassified**. Because the UI half has no
automated coverage, all five tool pages were loaded against a production build: every one returns
200, and the four that use `DbConnectionForm` still server-render it.

---

## Risks
- **A large number of import-path updates.** Phases 2 and 3 are mechanical but wide. The 82 unit tests
  cover the domain half well; the UI half has no automated coverage, so tool pages need manual checks.
- **Slots are only as safe as their error handling.** A module contribution that throws during render
  must not break the host page; the boundary is what makes deletion and failure equivalent.
- **Generated routes are a build-order dependency.** Mitigated by `predev`/`prebuild` and the `--check`
  gate, but a contributor running `next build` directly bypasses the npm hook.
- **The microservices endgame applies to the API surface only.** Parsers, workers and map rendering run
  in the browser and will never extract. The discipline still pays off in the monolith; the plan does
  not assume otherwise.
