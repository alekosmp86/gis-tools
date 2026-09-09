# Implementation plan — React Query SSR hydration mismatch in module refresh buttons

> The previous mission (cartography watcher as a first-class module) is complete and merged. Its
> record lives in git history and in `docs/architecture/MODULAR_MONOLITH_AND_MODULES.md`.

## Symptom

Loading the home page raises a React hydration error in the browser console:

```
A tree hydrated but some attributes of the server rendered HTML didn't match the client properties.

  <button
    type="button"
    className="ServerStatusCard-module__TaSY2q__refreshButton"
    onClick={function t14}
+   disabled={true}      <- client
-   disabled={null}      <- server
  >
```

The reported element is the refresh button of `ServerStatusCard`, the status module's contribution
to `UiSlot.HOME_TOOL_GRID`.

## Root cause

TanStack Query v5's `useQuery` returns an **optimistic** result. On the client's first render — the
hydration render — the observer already knows it will fetch on mount (there is no cached data and
`refetchOnMount` defaults to true), so it reports `fetchStatus: "fetching"` and therefore
`isFetching === true` before any effect has run.

On the server there is no mount and no fetch is ever scheduled, so `fetchStatus` stays `"idle"` and
`isFetching === false`.

`isFetching` is therefore **structurally guaranteed to differ** between the SSR HTML and the first
client render. Any DOM output derived from it mismatches on hydration.

`isPending`, by contrast, is `true` on both sides — neither the server nor the first client render
has data. That asymmetry is the key, and it is what the fix exploits.

### Why the error named only `disabled`

Three outputs on that one button derive from `isFetching`, not one:

| File | Line | Output |
|---|---|---|
| `src/modules/status/ui/ServerStatusCard.tsx` | 83 | `disabled={isFetching}` |
| `src/modules/status/ui/ServerStatusCard.tsx` | 85 | `className={isFetching ? styles.spinning : undefined}` |
| `src/modules/status/ui/ServerStatusCard.tsx` | 86 | label text `{isFetching ? "Actualizando..." : "Actualizar"}` |

React reported the attribute mismatch first and bailed out of the subtree, masking the className and
text mismatches behind it. Fixing only `disabled` would leave two live mismatches.

### A second, latent instance

`src/modules/cartography-watcher/ui/WatcherDashboard.tsx` carries the identical triple on
`summariesQuery.isFetching`:

| Line | Output |
|---|---|
| 91 | `disabled={summariesQuery.isFetching}` |
| 95 | `className={summariesQuery.isFetching ? styles.spin : undefined}` |
| 97 | label text `{summariesQuery.isFetching ? "Actualizando..." : "Revisar ahora"}` |

That component is a module page, so it is server-rendered on direct navigation and reproduces the
same bug. It is in scope: it is the same defect, not a second feature.

`WatcherHomeCard.tsx` and the other `isPending`/mutation `isPending` consumers are **not** affected —
`isPending` agrees across server and client, and mutation state is idle on both sides.

## Goal

When this is done:

1. The home page hydrates with **zero** hydration warnings in the browser console.
2. The cartography watcher dashboard page hydrates with zero hydration warnings.
3. Both refresh buttons still correctly show a busy state during an in-flight fetch and return to an
   idle state afterwards.
4. The rule that produces a hydration-safe busy flag is pinned by unit tests.

## Approach

Derive a single busy flag that agrees across server and client:

```ts
isBusy = isPending || isFetching
```

| Situation | `isPending` | `isFetching` | `isBusy` |
|---|---|---|---|
| Server render | true | false | **true** |
| Client hydration render | true | true | **true** |
| After data arrives | false | false | false |
| Interval refetch / manual refresh | false | true | true |

Server and client first renders both produce `true`, so the hydrated DOM matches. Use the one flag
for **all three** outputs on each button — `disabled`, the spinner class and the label — so no
`isFetching`-derived output survives.

This also corrects a real UX defect: today the button reads "Actualizar" and is clickable during the
initial load, when the card is demonstrably still loading. After the fix it reads "Actualizando..."
and is disabled, which is the truth.

### Alternatives considered and rejected

- **`suppressHydrationWarning`** — silences the symptom, leaves the DOM genuinely divergent, and does
  not cover the text child. Rejected: it hides the class of bug rather than fixing it.
- **A mounted-gate (`useState(false)` + `useEffect`)** — works, but adds a render pass and a piece of
  ceremony to every component that ever touches `isFetching`. Rejected as heavier than the invariant
  needs.
- **Server prefetch + `HydrationBoundary`** — the architecturally strongest answer, and it would also
  remove the loading flash. Rejected **for this fix**: it means a real data-fetching redesign
  (per-request `QueryClient`, prefetch in a server component, a dehydrated state through the slot
  system), which is a feature, not a bug fix. Recorded in the issue doc as possible future work.

### Where the shared helper lives

Both affected components are modules, and **no module may import another module**
(`eslint.config.mjs`, `CROSS_MODULE_MESSAGE`). The shared rule therefore belongs in `core/`, which
both may import. It is pure boolean logic with no React import, so it respects the headless-core
constraint.

**`src/core/common/queryBusyState.ts`** — sits alongside the existing pure helpers in
`src/core/common/` (`ValueFormatter.ts`, `GisStringSanitizer.ts`).

It must accept a **plain structural object**, not a TanStack Query type, so `core` gains no
dependency on the query library:

```ts
export interface QueryBusyStateInput {
  readonly isPending: boolean;
  readonly isFetching: boolean;
}

export function isQueryBusy(queryState: QueryBusyStateInput): boolean;
```

The doc comment on that function is the real payload: it must explain *why* the rule exists, so the
next author does not "simplify" it back to `isFetching` and reintroduce the bug.

## Files

**Created**
- `src/core/common/queryBusyState.ts`
- `tests/unit/core/common/queryBusyState.test.ts`
- `docs/issues/ISSUE_025_REACT_QUERY_SSR_HYDRATION_MISMATCH.md`

**Changed**
- `src/modules/status/ui/ServerStatusCard.tsx` — use `isQueryBusy` for all three button outputs
- `src/modules/cartography-watcher/ui/WatcherDashboard.tsx` — same, for its three
- `docs/README.md` — add ISSUE_025 to the index
- `implementation_plan.md` — this file

**Deleted** — none.

## Tests

`tests/unit/core/common/queryBusyState.test.ts`, AAA-structured, covering the real truth table:

1. server render (`isPending: true, isFetching: false`) → `true`
2. client hydration render (`isPending: true, isFetching: true`) → `true`
3. **the invariant that fixes the bug**: cases 1 and 2 return the *same* value — assert them equal,
   so a regression is caught as the hydration bug it is rather than as a bare boolean change
4. settled with data (`false, false`) → `false`
5. background refetch (`false, true`) → `true`
6. offline/paused query (`isPending: true, isFetching: false`) → `true`

No component render test: Vitest runs `environment: "node"`, `include` matches only
`tests/unit/**/*.test.ts`, and the project has no jsdom, happy-dom or Testing Library. Installing UI
test infrastructure is a separate, deliberate decision and is **out of scope** here.

## Out of scope

- Installing jsdom / Testing Library / any UI test infrastructure.
- Server-side prefetch or `HydrationBoundary` (recorded as future work in the issue doc).
- Any change to `src/providers/QueryProvider.tsx`.
- `WatcherHomeCard.tsx`, `CatalogTreeSelector.tsx`, `DbTableViewerContainer.tsx`,
  `DbConnectionForm.tsx` and every other `isPending` / mutation-state consumer — not affected.
- Restyling, relabelling or otherwise redesigning either card beyond the busy-state strings already
  present.
- Touching `src/app/api/m/**` (generated) or any module route declaration.

## Risks

- **Offline/paused queries.** When a query is paused for lack of network, `fetchStatus` is
  `"paused"`, so `isFetching` is false while `isPending` stays true, leaving the button disabled for
  as long as the client is offline. This is deliberate — there genuinely is no data to refresh — but
  it must be called out in the issue doc.
- **Incomplete application.** Fixing `disabled` while leaving the className or label on raw
  `isFetching` leaves the bug alive and the console still dirty. All three outputs per button, both
  components, or the fix is not done.
- **Regression pressure.** `isPending || isFetching` looks redundant to a reader who does not know
  the SSR reason. The doc comment and test 3 exist to defend it.
