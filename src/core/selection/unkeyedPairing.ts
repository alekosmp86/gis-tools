import type { DiscrepancyItem } from "@/core/types/comparison";

/**
 * A row paired inside a non-unique key group has no safe WHERE clause without a primary key:
 * the composite SUID would match every row of the group.
 */
export function isUnkeyedPairedItem(
  item: DiscrepancyItem,
  primaryKeyColumn?: string | null
): boolean {
  if (!item.pairing) return false;
  return !(primaryKeyColumn && item.dbRecord && item.dbRecord[primaryKeyColumn] != null);
}
