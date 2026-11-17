import { describe, expect, it } from "vitest";
import { EJES_POINT_REASON } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesSplitReviewPoint } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import { pointChoicesAfter, type EjesAcceptance } from "@/modules/routine-jobs/ui/ejes-calles/ejesAccept";
import { suggestedChoicesOf } from "@/modules/routine-jobs/ui/ejes-calles/splitReview/ejesSplitReviewView";

const ANALYSIS = "host|5432|gis|user|tables-a";

const acceptedWith = (overrides: Partial<EjesAcceptance> = {}): EjesAcceptance => ({
  analysisKey: ANALYSIS,
  splits: [],
  plainRemovals: [],
  merges: [],
  pointChoices: [],
  ...overrides,
});

describe("pointChoicesAfter: the choices of one split (EJS-6, EJS-16)", () => {
  it("should add the chosen pieces of a split for the analysis of the change", () => {
    const next = pointChoicesAfter(null, ANALYSIS, {
      oldRef: "6001",
      set: [{ pointId: "11", newRef: "6002" }],
      clear: [],
      needed: 2,
    });

    expect(next.pointChoices).toEqual([{ oldRef: "6001", pointId: "11", newRef: "6002" }]);
    expect(next.splits).toEqual([]);
  });

  it("should replace the choice of a point that is set again, keeping one choice per point", () => {
    const first = pointChoicesAfter(null, ANALYSIS, { oldRef: "6001", set: [{ pointId: "11", newRef: "6002" }], clear: [], needed: 2 });

    const second = pointChoicesAfter(first, ANALYSIS, { oldRef: "6001", set: [{ pointId: "11", newRef: "6003" }], clear: [], needed: 2 });

    expect(second.pointChoices).toEqual([{ oldRef: "6001", pointId: "11", newRef: "6003" }]);
  });

  it("should clear the choice of a point named in clear, and keep the other choices of the split", () => {
    const current = acceptedWith({
      pointChoices: [
        { oldRef: "6001", pointId: "11", newRef: "6002" },
        { oldRef: "6001", pointId: "12", newRef: "6003" },
      ],
    });

    const next = pointChoicesAfter(current, ANALYSIS, { oldRef: "6001", set: [], clear: ["11"], needed: 2 });

    expect(next.pointChoices).toEqual([{ oldRef: "6001", pointId: "12", newRef: "6003" }]);
  });

  it("should leave the choices of other splits untouched when one split changes", () => {
    const current = acceptedWith({ pointChoices: [{ oldRef: "7001", pointId: "11", newRef: "7002" }] });

    const next = pointChoicesAfter(current, ANALYSIS, { oldRef: "6001", set: [{ pointId: "11", newRef: "6002" }], clear: [], needed: 1 });

    expect(next.pointChoices).toEqual([
      { oldRef: "7001", pointId: "11", newRef: "7002" },
      { oldRef: "6001", pointId: "11", newRef: "6002" },
    ]);
  });

  it("should keep an accepted split whose choices are complete", () => {
    const current = acceptedWith({ splits: ["6001"], pointChoices: [{ oldRef: "6001", pointId: "11", newRef: "6002" }] });

    const next = pointChoicesAfter(current, ANALYSIS, { oldRef: "6001", set: [{ pointId: "12", newRef: "6003" }], clear: [], needed: 2 });

    expect(next.splits).toEqual(["6001"]);
  });

  it("should take an accepted split out of the accepted splits when a choice it needs is cleared", () => {
    const current = acceptedWith({
      splits: ["6001"],
      pointChoices: [
        { oldRef: "6001", pointId: "11", newRef: "6002" },
        { oldRef: "6001", pointId: "12", newRef: "6003" },
      ],
    });

    const next = pointChoicesAfter(current, ANALYSIS, { oldRef: "6001", set: [], clear: ["12"], needed: 2 });

    expect(next.splits).toEqual([]);
    expect(next.pointChoices).toEqual([{ oldRef: "6001", pointId: "11", newRef: "6002" }]);
  });

  it("should drop the earlier acceptance when the analysis key differs, so no choice of another analysis applies", () => {
    const older = acceptedWith({ analysisKey: "otro-analisis", pointChoices: [{ oldRef: "6001", pointId: "11", newRef: "6002" }] });

    const next = pointChoicesAfter(older, ANALYSIS, { oldRef: "6001", set: [{ pointId: "12", newRef: "6003" }], clear: [], needed: 2 });

    expect(next.analysisKey).toBe(ANALYSIS);
    expect(next.pointChoices).toEqual([{ oldRef: "6001", pointId: "12", newRef: "6003" }]);
  });
});

const point = (overrides: Partial<EjesSplitReviewPoint>): EjesSplitReviewPoint => ({
  pointId: "1",
  reason: EJES_POINT_REASON.AMBIGUOUS,
  number: null,
  letter: null,
  km: null,
  circulationWay: null,
  geometry: null,
  candidates: [
    { newRef: "6002", distance: 1.2, isSuggestion: true },
    { newRef: "6003", distance: 6.2, isSuggestion: false },
  ],
  ...overrides,
});

describe("suggestedChoicesOf: the suggestions of 'Aceptar sugeridos' (EJS-6)", () => {
  it("should suggest the nearest piece for every ambiguous point not yet decided", () => {
    const suggested = suggestedChoicesOf([point({ pointId: "1" }), point({ pointId: "2" })], new Map());

    expect(suggested).toEqual([
      { pointId: "1", newRef: "6002" },
      { pointId: "2", newRef: "6002" },
    ]);
  });

  it("should skip an ambiguous point that already has a chosen piece", () => {
    const suggested = suggestedChoicesOf([point({ pointId: "1" }), point({ pointId: "2" })], new Map([["1", "6003"]]));

    expect(suggested).toEqual([{ pointId: "2", newRef: "6002" }]);
  });

  it("should never suggest a piece for a point with no geometry, even one with candidates", () => {
    const noGeometry = point({ pointId: "9", reason: EJES_POINT_REASON.NO_GEOMETRY, candidates: [{ newRef: "6002", distance: null, isSuggestion: false }] });

    expect(suggestedChoicesOf([noGeometry], new Map())).toEqual([]);
  });

  it("should suggest nothing for an ambiguous point that has no suggested candidate", () => {
    const withoutSuggestion = point({ pointId: "3", candidates: [{ newRef: "6002", distance: 1, isSuggestion: false }] });

    expect(suggestedChoicesOf([withoutSuggestion], new Map())).toEqual([]);
  });

  it("should return an empty list for no points", () => {
    expect(suggestedChoicesOf([], new Map())).toEqual([]);
  });
});
