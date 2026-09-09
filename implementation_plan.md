# Implementation plan — remove the status module

> The previous mission (React Query SSR hydration mismatch) is complete and committed on
> `fix/query-ssr-hydration-mismatch` as `46c4220`. Its record lives in
> `docs/issues/ISSUE_025_REACT_QUERY_SSR_HYDRATION_MISMATCH.md`.

## Why

The status module publishes server uptime, Node version and execution environment, and contributes a
card to the home tool grid. The user's judgement: it gives no useful insight for the purpose of this
app. It is removed.

It was built as the pilot that proved the module system, and it did that job. Its removal now
exercises the deletion property for real, a third time, on a module that has been in `main` across
several commits.

## Goal

When this is done:

1. `src/modules/status/`, its registry line and `tests/unit/modules/status/` are gone.
2. `src/app/api/m/status/route.ts` is gone, removed by regenerating — never by hand.
3. The application builds and behaves exactly as before, minus the card and the endpoint.
4. `GET /api/m/status` no longer exists.
5. No documentation still presents `src/modules/status` as a live worked example.
6. The historical record of what the pilot established is **preserved, not falsified**.

## The deletion set

`AGENTS.md` states a module's deletion set is exactly three things. This is the test of that claim:

| # | Path |
|---|---|
| 1 | `src/modules/status/` (7 files) |
| 2 | the `statusModule` import and array entry in `src/app/modules.registry.ts` |
| 3 | `tests/unit/modules/status/` (2 files) |

Then `npm run modules:routes` prunes `src/app/api/m/status/route.ts`.

**If anything outside that set needs a code change to keep the build green, the module leaked** —
that is a finding worth reporting, not something to quietly patch.

Verified in advance: the only code references to the module outside its own folder are the two
registry lines and its own test files. `tests/unit/core/modules/*.test.ts` use their own fixtures and
do not touch it.

## Documentation — the important half

`cartography-watcher` becomes the **sole** worked example. The "two worked examples / the minimal
one" framing collapses to one.

### Rewrite to point at `cartography-watcher`

| File | Line | What it says now |
|---|---|---|
| `AGENTS.md` | 99 | "A Worked Example Exists: `src/modules/status` is the reference module…" |
| `CLAUDE.md` | 27 | "`src/modules/status/` — the reference module; read it before authoring a new one" |
| `.agents/rules/module_authoring.md` | 47-50 | "**Two worked examples exist.**… `src/modules/status` is the minimal one" |
| `.agents/rules/module_authoring.md` | 52-54 | "**The minimal example lives in `src/modules/status`**…" |
| `.agents/rules/module_authoring.md` | 227-229 | "`src/modules/status` injects the clock and the process readings…" |
| `docs/architecture/…MODULES.md` | 192-210 | section 7 "The reference module", built entirely around status |
| `docs/architecture/…MODULES.md` | 332-333 | machinery map rows for `src/modules/status/**` and its tests |
| `docs/README.md` | 11 | "Includes the reference module (`src/modules/status`)…" |

The two machinery-map rows are **deleted**, not rewritten — those files no longer exist. The
`src/modules/cartography-watcher/**` row at line 340 stays and absorbs the role.

For line 227's point (keep testable logic out of the handler by injecting the clock and process
readings) the *lesson* is sound and must survive — re-anchor it to an equivalent in
`cartography-watcher`, or state it without leaning on a specific file. Do not delete the lesson.

### Preserve as history — do NOT rewrite

Two passages are records of what was actually done at a point in time. Editing them to imply the
status module never existed would falsify the record.

- `docs/architecture/…MODULES.md` **lines 212-219**, the "What the acceptance test established"
  add/delete/restore table.
- `docs/architecture/…MODULES.md` **section 10** (lines ~300-311), how the generator was verified
  with the throwaway `diagnostics` module, which explicitly contrasts itself against "ground the
  status module does not" cover.

Leave their substance intact. Add a short, clearly-marked note recording that the status module was
removed afterwards, that its removal exercised the same deletion property a third time, and that the
passages describe the state at the time they were written.

### Historical issue doc

`docs/issues/ISSUE_025_REACT_QUERY_SSR_HYDRATION_MISMATCH.md` documents the hydration fix and cites
`ServerStatusCard.tsx`, now deleted. It is a historical record of a real fix and its analysis stays
valid — the same bug was fixed in `WatcherDashboard.tsx`, which remains. Add one short note that the
status module was subsequently removed, so a reader is not sent chasing a missing file. Do not
rewrite the analysis and do not remove the `ServerStatusCard` references.

## Files

**Deleted** — `src/modules/status/` (7), `tests/unit/modules/status/` (2),
`src/app/api/m/status/route.ts` (by regeneration).

**Changed** — `src/app/modules.registry.ts`, `AGENTS.md`, `CLAUDE.md`,
`.agents/rules/module_authoring.md`, `docs/architecture/MODULAR_MONOLITH_AND_MODULES.md`,
`docs/README.md`, `docs/issues/ISSUE_025_…md`, `implementation_plan.md`.

**Created** — none.

## Tests

No new tests. The suite **shrinks**, and that is correct: `tests/unit/modules/status/` is part of the
deletion set. Expect 30 files → 28, and 307 tests → fewer.

That drop must not be compensated for. Do not port the status tests somewhere else, do not weaken or
skip anything to keep a number up. Every remaining suite must pass untouched — if any test outside
`tests/unit/modules/status/` fails, the module leaked and that is a finding.

## Out of scope

- Any change to `cartography-watcher`'s behaviour. It only inherits the "worked example" label in
  prose; its code is not touched.
- Any change to `src/core/modules/**` or `src/ui-kit/modules/**`. The extension machinery stays
  exactly as it is — one fewer module is a supported state, and "an empty list is a valid, fully
  working application".
- Hand-editing anything under `src/app/api/m/**`. Regenerate.
- Re-litigating the hydration fix in `46c4220`.
- Adding a replacement card to the home grid.

## Risks

- **Stale docs.** Six files present status as the live example. Missing one leaves the workspace
  rules pointing at a module that no longer exists — the exact debt the user chose to avoid.
- **Falsified history.** Over-zealous find-and-replace across the architecture doc would rewrite the
  acceptance-test record. The split between "rewrite" and "preserve" above is deliberate.
- **Stale build artefacts.** An incremental build keeps the removed module's chunks. The build gate
  must be measured against a **clean `.next`**, per the deletion rule in `AGENTS.md`.
- **Route drift.** Deleting the folder without regenerating leaves an orphan route that
  `modules:routes:check` will catch. Regenerate, do not hand-delete.
