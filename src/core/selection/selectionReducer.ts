import type { SelectionIdSet } from "@/core/types/selection";
import { SelectionCheckState } from "@/core/types/selection";

export const EMPTY_SELECTION: SelectionIdSet = new Set<string>();

export function toggleSelection(current: SelectionIdSet, id: string): SelectionIdSet {
  const next = new Set(current);
  if (!next.delete(id)) next.add(id);
  return next;
}

export function selectMany(current: SelectionIdSet, ids: readonly string[]): SelectionIdSet {
  if (ids.every((id) => current.has(id))) return current;
  const next = new Set(current);
  ids.forEach((id) => next.add(id));
  return next;
}

export function deselectMany(current: SelectionIdSet, ids: readonly string[]): SelectionIdSet {
  if (!ids.some((id) => current.has(id))) return current;
  const next = new Set(current);
  ids.forEach((id) => next.delete(id));
  return next;
}

export function clearSelection(current: SelectionIdSet): SelectionIdSet {
  return current.size === 0 ? current : EMPTY_SELECTION;
}

export function pruneTo(current: SelectionIdSet, allowedIds: SelectionIdSet): SelectionIdSet {
  const kept: string[] = [];
  current.forEach((id) => {
    if (allowedIds.has(id)) kept.push(id);
  });
  return kept.length === current.size ? current : new Set(kept);
}

export function countSelectedIn(selected: SelectionIdSet, ids: readonly string[]): number {
  let count = 0;
  for (const id of ids) {
    if (selected.has(id)) count++;
  }
  return count;
}

export function resolveCheckState(selectedCount: number, totalCount: number): SelectionCheckState {
  if (selectedCount === 0 || totalCount === 0) return SelectionCheckState.NONE;
  return selectedCount >= totalCount ? SelectionCheckState.ALL : SelectionCheckState.SOME;
}
