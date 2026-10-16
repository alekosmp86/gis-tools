import { describe, it, expect } from "vitest";
import {
  countSelectedPatches,
  isSelectableEnabledItem,
  isSelectableItem,
  isSelectionBlockedItem,
  selectActionableItems,
} from "@/core/workers/comparison/DiscrepancySelection";
import {
  DiscrepancyType,
  PairingMethod,
  type DiscrepancyItem,
} from "@/core/types/comparison";

const PK = "gid";

function item(overrides: Partial<DiscrepancyItem> = {}): DiscrepancyItem {
  return {
    id: "i-1",
    suid: "S-1",
    type: DiscrepancyType.ATTRIBUTE_MISMATCH,
    differences: [],
    ...overrides,
  };
}

const keyedPaired = (id: string, type: DiscrepancyType = DiscrepancyType.ATTRIBUTE_MISMATCH) =>
  item({
    id,
    type,
    dbRecord: { [PK]: 7 },
    pairing: { method: PairingMethod.EXACT, dbCount: 1, fileCount: 1 },
  });

const unkeyedPaired = (id: string) =>
  item({
    id,
    dbRecord: { [PK]: null },
    pairing: { method: PairingMethod.GEOMETRY, dbCount: 1, fileCount: 1 },
  });

describe("isSelectableItem", () => {
  it.each([
    DiscrepancyType.ATTRIBUTE_MISMATCH,
    DiscrepancyType.GEOMETRY_MISMATCH,
    DiscrepancyType.ONLY_IN_SHP,
  ])("should be true for %s", (type) => {
    expect(isSelectableItem(item({ type }))).toBe(true);
  });

  it.each([
    DiscrepancyType.ONLY_IN_DB,
    DiscrepancyType.DUPLICATE_SUID,
    DiscrepancyType.NULL_SUID,
    DiscrepancyType.MATCH,
  ])("should be false for %s", (type) => {
    expect(isSelectableItem(item({ type }))).toBe(false);
  });
});

describe("isSelectionBlockedItem", () => {
  it("should block a selectable paired item without primary key value", () => {
    expect(isSelectionBlockedItem(unkeyedPaired("a"), PK)).toBe(true);
  });

  it("should block a paired item when no primary key column is configured", () => {
    expect(isSelectionBlockedItem(keyedPaired("a"), undefined)).toBe(true);
    expect(isSelectionBlockedItem(keyedPaired("a"), null)).toBe(true);
  });

  it("should not block a keyed paired item", () => {
    expect(isSelectionBlockedItem(keyedPaired("a"), PK)).toBe(false);
  });

  it("should not block an item without pairing", () => {
    expect(isSelectionBlockedItem(item({ type: DiscrepancyType.ONLY_IN_SHP }), PK)).toBe(false);
  });

  it("should not report non-selectable types as blocked even when unkeyed paired", () => {
    const nonSelectable = item({
      type: DiscrepancyType.DUPLICATE_SUID,
      pairing: { method: PairingMethod.EXACT, dbCount: 2, fileCount: 1 },
    });
    expect(isSelectionBlockedItem(nonSelectable, PK)).toBe(false);
  });
});

describe("isSelectableEnabledItem", () => {
  it("should be true for a keyed selectable item", () => {
    expect(isSelectableEnabledItem(keyedPaired("a"), PK)).toBe(true);
  });

  it("should be true for an unpaired ONLY_IN_SHP item", () => {
    expect(isSelectableEnabledItem(item({ type: DiscrepancyType.ONLY_IN_SHP }), PK)).toBe(true);
  });

  it("should be false for an unkeyed paired item", () => {
    expect(isSelectableEnabledItem(unkeyedPaired("a"), PK)).toBe(false);
  });

  it("should be false for a non-selectable type", () => {
    expect(isSelectableEnabledItem(item({ type: DiscrepancyType.ONLY_IN_DB }), PK)).toBe(false);
  });
});

describe("selectActionableItems", () => {
  const items = [
    keyedPaired("k1"),
    keyedPaired("k2", DiscrepancyType.GEOMETRY_MISMATCH),
    unkeyedPaired("u1"),
    item({ id: "s1", type: DiscrepancyType.ONLY_IN_SHP }),
    item({ id: "d1", type: DiscrepancyType.ONLY_IN_DB }),
  ];

  it("should return an empty array for an empty selection", () => {
    expect(selectActionableItems(items, new Set(), PK)).toEqual([]);
  });

  it("should return an empty array for no items", () => {
    expect(selectActionableItems([], new Set(["k1"]), PK)).toEqual([]);
  });

  it("should return only selected items, preserving item order", () => {
    const result = selectActionableItems(items, new Set(["s1", "k1"]), PK);
    expect(result.map((i) => i.id)).toEqual(["k1", "s1"]);
  });

  it("should exclude selected unkeyed paired items", () => {
    const result = selectActionableItems(items, new Set(["k1", "u1"]), PK);
    expect(result.map((i) => i.id)).toEqual(["k1"]);
  });

  it("should exclude selected non-selectable types", () => {
    expect(selectActionableItems(items, new Set(["d1"]), PK)).toEqual([]);
  });

  it("should ignore selected ids that match no item", () => {
    expect(selectActionableItems(items, new Set(["ghost"]), PK)).toEqual([]);
  });

  it("should exclude non-selected items when everything actionable is selected except one", () => {
    const result = selectActionableItems(items, new Set(["k1", "k2", "s1"]), PK);
    expect(result.map((i) => i.id)).toEqual(["k1", "k2", "s1"]);
    expect(result.some((i) => i.id === "u1")).toBe(false);
  });
});

describe("countSelectedPatches", () => {
  it("should return zero counts for no items", () => {
    expect(countSelectedPatches([])).toEqual({ updates: 0, inserts: 0 });
  });

  it("should count ONLY_IN_SHP as inserts and mismatches as updates", () => {
    const counts = countSelectedPatches([
      keyedPaired("a"),
      keyedPaired("b", DiscrepancyType.GEOMETRY_MISMATCH),
      item({ id: "c", type: DiscrepancyType.ONLY_IN_SHP }),
    ]);
    expect(counts).toEqual({ updates: 2, inserts: 1 });
  });

  it("should handle a single insert", () => {
    expect(countSelectedPatches([item({ type: DiscrepancyType.ONLY_IN_SHP })])).toEqual({
      updates: 0,
      inserts: 1,
    });
  });
});
