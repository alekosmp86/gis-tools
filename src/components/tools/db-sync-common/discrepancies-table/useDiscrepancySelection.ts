import { useState } from "react";
import type { DiscrepancyItem } from "@/core/types/comparison";
import type { SelectionIdSet } from "@/core/types/selection";
import { DEFAULT_SELECT_ALL } from "@/core/selection/selectionDefaults";
import {
  EMPTY_SELECTION,
  clearSelection,
  deselectMany,
  pruneTo,
  selectMany,
  toggleSelection,
} from "@/core/selection/selectionReducer";
import { isSelectableEnabledItem } from "@/core/workers/comparison/DiscrepancySelection";

export interface UseDiscrepancySelectionParams {
  items: DiscrepancyItem[] | undefined;
  comparisonKey: string;
  primaryKeyColumn?: string | null;
}

export interface DiscrepancySelectionController {
  selectedIds: SelectionIdSet;
  selectableCount: number;
  selectionVersion: number;
  toggle: (id: string) => void;
  select: (ids: readonly string[]) => void;
  deselect: (ids: readonly string[]) => void;
  clear: () => void;
}

interface SelectionState {
  comparisonKey: string | null;
  itemsSource: DiscrepancyItem[] | undefined;
  selectedIds: SelectionIdSet;
  version: number;
}

function collectSelectableIds(
  items: DiscrepancyItem[],
  primaryKeyColumn?: string | null
): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (isSelectableEnabledItem(item, primaryKeyColumn)) ids.add(item.id);
  }
  return ids;
}

function resolveNextSelection(
  state: SelectionState,
  selectableIds: SelectionIdSet,
  isNewComparison: boolean
): SelectionIdSet {
  if (isNewComparison) {
    return DEFAULT_SELECT_ALL ? selectableIds : EMPTY_SELECTION;
  }
  return pruneTo(state.selectedIds, selectableIds);
}

export function useDiscrepancySelection({
  items,
  comparisonKey,
  primaryKeyColumn,
}: UseDiscrepancySelectionParams): DiscrepancySelectionController {
  const [state, setState] = useState<SelectionState>({
    comparisonKey: null,
    itemsSource: undefined,
    selectedIds: EMPTY_SELECTION,
    version: 0,
  });

  const selectableIds = items ? collectSelectableIds(items, primaryKeyColumn) : EMPTY_SELECTION;

  if (items && state.itemsSource !== items) {
    const isNewComparison = state.comparisonKey !== comparisonKey;
    const nextSelected = resolveNextSelection(state, selectableIds, isNewComparison);
    setState({
      comparisonKey,
      itemsSource: items,
      selectedIds: nextSelected,
      version: state.version + 1,
    });
  }

  const update = (compute: (current: SelectionIdSet) => SelectionIdSet) => {
    setState((previous) => {
      const next = compute(previous.selectedIds);
      if (next === previous.selectedIds) return previous;
      return { ...previous, selectedIds: next, version: previous.version + 1 };
    });
  };

  const restrictToSelectable = (ids: readonly string[]) =>
    ids.filter((id) => selectableIds.has(id));

  return {
    selectedIds: state.selectedIds,
    selectableCount: selectableIds.size,
    selectionVersion: state.version,
    toggle: (id) => update((current) => toggleSelection(current, id)),
    select: (ids) => update((current) => selectMany(current, restrictToSelectable(ids))),
    deselect: (ids) => update((current) => deselectMany(current, ids)),
    clear: () => update(clearSelection),
  };
}
