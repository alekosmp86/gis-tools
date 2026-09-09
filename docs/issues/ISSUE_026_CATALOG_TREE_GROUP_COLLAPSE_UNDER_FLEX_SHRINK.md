# Issue 026: Expanding one catalogue group squashed and clipped the others

## Problem Statement
In the cartography catalogue selector (step 2 of the sync wizards, "Catálogo Cartográfico"),
expanding a dataset group visually crushed the other groups instead of making the list scroll.

Expanding **Direcciones Geográficas del Uruguay** — 19 departmental CSV files — left the collapsed
**Ejes de vías de circulación** header above it partially cut off: its border box shrank below the
height of its own content, and the content was clipped rather than shown.

The list already declared a scroll region (`max-height: 520px` with `overflow-y: auto` and a styled
scrollbar), so the intended behaviour was for the list to scroll and every group header to keep its
full height. That scroll never engaged.

## Root Cause Analysis & Technical Details

`.groupList` is a **column flex container** with a capped height:

```css
.groupList {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 520px;
  overflow-y: auto;
}
```

Its children — the `.group` list items — are flex items, and a flex item's default `flex-shrink` is
`1`. Normally that is harmless in a column: the CSS Flexbox specification (§4.5, *Automatic Minimum
Size of Flex Items*) gives each item an automatic minimum size equal to its content, which stops it
being shrunk below what it contains.

**That protection is conditional.** It applies only while the item's computed overflow in the main
axis is `visible`. `.group` opts out:

```css
.group {
  border-radius: 12px;
  border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
  background: rgba(15, 23, 42, 0.55);
  overflow: hidden;   /* clips the child rows to the rounded corners */
}
```

The `overflow: hidden` exists for a good reason — it is what keeps the resource rows inside the
group's 12px rounded corners. But it also drops the item's automatic minimum size to **zero**, which
makes the group freely shrinkable.

The two effects then compound:

1. An expanded group produces roughly 790px of content (a ~45px header plus 19 rows at ~37px), well
   over the 520px cap.
2. Flex shrinking distributes that ~270px overflow across **every** item in the container,
   proportionally to its base size — so the small collapsed header shrinks too.
3. Because nothing is ever allowed to overflow, `overflow-y: auto` finds nothing to scroll and no
   scrollbar appears.
4. `overflow: hidden` on the now-undersized group clips its own header content.

The result reads as "the other group is partially hidden", which is exactly the reported symptom.

This was the only such container in the codebase missing the guard. Every other flex-column scroll
region already pins its children:

| File | Line |
|---|---|
| `src/components/tools/db-sync-common/discrepancies-table/DiscrepanciesTable.module.css` | 39 |
| `src/components/tools/db-sync-common/sql-patch-drawer/SqlPatchDrawer.module.css` | 50 |
| `src/components/tools/db-sync-common/SqlExecutionModal.module.css` | 50, 240 |
| `src/ui-kit/components/ProfileSelect.module.css` | 46, 117 |

## Implemented Solution

`.group` is pinned against flex shrinking, restoring the container's intended overflow-and-scroll
behaviour. This matches the pattern the rest of the codebase already follows, so no new convention is
introduced.

The comment is part of the fix: `flex-shrink: 0` next to an `overflow: hidden` looks removable to a
reader who does not know the two are connected.

## Code Examples & Diff Snippets

```diff
 .group {
   border-radius: 12px;
   border: 1px solid var(--border-subtle, rgba(255, 255, 255, 0.08));
   background: rgba(15, 23, 42, 0.55);
   overflow: hidden;
+  /* `overflow: hidden` zeroes a flex item's automatic minimum size, so without this the scrolling
+     .groupList squashes every group to fit its max-height instead of scrolling — an expanded group
+     clips the collapsed ones above it. */
+  flex-shrink: 0;
 }
```

Behaviour before and after, for the reported case (one group expanded to 19 resources):

| | Before | After |
|---|---|---|
| Collapsed group header height | shrunk below content, clipped | full height, intact |
| `.groupList` scrollbar | never appeared | appears once content exceeds 520px |
| Total list height | forced to 520px by squashing | capped at 520px by scrolling |

## Verification & Testing

No unit test accompanies this change. The defect is a layout outcome produced by the interaction of
`flex-shrink`, `overflow` and `max-height` in a real layout engine; the project's Vitest setup runs
`environment: "node"` with no jsdom, happy-dom or Testing Library, and jsdom does not implement the
flex layout algorithm in any case, so a unit test could only assert that a CSS declaration exists —
which restates the diff rather than verifying the behaviour. Installing browser-based UI test
infrastructure is a separate, deliberate decision.

Gauntlet on the fix branch:

```
npm run modules:routes:check   Generated module routes are up to date (6 route file(s)).
npm run lint                   0 errors, 0 warnings
npm test                       28 files, 286 tests passed
npm run build                  clean Turbopack production build
npm run doctor                 Score 100 / 100 — No issues found!
```

Visual confirmation is the reviewer's: open a sync wizard, reach step 2, choose **Catálogo
Cartográfico**, and expand **Direcciones Geográficas del Uruguay**. The collapsed **Ejes de vías de
circulación** header above it must keep its full height, and the list must scroll rather than
compress.

## Related, not fixed here

Two defects in the same module were found while investigating the HTTP 500 that led here, and are
deliberately left in place for now:

- `fetchCatalogFile` in `ui/watcherClient.ts` throws on `!response.ok` without reading the JSON error
  body, discarding the specific message the server sent and showing only `(HTTP 500)`. Every other
  function in that file surfaces `payload.error` via `readJson`.
- `resolveResourceFilename` in `domain/sourceNaming.ts` returns a portal URL's last path segment
  verbatim when it contains a dot, without sanitising it. A segment containing characters illegal in
  a Windows filename would make `writeResource` fail for that resource alone, and a segment decoding
  to `../` would write outside the vault.

Neither was the cause of the reported 500, which did not recur on retry and is presumed transient.
