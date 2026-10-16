# ISSUE 034: Discrepancy Row Selection

## 1. Problem Statement
The SQL generator, previews, counters, copy, download and execute always covered every actionable discrepancy; users could not apply only a subset of records.

## 2. Root Cause Analysis & Technical Details
No selection state existed. `ComparisonResultsView` fed all `ATTRIBUTE_MISMATCH` / `GEOMETRY_MISMATCH` / `ONLY_IN_SHP` items to the worker and showed engine-precomputed previews and counts.

## 3. Implemented Solution
- Selection keyed by `DiscrepancyItem.id` (inclusion `Set`), owned by `ComparisonResultsView` through `useDiscrepancySelection`; pure helpers in `src/core/selection/selectionReducer.ts`; default via `DEFAULT_SELECT_ALL = true` (all selectable, enabled records selected on a new comparison; "Limpiar selección" empties it; re-analysis of the same comparison only prunes).
- `core/workers/comparison/DiscrepancySelection.ts`: `isSelectableItem`, `selectActionableItems`, `countSelectedPatches`. Unkeyed paired updates are disabled; `isUnkeyedPairedItem` lives in `src/core/selection/unkeyedPairing.ts` (shared by `DiscrepancySelection` and `SqlPatchGenerator`).
- Table: per-record checkbox cell (rowSpan), tri-state page header checkbox, `DiscrepanciesSelectionBar` (counter plus page/filter/clear actions).
- `SelectionSqlPatchDrawer` / `useSelectionSqlPatches`: counters from the selection, previews from the first 25 selected updates and 25 inserts through the existing worker call (preview tagged with both `selectedIds` and `summary` identity, shown only while both match), full script generated lazily from selected items only. No worker contract or engine change.
- `SqlPatchDrawer` / `useSqlPatchDrawerState`: `selectionVersion` resets the lazy script cache (stale generations discarded with an INFO alert "La selección cambió durante la generación del script. Vuelva a intentarlo."; executed-state flags reset on selection change), empty-selection message, Copy/Download/Execute disabled at 0, statement-count sanity warning.
- Selection resets on new comparison identity and is pruned to surviving selectable ids after re-analysis.

## 4. Code Examples & Diff Snippets
```ts
const actionableItems = selectActionableItems(summary.items, selectedIds, primaryKeyColumn);
const { updates, inserts } = countSelectedPatches(actionableItems);
```

## 5. Verification
Gauntlet: `modules:routes:check`, `lint`, `tsc`, `build`, `doctor`, `fallow`, and unit suites for components, workers and hooks.
