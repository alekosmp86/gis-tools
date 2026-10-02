import { describe, expect, it } from "vitest";
import { groupRows } from "@/modules/address-dedup/domain/groups";
import { makeRow } from "./rowFactory";

describe("groupRows", () => {
  it("should group rows by group_id preserving the incoming order of groups and members", () => {
    // Arrange
    const rows = [
      makeRow({ group_id: 1, urn: "a" }),
      makeRow({ group_id: 1, urn: "b" }),
      makeRow({ group_id: 2, urn: "c" }),
      makeRow({ group_id: 3, urn: "d" }),
      makeRow({ group_id: 3, urn: "e" }),
    ];

    // Act
    const groups = groupRows(rows);

    // Assert
    expect(groups.map((group) => group.groupId)).toEqual([1, 2, 3]);
    expect(groups.map((group) => group.rows.map((row) => row.urn))).toEqual([["a", "b"], ["c"], ["d", "e"]]);
  });

  it("should keep the order of first appearance when group ids are not ascending", () => {
    // Arrange
    const rows = [makeRow({ group_id: 5, urn: "a" }), makeRow({ group_id: 2, urn: "b" }), makeRow({ group_id: 5, urn: "c" })];

    // Act
    const groups = groupRows(rows);

    // Assert
    expect(groups.map((group) => group.groupId)).toEqual([5, 2]);
    expect(groups[0].rows.map((row) => row.urn)).toEqual(["a", "c"]);
  });

  it("should return an empty list for empty input", () => {
    // Arrange & Act & Assert
    expect(groupRows([])).toEqual([]);
  });
});
