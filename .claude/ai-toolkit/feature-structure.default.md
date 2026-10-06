# Default feature structure and naming convention

Used by `create-feature` and by the traceability reviewer when a project has no convention of its own. Discovery pass 1 learns the project's real convention from existing features; this file applies only when none is found or the project is greenfield.

## Layout

```
<features-root>/<feature>/
  components/  PascalCase.tsx, feature-prefixed (OrdersTable, OrdersStatusPill)
  hooks/       useCamelCase.ts
  context/     PascalCase.context.tsx (OrderDraft.context.tsx)
  helpers/     kebab-case.helpers.ts
  constants/   kebab-case.constants.ts
  types/       kebab-case.types.ts
```

`<features-root>` is a project parameter (default `src/features`; monorepos typically use something like `apps/<app>/src/features`). `<feature>` is kebab-case: lowercase, spaces and underscores become hyphens, anything outside `[a-z0-9-]` is stripped.

## Rules

- One category per file: no constants inside component files, no helpers inside hooks.
- Tests colocated: `Foo.tsx` + `Foo.test.tsx`. The test globs for the implementer / test-writer permission split are therefore `**/*.test.{ts,tsx}` plus any `__tests__/` or `e2e/` folder the project has.
- Feature prefix appears once in a component name, never twice. A component that would restate the feature name is named for the concern it owns (`OrderDetailsShippingInfo`, not `OrderDetailsOrderDetails`). The core piece of a feature takes a generic suffix (`Main`, `Content`, `Overview`, `Summary`, `Data`), for example `OrderDetailsMain`.
- No barrels: no `index.ts` re-exporting a folder. Import the concrete module.
- No cyclic dependencies at any level.
- Feature-scoped code lives in the feature folder. Shared schemas and reusable UI primitives live in their packages, not in features. Route files stay in the framework's routing folder; features hold the domain logic and components those routes compose.

## How it is applied

- `create-feature` scaffolds the six category folders with `.gitkeep`, using `<features-root>` from the project's context file (`.claude/ai-toolkit/context/structure.md`). The root and the category list come from the project context file, then environment variables, then the defaults.
- The level 1 `Stop` hook validates category placement and file naming against this layout (or the project's own).
- When discovery finds a different convention, that convention wins and this file is not installed. When it finds several conflicting ones, the human picks the canonical one and the decision is recorded as an ADR.
