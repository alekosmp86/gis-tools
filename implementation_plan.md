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
| 6 — Endpoint generation | **blocked on a decision** | — |
| 7 — Reference module and deletion proof | not started | — |
| 8 — Rules and documentation | not started | — |

### Phase 6 open question: how does the generator read endpoint declarations?

The generator is a plain Node script and cannot import a TypeScript manifest without a loader.
No TS-capable runner is installed (`tsx` / `ts-node` absent), and installing one on this machine is
slow and unreliable because of the local TLS interception. Three options, none yet chosen:

1. **Declarative JSON per module** (`src/modules/<id>/module.routes.json`) listing path, method,
   runtime and dynamic. The TypeScript manifest imports the same JSON and maps each path to its
   handler, so there is one source of truth and nothing to drift. Needs `resolveJsonModule`.
   No new dependencies. Currently the front-runner.
2. **Convention-based discovery**: the generator globs `src/modules/*/api/**/handler.ts` and derives
   the route from the file path. Zero declaration, but it splits endpoint knowledge away from the
   manifest the registry validates.
3. **Add a TypeScript loader** so the generator imports the real manifest. Cleanest single source of
   truth, at the cost of a dependency and an install that has already proven painful here.

Whichever is chosen, the staleness controls stay as specified: `predev` / `prebuild` hooks so the
generator always runs before dev and build, and a `--check` mode wired into the gauntlet so a
committed stale tree fails loudly.

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
