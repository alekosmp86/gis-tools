# Structure

Evidence: `src/modules/address-dedup/`, `src/modules/cartography-watcher/` (both inspected via `find`), `AGENTS.md` ("Modular Monolith & Module Authoring" section), `.agents/rules/module_authoring.md`.

## Learned convention (consistent across both existing modules — no variants, no ADR needed)

The toolkit's bundled default (`conventions/feature-structure.default.md`, `src/features/<feature>/{components,hooks,context,helpers,constants,types}`, colocated tests) does **not** apply here and is not installed, per that file's own rule ("when discovery finds a different convention, that convention wins").

Real convention, a modular monolith:

```
src/modules/<id>/
  api/        HTTP handlers (Request/Response, never NextRequest/NextResponse)
  domain/     domain logic, framework-free
  services/   application services (address-dedup also has services/queries/)
  data/       data-access layer
  ui/         React components/hooks owned by the module
  module.routes.json   HTTP surface declaration (moduleId === folder name)
```

- Composition root: `src/app/modules.registry.ts` — the only file allowed to import a module.
- Boundary invariant (enforced by `eslint.config.mjs`, not by review): `core/` and `ui-kit/` never import from `modules/`; no module imports another module; cross-module needs go through a contract in `src/core/modules/`.
- Generated routes: `src/app/api/m/**`, emitted by `scripts/generate-module-routes.cjs` from each module's `module.routes.json`. Never hand-edited.
- Reference implementation: `src/modules/cartography-watcher`.
- Legacy code (pre-dating the module convention) lives directly under `src/app`, `src/components`, `src/core`, `src/data`, `src/hooks`, `src/providers`, `src/ui-kit` and is explicitly **not** migrated into modules retroactively ("Modules Are for What Comes Next" — never migrate a working tool into a module).

## Tests — not colocated

```
tests/unit/modules/<id>/     unit tests for a module
tests/unit/core/...          unit tests for legacy/core code (binary, common, spatial, ...)
tests/unit/hooks/, services/, utils/, workers/, scripts/
tests/e2e/flows/             Playwright end-to-end flows
tests/e2e/fixtures/, support/
```

Test globs for any future implementer/test-writer permission split (design doc section 7): `tests/unit/**/*.test.ts`, `tests/e2e/**`.

## Module deletion acceptance test (from AGENTS.md)
A module's deletion set is exactly three things: its folder, the `modules.registry.ts` line, and `tests/unit/modules/<id>/`. Nothing else should need touching.

## Open questions
- None — both existing modules (`address-dedup`, `cartography-watcher`) follow the same layout. No canonical-structure ADR required.
