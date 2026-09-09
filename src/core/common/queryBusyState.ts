/**
 * queryBusyState
 *
 * TanStack Query v5's `useQuery` returns an *optimistic* result. On the client's first render —
 * the hydration render — the observer already knows it will fetch on mount (there is no cached
 * data and `refetchOnMount` defaults to true), so it reports `isFetching === true` before any
 * effect has run. On the server nothing ever mounts and no fetch is scheduled, so `isFetching`
 * stays `false`. `isFetching` is therefore **structurally guaranteed to differ** between the SSR
 * HTML and the first client render, and any DOM output derived from it — a `disabled` attribute,
 * a class name, a label — mismatches on hydration.
 *
 * `isPending`, by contrast, is `true` on BOTH the server render and the client's first render:
 * neither side has data yet. That agreement is what keeps hydration stable, and it is the entire
 * reason this helper exists.
 *
 * Do NOT "simplify" a busy indicator back to raw `isFetching`. That reintroduces the hydration
 * mismatch this helper was written to close. Use `isQueryBusy` for every DOM output — disabled
 * state, spinner class, label text — derived from a query's loading state.
 *
 * **Precondition.** This holds only while the query has neither `initialData` nor `placeholderData`,
 * so that `isPending` is `true` on both first renders. Either option flips the query out of the
 * pending state while the client still refetches on mount, which breaks the agreement above; a
 * query seeded that way needs server-side prefetch or an explicit mounted gate instead.
 */
export interface QueryBusyStateInput {
  readonly isPending: boolean;
  readonly isFetching: boolean;
}

export function isQueryBusy(queryState: QueryBusyStateInput): boolean {
  return queryState.isPending || queryState.isFetching;
}
