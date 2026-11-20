import { describe, expect, it, vi } from "vitest";
import { ACCEPTED_KEYS_LIMIT, EJES_SKIP_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesSplitRow } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { EjesAcceptList, isSplitAcceptable, toggleSplitAcceptance, type EjesAcceptView } from "@/modules/routine-jobs/ui/ejes-calles/ejesAccept";
import { EJES_SPLIT_REVIEW_TEXT } from "@/modules/routine-jobs/ui/ejes-calles/splitReview/ejesSplitReviewTexts";

const SPLIT: EjesSplitRow = {
  oldRef: "6001",
  idcalle: "30",
  newRefs: ["6002", "6003"],
  points: 2,
  refPoints: 2,
  autoPoints: 1,
  reviewPoints: 1,
  noGeometryPoints: 0,
  farPoints: 0,
  heldReason: null,
  incompleteReview: false,
  manual: false,
  coverage: 1,
  oldLength: 100,
  newLength: 100,
  outsideLength: 0,
};

const keysOf = (count: number): string[] => Array.from({ length: count }, (_, index) => `k${index}`);

const viewWith = (splits: string[], onChange = vi.fn()): EjesAcceptView => ({
  keys: { splits, plainRemovals: [], merges: [], twinRemovals: [] },
  pointChoices: [],
  onChange,
  onPointChoicesChange: () => undefined,
  twinPicks: [],
  onTwinPickChange: () => undefined,
  manualSplits: [],
  onManualSplitChange: () => undefined,
  canAnalyzeWithPicks: false,
  onAnalyzeWithPicks: () => undefined,
});

describe("isSplitAcceptable: a split is accepted only when every point is decided (EJS-6, EJS-8)", () => {
  it("should accept a split whose review point has its choice", () => {
    expect(isSplitAcceptable(SPLIT, 1)).toBe(true);
  });

  it("should refuse a split whose review point has no choice yet", () => {
    expect(isSplitAcceptable(SPLIT, 0)).toBe(false);
  });

  it("should refuse a split the load holds whatever the user chooses (heldReason set)", () => {
    expect(isSplitAcceptable({ ...SPLIT, heldReason: EJES_SKIP_REASON.ID_LINKED_POINTS }, 1)).toBe(false);
  });

  it("should refuse a split whose review points did not fit the stored rows (incompleteReview)", () => {
    expect(isSplitAcceptable({ ...SPLIT, incompleteReview: true }, 1)).toBe(false);
  });

  it("should refuse a split with no reftramo, which has no accept key", () => {
    expect(isSplitAcceptable({ ...SPLIT, oldRef: "" }, 1)).toBe(false);
  });

  it("should refuse a split with a point linked by road_section.id (points differ from the reftramo points)", () => {
    expect(isSplitAcceptable({ ...SPLIT, points: 3 }, 1)).toBe(false);
  });
});

describe("toggleSplitAcceptance: the request limit stops an accept, never a reject (EJS-1, EJ-13)", () => {
  it("should accept the split and report no note when the list has room", () => {
    const onChange = vi.fn();

    const note = toggleSplitAcceptance(viewWith([], onChange), "6001", false);

    expect(note).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ list: EjesAcceptList.SPLITS, keys: ["6001"], accepted: true });
  });

  it("should reject an accepted split and report no note", () => {
    const onChange = vi.fn();

    const note = toggleSplitAcceptance(viewWith(["6001"], onChange), "6001", true);

    expect(note).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ list: EjesAcceptList.SPLITS, keys: ["6001"], accepted: false });
  });

  it("should refuse a new accept at the limit with the cap note and change nothing", () => {
    const onChange = vi.fn();

    const note = toggleSplitAcceptance(viewWith(keysOf(ACCEPTED_KEYS_LIMIT), onChange), "6001", false);

    expect(note).toBe(EJES_SPLIT_REVIEW_TEXT.SPLIT_CAP_NOTE);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("should still reject a split at the limit, since a reject frees a place", () => {
    const onChange = vi.fn();
    const full = keysOf(ACCEPTED_KEYS_LIMIT);

    const note = toggleSplitAcceptance(viewWith(full, onChange), full[0], true);

    expect(note).toBeNull();
    expect(onChange).toHaveBeenCalledWith({ list: EjesAcceptList.SPLITS, keys: [full[0]], accepted: false });
  });
});
