# Issue 025: React Query SSR hydration mismatch on module refresh buttons

> **Note (added later):** the status module — including `ServerStatusCard.tsx`, cited throughout
> this document — was subsequently removed from the application; the user judged it gave no
> useful insight for this app's purpose. The bug and its fix described below remain fully valid:
> the same defect was fixed in `WatcherDashboard.tsx`, which remains, and the file paths below
> record where the bug was actually found and fixed at the time.

## Problem Statement
Loading the home page raised a React hydration error in the browser console:

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

The reported element was the refresh button of `ServerStatusCard`, the status module's contribution
to `UiSlot.HOME_TOOL_GRID`. The identical pattern reproduced on the cartography watcher dashboard
page (`WatcherDashboard`), which is server-rendered on direct navigation to
`/tools/m/cartography-watcher`.

## Root Cause Analysis & Technical Details

### The optimistic result asymmetry
`@tanstack/react-query` v5's `useQuery` returns an **optimistic** result. On the client's first
render — the hydration render — the observer already knows it will fetch on mount (there is no
cached data and `refetchOnMount` defaults to `true`), so it reports `fetchStatus: "fetching"` and
therefore `isFetching === true` before any effect has run.

On the server there is no mount and no fetch is ever scheduled, so `fetchStatus` stays `"idle"` and
`isFetching === false`.

`isFetching` is therefore **structurally guaranteed to differ** between the SSR HTML and the first
client render. Any DOM output derived from it mismatches on hydration.

`isPending`, by contrast, is `true` on both sides — neither the server nor the first client render
has data. That asymmetry between the two flags is the key, and it is what the fix exploits.

| Situation | `isPending` | `isFetching` | Hydration-safe? |
|---|---|---|---|
| Server render | true | false | — (baseline) |
| Client hydration render | true | true | mismatches if derived from `isFetching` alone |
| After data arrives | false | false | agrees |
| Interval refetch / manual refresh | false | true | agrees |

### Why the console reported only `disabled`
Three outputs on the same button derived from `isFetching`, not one:

| File | Output |
|---|---|
| `src/modules/status/ui/ServerStatusCard.tsx` | `disabled={isFetching}` |
| `src/modules/status/ui/ServerStatusCard.tsx` | `className={isFetching ? styles.spinning : undefined}` |
| `src/modules/status/ui/ServerStatusCard.tsx` | label text `{isFetching ? "Actualizando..." : "Actualizar"}` |

React reports the first attribute mismatch it finds and then bails out of reconciling the rest of
that subtree from the server markup, re-rendering it on the client instead. That is why the console
named only `disabled` — the className and text mismatches on the same button were real but were
masked behind the first one reported. Fixing `disabled` alone would have left two live mismatches
that the console had simply not gotten to yet.

`src/modules/cartography-watcher/ui/WatcherDashboard.tsx` carried the identical triple on
`summariesQuery.isFetching` (`disabled`, spinner `className`, and the "Actualizando..." /
"Revisar ahora" label). That component is a module page, so it is server-rendered on direct
navigation and reproduced the same defect — it was in scope as the same bug, not a second feature.

`WatcherHomeCard.tsx`, `CatalogTreeSelector.tsx`, `DbTableViewerContainer.tsx`,
`DbConnectionForm.tsx` and every other `isPending` / mutation-state consumer are **not** affected:
`isPending` agrees across server and client, and mutation state is idle on both sides, so nothing
there is structurally divergent.

## Implemented Solution
Added a hydration-safe busy flag in `core/`, since both affected components are modules and
**no module may import another module** (`eslint.config.mjs`, `CROSS_MODULE_MESSAGE`) — the shared
rule had to live somewhere both may import.

`src/core/common/queryBusyState.ts`:

```ts
isBusy = queryState.isPending || queryState.isFetching
```

| Situation | `isPending` | `isFetching` | `isBusy` |
|---|---|---|---|
| Server render | true | false | **true** |
| Client hydration render | true | true | **true** |
| After data arrives | false | false | false |
| Interval refetch / manual refresh | false | true | true |

Server and client first renders both produce `true`, so the hydrated DOM matches. Both components
now derive one flag from the query result and use it for all three outputs on their button —
`disabled`, the spinner class and the label — so no `isFetching`-derived output survives.

The helper accepts a **plain structural object** (`{ isPending: boolean; isFetching: boolean }`),
not a TanStack Query type, so `core/` gains no dependency on `@tanstack/react-query` and stays
headless (no `react`, no `next/*` imports).

This also corrected a real UX defect: previously the button read "Actualizar" and was clickable
during the initial load, when the card was demonstrably still loading. After the fix it reads
"Actualizando..." and is disabled, which is the truth.

### Offline / paused caveat
When a query is paused for lack of network, `fetchStatus` is `"paused"`, so `isFetching` is `false`
while `isPending` stays `true`. `isQueryBusy` therefore reports `true` and the button stays disabled
for as long as the client is offline. This is **deliberate**, not a bug: there genuinely is no data
to refresh while offline, so "busy/unavailable" is the correct button state, not "idle and
clickable".

### Alternatives considered and rejected
- **`suppressHydrationWarning`** — silences the symptom, leaves the DOM genuinely divergent, and
  does not cover the text child. Rejected: it hides the class of bug rather than fixing it.
- **A mounted-gate (`useState(false)` + `useEffect`)** — works, but adds a render pass and a piece
  of ceremony to every component that ever touches `isFetching`. Rejected as heavier than the
  invariant needs.
- **Server prefetch + `HydrationBoundary`** — the architecturally strongest answer, and it would
  also remove the loading flash entirely. Rejected **for this fix**: it means a real data-fetching
  redesign (a per-request `QueryClient`, prefetching in a server component, threading a dehydrated
  state through the slot/module system), which is a feature, not a bug fix. Recorded here as
  possible future work.

## Code Examples & Diff Snippets

```ts
// src/core/common/queryBusyState.ts — the shared rule
export interface QueryBusyStateInput {
  readonly isPending: boolean;
  readonly isFetching: boolean;
}

export function isQueryBusy(queryState: QueryBusyStateInput): boolean {
  return queryState.isPending || queryState.isFetching;
}
```

```tsx
// Before: all three outputs derive from raw isFetching, mismatching on hydration.
<button type="button" className={styles.refreshButton} onClick={() => refetch()} disabled={isFetching}>
  <RefreshCw size={14} className={isFetching ? styles.spinning : undefined} />
  {isFetching ? "Actualizando..." : "Actualizar"}
</button>

// After: one hydration-safe flag drives every output.
const isBusy = isQueryBusy({ isPending, isFetching });

<button type="button" className={styles.refreshButton} onClick={() => refetch()} disabled={isBusy}>
  <RefreshCw size={14} className={isBusy ? styles.spinning : undefined} />
  {isBusy ? "Actualizando..." : "Actualizar"}
</button>
```

```tsx
// src/modules/cartography-watcher/ui/WatcherDashboard.tsx — same treatment
const isSummariesBusy = isQueryBusy(summariesQuery);

<button
  type="button"
  className={styles.refreshButton}
  onClick={() => queryClient.invalidateQueries({ queryKey: SUMMARIES_QUERY_KEY })}
  disabled={isSummariesBusy}
>
  <RefreshCw size={15} className={isSummariesBusy ? styles.spin : undefined} />
  {isSummariesBusy ? "Actualizando..." : "Revisar ahora"}
</button>
```

## Verification & Testing
`tests/unit/core/common/queryBusyState.test.ts` pins the real truth table, including the invariant
that actually fixes the bug — that the server-render case and the client-hydration-render case
return the *same* value:

```bash
npm run modules:routes:check   # generated routes match module.routes.json declarations
npm run lint                   # 0 errors, 0 warnings
npm test                       # all suites green, including the new queryBusyState suite
npm run build                  # clean Turbopack production build
npm run doctor                 # zero findings (Score unavailable is expected behind local TLS interception)
```

No component render test was added: Vitest runs with `environment: "node"` and `include` matches
only `tests/unit/**/*.test.ts`; the project has no jsdom, happy-dom or Testing Library, and
installing UI test infrastructure to reproduce a hydration mismatch in a test runner is a separate,
deliberate decision left for future work rather than folded into this bug fix.

### Possible future work
Server prefetch + `HydrationBoundary` would let the server render arrive with real data already in
the cache, removing both the hydration risk class and the loading flash on first paint. It was not
implemented here because it requires a per-request `QueryClient`, a server-side prefetch call, and
a way to thread the dehydrated state through the module/slot system — a data-fetching architecture
change, not a bug fix.
