import { describe, expect, it } from "vitest";
import {
  Decision,
  DecisionFilter,
  DecisionReason,
  FILTER_ALL,
  Fuente,
  GroupSort,
  OTHER_FUENTE_COLUMN,
} from "@/modules/address-dedup/constants";
import {
  countByDecision,
  EMPTY_CRITERIA,
  filterGroups,
  hasActiveFilters,
  hasReviewRows,
  listFuentes,
  sortGroups,
} from "@/modules/address-dedup/domain/groupFilters";
import { groupRows } from "@/modules/address-dedup/domain/groups";
import type { AnalysisGroup, GroupFilterCriteria } from "@/modules/address-dedup/types";
import { makeRow } from "./rowFactory";

function criteria(overrides: Partial<GroupFilterCriteria>): GroupFilterCriteria {
  return { ...EMPTY_CRITERIA, ...overrides };
}

function groupIds(groups: ReadonlyArray<AnalysisGroup>): number[] {
  return groups.map((group) => group.groupId);
}

/** Group 1: ANTEL keep + TLK remove. Group 2: IDE + ANTEL kept alongside it (review). Group 3: two ANTEL keeps. */
function buildGroups(): AnalysisGroup[] {
  return groupRows([
    makeRow({ group_id: 1, urn: "cgeo:Antel:address:id:10", fuente: Fuente.ANTEL, decision: Decision.KEEP, decision_reason: DecisionReason.LOWEST_URN_KEPT, padron: "100", street_name: "Artigas", street_number: "5", locality: "Trinidad" }),
    makeRow({ group_id: 1, urn: "cgeo:TLK:wstlk:id:20", fuente: Fuente.TLK, decision: Decision.REMOVE, decision_reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN, padron: "100", street_name: "Artigas", street_number: "5", locality: "Trinidad" }),
    makeRow({ group_id: 2, urn: "cgeo:ideuy:address:id:30", fuente: Fuente.IDE, decision: Decision.KEEP, decision_reason: DecisionReason.PROTECTED_SOURCE, padron: "200", street_name: null, locality: null }),
    makeRow({ group_id: 2, urn: "cgeo:Antel:address:id:31", fuente: Fuente.ANTEL, decision: Decision.KEEP, decision_reason: DecisionReason.KEPT_ALONGSIDE_PROTECTED, padron: "200", street_name: null, locality: null }),
    makeRow({ group_id: 3, urn: "cgeo:Antel:address:id:40", fuente: Fuente.ANTEL, decision: Decision.KEEP, decision_reason: DecisionReason.INFRA_MATCHED, padron: "300", street_name: "Rivera", locality: "Ismael Cortinas" }),
    makeRow({ group_id: 3, urn: "cgeo:Antel:address:id:41", fuente: Fuente.ANTEL, decision: Decision.KEEP, decision_reason: DecisionReason.INFRA_MATCHED, padron: "300", street_name: "Rivera", locality: "Ismael Cortinas" }),
  ]);
}

describe("filterGroups", () => {
  it("should return every group when no criterion is active", () => {
    // Arrange
    const groups = buildGroups();

    // Act
    const result = filterGroups(groups, EMPTY_CRITERIA);

    // Assert
    expect(groupIds(result)).toEqual([1, 2, 3]);
  });

  it("should filter by decision", () => {
    // Arrange & Act
    const result = filterGroups(buildGroups(), criteria({ decision: DecisionFilter.REMOVE }));

    // Assert
    expect(groupIds(result)).toEqual([1]);
  });

  it("should filter by reason", () => {
    // Arrange & Act
    const result = filterGroups(buildGroups(), criteria({ reason: DecisionReason.INFRA_MATCHED }));

    // Assert
    expect(groupIds(result)).toEqual([3]);
  });

  it("should filter by fuente", () => {
    // Arrange & Act
    const result = filterGroups(buildGroups(), criteria({ fuente: Fuente.IDE }));

    // Assert
    expect(groupIds(result)).toEqual([2]);
  });

  it.each([
    ["urn", "address:id:31", [2]],
    ["padron", "300", [3]],
    ["street name", "artigas", [1]],
    ["street number", "5", [1]],
    ["locality", "ISMAEL", [3]],
  ])("should search by %s, case-insensitively", (_field, search, expected) => {
    // Arrange & Act
    const result = filterGroups(buildGroups(), criteria({ search }));

    // Assert
    expect(groupIds(result)).toEqual(expected);
  });

  it("should trim the search text", () => {
    // Arrange & Act
    const result = filterGroups(buildGroups(), criteria({ search: "   rivera  " }));

    // Assert
    expect(groupIds(result)).toEqual([3]);
  });

  it("should treat a whitespace-only search as no filter", () => {
    // Arrange
    const whitespace = criteria({ search: "    " });

    // Act
    const result = filterGroups(buildGroups(), whitespace);

    // Assert
    expect(groupIds(result)).toEqual([1, 2, 3]);
    expect(hasActiveFilters(whitespace)).toBe(false);
  });

  it("should require the same member to satisfy every member-level criterion", () => {
    // Arrange: group 1 has a REMOVE (TLK) and an ANTEL that is KEEP, never an ANTEL REMOVE.
    const criteriaAcrossMembers = criteria({ decision: DecisionFilter.REMOVE, fuente: Fuente.ANTEL });

    // Act
    const result = filterGroups(buildGroups(), criteriaAcrossMembers);

    // Assert
    expect(result).toEqual([]);
  });

  it("should match when a single member satisfies all criteria", () => {
    // Arrange & Act
    const result = filterGroups(
      buildGroups(),
      criteria({ decision: DecisionFilter.REMOVE, fuente: Fuente.TLK, search: "artigas" })
    );

    // Assert
    expect(groupIds(result)).toEqual([1]);
  });

  it("should keep every member of a matching group, not only the matching ones", () => {
    // Arrange & Act
    const [group] = filterGroups(buildGroups(), criteria({ decision: DecisionFilter.REMOVE }));

    // Assert
    expect(group.rows).toHaveLength(2);
  });

  it("should apply the review toggle at group level", () => {
    // Arrange & Act
    const result = filterGroups(buildGroups(), criteria({ reviewOnly: true }));

    // Assert
    expect(groupIds(result)).toEqual([2]);
  });

  it("should combine the review toggle with a member criterion", () => {
    // Arrange & Act
    const result = filterGroups(buildGroups(), criteria({ reviewOnly: true, fuente: Fuente.TLK }));

    // Assert
    expect(result).toEqual([]);
  });

  it("should return an empty list for empty input", () => {
    // Arrange & Act & Assert
    expect(filterGroups([], criteria({ search: "x" }))).toEqual([]);
  });
});

describe("hasActiveFilters", () => {
  it.each([
    [{ search: "a" }],
    [{ decision: DecisionFilter.KEEP }],
    [{ reason: DecisionReason.NO_DUPLICATE }],
    [{ fuente: Fuente.TLK }],
    [{ reviewOnly: true }],
  ])("should be active for %j", (override) => {
    // Arrange & Act & Assert
    expect(hasActiveFilters(criteria(override))).toBe(true);
  });

  it("should be inactive for the empty criteria", () => {
    // Arrange & Act & Assert
    expect(hasActiveFilters(EMPTY_CRITERIA)).toBe(false);
    expect(EMPTY_CRITERIA.reason).toBe(FILTER_ALL);
  });
});

describe("group derivations", () => {
  it("should count keep and remove rows of a group", () => {
    // Arrange
    const [first] = buildGroups();

    // Act & Assert
    expect(countByDecision(first)).toEqual({ keep: 1, remove: 1 });
  });

  it("should detect a group holding a KEPT_ALONGSIDE_PROTECTED row", () => {
    // Arrange
    const groups = buildGroups();

    // Act & Assert
    expect(groups.map(hasReviewRows)).toEqual([false, true, false]);
  });

  it("should detect a group whose only review row is HAS_INTERNAL_UNITS", () => {
    // Arrange
    const [group] = groupRows([
      makeRow({ group_id: 9, urn: "cgeo:Antel:address:id:90", decision: Decision.KEEP, decision_reason: DecisionReason.LOWEST_URN_KEPT }),
      makeRow({ group_id: 9, urn: "cgeo:Antel:address:id:91", decision: Decision.KEEP, decision_reason: DecisionReason.HAS_INTERNAL_UNITS, has_internal_units: true }),
    ]);

    // Act & Assert
    expect(hasReviewRows(group)).toBe(true);
    expect(filterGroups([group], criteria({ reviewOnly: true }))).toEqual([group]);
  });

  it("should toggle in a group made only of HAS_INTERNAL_UNITS members with no REMOVE row", () => {
    // Arrange
    const [group] = groupRows([
      makeRow({ group_id: 9, urn: "cgeo:Antel:address:id:90", decision: Decision.KEEP, decision_reason: DecisionReason.HAS_INTERNAL_UNITS, has_internal_units: true }),
      makeRow({ group_id: 9, urn: "cgeo:Antel:address:id:91", decision: Decision.KEEP, decision_reason: DecisionReason.HAS_INTERNAL_UNITS, has_internal_units: true }),
    ]);

    // Act
    const reviewed = filterGroups([group], criteria({ reviewOnly: true }));
    const unfiltered = filterGroups([group], criteria({ reviewOnly: false }));

    // Assert
    expect(group.rows.some((row) => row.decision === Decision.REMOVE)).toBe(false);
    expect(hasReviewRows(group)).toBe(true);
    expect(reviewed).toEqual([group]);
    expect(unfiltered).toEqual([group]);
  });
});

describe("sortGroups", () => {
  function sortFixture(): AnalysisGroup[] {
    return groupRows([
      makeRow({ group_id: 1, urn: "a", decision: Decision.REMOVE }),
      makeRow({ group_id: 2, urn: "b", decision: Decision.KEEP }),
      makeRow({ group_id: 2, urn: "c", decision: Decision.REMOVE }),
      makeRow({ group_id: 2, urn: "d", decision: Decision.REMOVE }),
      makeRow({ group_id: 3, urn: "e", decision: Decision.KEEP }),
      makeRow({ group_id: 3, urn: "f", decision: Decision.KEEP }),
      makeRow({ group_id: 4, urn: "g", decision: Decision.REMOVE }),
      makeRow({ group_id: 4, urn: "h", decision: Decision.REMOVE }),
    ]);
  }

  it("should sort by group id ascending", () => {
    // Arrange
    const shuffled = [...sortFixture()].reverse();

    // Act
    const result = sortGroups(shuffled, GroupSort.GROUP_ASC);

    // Assert
    expect(groupIds(result)).toEqual([1, 2, 3, 4]);
  });

  it("should sort by size descending, breaking ties by group id ascending", () => {
    // Arrange & Act
    const result = sortGroups([...sortFixture()].reverse(), GroupSort.SIZE_DESC);

    // Assert: sizes are 1, 3, 2, 2.
    expect(groupIds(result)).toEqual([2, 3, 4, 1]);
  });

  it("should sort by removals descending, breaking ties by group id ascending", () => {
    // Arrange & Act
    const result = sortGroups([...sortFixture()].reverse(), GroupSort.REMOVALS_DESC);

    // Assert: removals are 1, 2, 0, 2.
    expect(groupIds(result)).toEqual([2, 4, 1, 3]);
  });

  it("should not mutate its input", () => {
    // Arrange
    const groups = [...sortFixture()].reverse();
    const before = groupIds(groups);

    // Act
    sortGroups(groups, GroupSort.GROUP_ASC);

    // Assert
    expect(groupIds(groups)).toEqual(before);
  });

  it("should return an empty list for empty input", () => {
    // Arrange & Act & Assert
    expect(sortGroups([], GroupSort.SIZE_DESC)).toEqual([]);
  });
});

describe("listFuentes", () => {
  it("should list the known fuentes present sorted, then one other option when an unknown or empty fuente exists", () => {
    // Arrange
    const groups = groupRows([
      makeRow({ group_id: 1, fuente: Fuente.TLK }),
      makeRow({ group_id: 1, fuente: "" }),
      makeRow({ group_id: 2, fuente: Fuente.ANTEL }),
      makeRow({ group_id: 2, fuente: "XYZ" }),
      makeRow({ group_id: 2, fuente: Fuente.IDE }),
    ]);

    // Act
    const fuentes = listFuentes(groups);

    // Assert: XYZ and the empty fuente fold into the single other option.
    expect(fuentes).toEqual([Fuente.ANTEL, Fuente.IDE, Fuente.TLK, OTHER_FUENTE_COLUMN]);
  });

  it("should offer no other option when every fuente is known", () => {
    // Arrange
    const groups = groupRows([makeRow({ fuente: Fuente.ANTEL }), makeRow({ fuente: Fuente.TLK })]);

    // Act & Assert
    expect(listFuentes(groups)).toEqual([Fuente.ANTEL, Fuente.TLK]);
  });

  it("should return an empty list for no groups", () => {
    // Arrange & Act & Assert
    expect(listFuentes([])).toEqual([]);
  });

  it("should make the other option match every fuente outside ANTEL/TLK/IDE, as the summary column does", () => {
    // Arrange
    const groups = groupRows([
      makeRow({ group_id: 1, fuente: "" }),
      makeRow({ group_id: 2, fuente: "XYZ" }),
      makeRow({ group_id: 3, fuente: Fuente.ANTEL }),
    ]);

    // Act
    const result = filterGroups(groups, criteria({ fuente: OTHER_FUENTE_COLUMN }));

    // Assert
    expect(groupIds(result)).toEqual([1, 2]);
  });
});
