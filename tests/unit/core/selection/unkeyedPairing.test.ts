import { describe, it, expect } from "vitest";
import { isUnkeyedPairedItem } from "@/core/selection/unkeyedPairing";
import { isUnkeyedPairedItem as reExported } from "@/core/workers/comparison/SqlPatchGenerator";
import { DiscrepancyType, PairingMethod, type DiscrepancyItem } from "@/core/types/comparison";

function paired(dbRecord?: Record<string, unknown>): DiscrepancyItem {
  return {
    id: "1",
    suid: "S",
    type: DiscrepancyType.ATTRIBUTE_MISMATCH,
    differences: [],
    dbRecord: dbRecord as DiscrepancyItem["dbRecord"],
    pairing: { method: PairingMethod.GEOMETRY, dbCount: 1, fileCount: 1 },
  };
}

describe("isUnkeyedPairedItem", () => {
  it("should return false when the item has no pairing", () => {
    const item = { ...paired({ gid: null }), pairing: undefined };
    expect(isUnkeyedPairedItem(item, "gid")).toBe(false);
  });

  it("should return true for a paired item when no primary key column is configured", () => {
    expect(isUnkeyedPairedItem(paired({ gid: 5 }), undefined)).toBe(true);
    expect(isUnkeyedPairedItem(paired({ gid: 5 }), null)).toBe(true);
    expect(isUnkeyedPairedItem(paired({ gid: 5 }), "")).toBe(true);
  });

  it("should return true when the primary key value is null, missing, or dbRecord is absent", () => {
    expect(isUnkeyedPairedItem(paired({ gid: null }), "gid")).toBe(true);
    expect(isUnkeyedPairedItem(paired({ other: 1 }), "gid")).toBe(true);
    expect(isUnkeyedPairedItem(paired(undefined), "gid")).toBe(true);
  });

  it("should return false when the primary key value is present, including 0", () => {
    expect(isUnkeyedPairedItem(paired({ gid: 7 }), "gid")).toBe(false);
    expect(isUnkeyedPairedItem(paired({ gid: 0 }), "gid")).toBe(false);
  });

  it("should be the same function re-exported by SqlPatchGenerator", () => {
    expect(reExported).toBe(isUnkeyedPairedItem);
  });
});
