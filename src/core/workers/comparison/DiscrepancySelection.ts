import type { DiscrepancyItem } from "@/core/types/comparison";
import { DiscrepancyType } from "@/core/types/comparison";
import type { SelectedPatchCounts, SelectionIdSet } from "@/core/types/selection";
import { isUnkeyedPairedItem } from "@/core/selection/unkeyedPairing";

export function isSelectableItem(item: DiscrepancyItem): boolean {
  return (
    item.type === DiscrepancyType.ATTRIBUTE_MISMATCH ||
    item.type === DiscrepancyType.GEOMETRY_MISMATCH ||
    item.type === DiscrepancyType.ONLY_IN_SHP
  );
}

export function isSelectionBlockedItem(
  item: DiscrepancyItem,
  primaryKeyColumn?: string | null
): boolean {
  return isSelectableItem(item) && isUnkeyedPairedItem(item, primaryKeyColumn);
}

export function isSelectableEnabledItem(
  item: DiscrepancyItem,
  primaryKeyColumn?: string | null
): boolean {
  return isSelectableItem(item) && !isUnkeyedPairedItem(item, primaryKeyColumn);
}

export function selectActionableItems(
  items: readonly DiscrepancyItem[],
  selectedIds: SelectionIdSet,
  primaryKeyColumn?: string | null
): DiscrepancyItem[] {
  if (selectedIds.size === 0) return [];
  return items.filter(
    (item) => selectedIds.has(item.id) && isSelectableEnabledItem(item, primaryKeyColumn)
  );
}

export function countSelectedPatches(actionableItems: readonly DiscrepancyItem[]): SelectedPatchCounts {
  let updates = 0;
  let inserts = 0;
  for (const item of actionableItems) {
    if (item.type === DiscrepancyType.ONLY_IN_SHP) inserts++;
    else updates++;
  }
  return { updates, inserts };
}
