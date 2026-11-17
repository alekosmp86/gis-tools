import { describe, expect, it } from "vitest";
import { EJES_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesSplitRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import {
  ATTENTION_FILTER,
  ATTENTION_RANK,
  attentionCountsOf,
  sortSplitsByAttention,
  splitMatchesAttention,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesCallesReportView";

const splitOf = (overrides: Partial<EjesSplitRow> = {}): EjesSplitRow => ({
  oldRef: "6001",
  idcalle: "71939",
  newRefs: ["6002", "6003"],
  points: 0,
  refPoints: 0,
  autoPoints: 0,
  reviewPoints: 0,
  noGeometryPoints: 0,
  farPoints: 0,
  heldReason: null,
  incompleteReview: false,
  coverage: null,
  oldLength: null,
  newLength: null,
  outsideLength: null,
  ...overrides,
});

const DECISION = splitOf({ oldRef: "6100", points: 2, refPoints: 2, reviewPoints: 1 });
const DECISION_NO_GEOMETRY = splitOf({ oldRef: "6200", points: 1, refPoints: 1, noGeometryPoints: 1 });
const READY = splitOf({ oldRef: "6300", points: 3, refPoints: 3, autoPoints: 3 });
const READY_NO_POINTS = splitOf({ oldRef: "6400" });
const HELD_REASON = splitOf({ oldRef: "6500", heldReason: EJES_SKIP_REASON.NOT_ACCEPTED, points: 4, refPoints: 4, reviewPoints: 4 });
const HELD_INCOMPLETE = splitOf({ oldRef: "6600", incompleteReview: true });
const HELD_NO_OLD_REF = splitOf({ oldRef: "", points: 1, refPoints: 1 });
const HELD_POINT_MISMATCH = splitOf({ oldRef: "6700", points: 3, refPoints: 2, reviewPoints: 2 });

describe("attentionCountsOf: the splits per attention rank (EJS-19)", () => {
  it("should count each split under the rank the analysis gives it", () => {
    const counts = attentionCountsOf([DECISION, DECISION_NO_GEOMETRY, READY, HELD_REASON]);

    expect(counts).toEqual({ [ATTENTION_RANK.DECISION]: 2, [ATTENTION_RANK.READY]: 1, [ATTENTION_RANK.HELD]: 1 });
  });

  it("should count zero in every rank for no splits (empty)", () => {
    expect(attentionCountsOf([])).toEqual({ [ATTENTION_RANK.DECISION]: 0, [ATTENTION_RANK.READY]: 0, [ATTENTION_RANK.HELD]: 0 });
  });

  it.each([
    ["a held reason", HELD_REASON],
    ["an incomplete review", HELD_INCOMPLETE],
    ["an empty old reftramo", HELD_NO_OLD_REF],
    ["points that differ from the reftramo points", HELD_POINT_MISMATCH],
  ])("should rank a split with %s as held, even with review points", (_label, row) => {
    expect(attentionCountsOf([row])[ATTENTION_RANK.HELD]).toBe(1);
  });

  it("should rank a split with no review and no no-geometry point as ready, not decision (boundary)", () => {
    expect(attentionCountsOf([READY_NO_POINTS])[ATTENTION_RANK.READY]).toBe(1);
  });
});

describe("splitMatchesAttention: the filter of the splits list (EJS-19)", () => {
  it("should match every split for the all filter, held ones included", () => {
    expect([DECISION, READY, HELD_REASON].every((row) => splitMatchesAttention(row, ATTENTION_FILTER.ALL))).toBe(true);
  });

  it("should match only the decision splits for the decision filter", () => {
    expect(splitMatchesAttention(DECISION_NO_GEOMETRY, ATTENTION_FILTER.DECISION)).toBe(true);
    expect(splitMatchesAttention(READY, ATTENTION_FILTER.DECISION)).toBe(false);
    expect(splitMatchesAttention(HELD_REASON, ATTENTION_FILTER.DECISION)).toBe(false);
  });

  it("should match only the ready splits for the ready filter", () => {
    expect(splitMatchesAttention(READY_NO_POINTS, ATTENTION_FILTER.READY)).toBe(true);
    expect(splitMatchesAttention(DECISION, ATTENTION_FILTER.READY)).toBe(false);
  });

  it("should match only the held splits for the held filter", () => {
    expect(splitMatchesAttention(HELD_NO_OLD_REF, ATTENTION_FILTER.HELD)).toBe(true);
    expect(splitMatchesAttention(READY, ATTENTION_FILTER.HELD)).toBe(false);
  });
});

describe("sortSplitsByAttention: the order of the splits list (EJS-19)", () => {
  it("should order the splits by rank: decision first, then ready, then held", () => {
    const sorted = sortSplitsByAttention([HELD_REASON, READY, DECISION]);

    expect(sorted.map((row) => row.oldRef)).toEqual(["6100", "6300", "6500"]);
  });

  it("should order the splits of one rank by points, most first", () => {
    const fewer = splitOf({ oldRef: "6010", points: 1, refPoints: 1, reviewPoints: 1 });
    const more = splitOf({ oldRef: "6020", points: 5, refPoints: 5, reviewPoints: 1 });

    expect(sortSplitsByAttention([fewer, more]).map((row) => row.oldRef)).toEqual(["6020", "6010"]);
  });

  it("should order the splits with equal rank and points by reftramo, ascending (tie)", () => {
    const later = splitOf({ oldRef: "6900", points: 2, refPoints: 2, reviewPoints: 2 });
    const earlier = splitOf({ oldRef: "6800", points: 2, refPoints: 2, reviewPoints: 2 });

    expect(sortSplitsByAttention([later, earlier]).map((row) => row.oldRef)).toEqual(["6800", "6900"]);
  });

  it("should return an empty list for no splits (empty)", () => {
    expect(sortSplitsByAttention([])).toEqual([]);
  });

  it("should return a new array and leave the analysis order of the input untouched (immutability)", () => {
    const input = [HELD_REASON, DECISION, READY];
    const snapshot = [...input];

    const sorted = sortSplitsByAttention(input);

    expect(sorted).not.toBe(input);
    expect(input).toEqual(snapshot);
    expect(sorted.map((row) => row.oldRef)).toEqual(["6100", "6300", "6500"]);
  });
});
