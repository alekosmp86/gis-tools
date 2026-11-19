import { describe, expect, it } from "vitest";
import { ACCEPTED_KEYS_LIMIT } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import {
  acceptanceAfter,
  acceptCapReachedBy,
  acceptedRequestOf,
  acceptKeysOf,
  EjesAcceptList,
  type EjesAcceptance,
} from "@/modules/routine-jobs/ui/ejes-calles/ejesAccept";

const keysOf = (count: number, prefix = "k"): string[] => Array.from({ length: count }, (_, index) => `${prefix}${index}`);

const ANALYSIS = "host|5432|gis|user|tables-a";

describe("ejes accept keys (EJ-24, EJL-22)", () => {
  describe("acceptanceAfter toggles the rows of one list", () => {
    it("should add a plain removal key on accept, for the analysis of the change", () => {
      const next = acceptanceAfter(null, ANALYSIS, { list: EjesAcceptList.PLAIN_REMOVALS, keys: ["5001"], accepted: true });

      expect(next).toEqual({ analysisKey: ANALYSIS, splits: [], plainRemovals: ["5001"], merges: [], twinRemovals: [], pointChoices: [] });
    });

    it("should add a merge key to merges, leaving plainRemovals untouched", () => {
      const next = acceptanceAfter(null, ANALYSIS, { list: EjesAcceptList.MERGES, keys: ["6103"], accepted: true });

      expect(next).toEqual({ analysisKey: ANALYSIS, splits: [], plainRemovals: [], merges: ["6103"], twinRemovals: [], pointChoices: [] });
    });

    it("should add a split key to splits, leaving the other lists untouched", () => {
      const next = acceptanceAfter(null, ANALYSIS, { list: EjesAcceptList.SPLITS, keys: ["6901"], accepted: true });

      expect(next).toEqual({ analysisKey: ANALYSIS, splits: ["6901"], plainRemovals: [], merges: [], twinRemovals: [], pointChoices: [] });
    });

    it("should take the acceptance back on a second toggle, keeping the other keys of the list", () => {
      const first = acceptanceAfter(null, ANALYSIS, { list: EjesAcceptList.PLAIN_REMOVALS, keys: ["1", "2"], accepted: true });
      const second = acceptanceAfter(first, ANALYSIS, { list: EjesAcceptList.PLAIN_REMOVALS, keys: ["1"], accepted: false });

      expect(second.plainRemovals).toEqual(["2"]);
    });

    it("should never duplicate a key that is accepted twice", () => {
      const first = acceptanceAfter(null, ANALYSIS, { list: EjesAcceptList.MERGES, keys: ["9"], accepted: true });
      const second = acceptanceAfter(first, ANALYSIS, { list: EjesAcceptList.MERGES, keys: ["9", "9"], accepted: true });

      expect(second.merges).toEqual(["9"]);
    });

    it("should accept many keys at once in their order, and reject many keys at once", () => {
      const accepted = acceptanceAfter(null, ANALYSIS, { list: EjesAcceptList.PLAIN_REMOVALS, keys: ["3", "1", "2"], accepted: true });
      const cleared = acceptanceAfter(accepted, ANALYSIS, { list: EjesAcceptList.PLAIN_REMOVALS, keys: ["3", "1"], accepted: false });

      expect(accepted.plainRemovals).toEqual(["3", "1", "2"]);
      expect(cleared.plainRemovals).toEqual(["2"]);
    });

    it("should drop the earlier acceptance when the analysis key differs, so no key of another analysis applies", () => {
      const older = acceptanceAfter(null, "otro-analisis", { list: EjesAcceptList.PLAIN_REMOVALS, keys: ["5001"], accepted: true });

      const next = acceptanceAfter(older, ANALYSIS, { list: EjesAcceptList.MERGES, keys: ["6103"], accepted: true });

      expect(next).toEqual({ analysisKey: ANALYSIS, splits: [], plainRemovals: [], merges: ["6103"], twinRemovals: [], pointChoices: [] });
    });
  });

  describe("the request limit ACCEPTED_KEYS_LIMIT (EJ-13)", () => {
    it("should be 5000 keys per list, the same limit the request parser refuses above", () => {
      expect(ACCEPTED_KEYS_LIMIT).toBe(5000);
    });

    it("should stop adding at the limit, keeping exactly the limit and reporting the cap", () => {
      const full = acceptanceAfter(null, ANALYSIS, { list: EjesAcceptList.PLAIN_REMOVALS, keys: keysOf(ACCEPTED_KEYS_LIMIT), accepted: true });
      const extra = acceptanceAfter(full, ANALYSIS, { list: EjesAcceptList.PLAIN_REMOVALS, keys: ["overflow"], accepted: true });

      expect(full.plainRemovals).toHaveLength(ACCEPTED_KEYS_LIMIT);
      expect(extra.plainRemovals).toHaveLength(ACCEPTED_KEYS_LIMIT);
      expect(extra.plainRemovals).not.toContain("overflow");
      expect(acceptCapReachedBy(full.plainRemovals, ["overflow"])).toBe(true);
    });

    it("should keep the first keys that fit when a bulk accept passes the limit", () => {
      const almost = acceptanceAfter(null, ANALYSIS, { list: EjesAcceptList.MERGES, keys: keysOf(ACCEPTED_KEYS_LIMIT - 1), accepted: true });
      const bulk = acceptanceAfter(almost, ANALYSIS, { list: EjesAcceptList.MERGES, keys: ["a", "b", "c"], accepted: true });

      expect(bulk.merges).toHaveLength(ACCEPTED_KEYS_LIMIT);
      expect(bulk.merges.slice(-1)).toEqual(["a"]);
    });

    it("should not report the cap when the keys fit exactly (boundary)", () => {
      expect(acceptCapReachedBy(keysOf(ACCEPTED_KEYS_LIMIT - 1), ["last"])).toBe(false);
      expect(acceptCapReachedBy(keysOf(ACCEPTED_KEYS_LIMIT - 1), ["last", "over"])).toBe(true);
    });

    it("should not count keys already accepted towards the cap", () => {
      const full = keysOf(ACCEPTED_KEYS_LIMIT);

      expect(acceptCapReachedBy(full, [full[0]])).toBe(false);
    });

    it("should still let a removal of keys work at the limit", () => {
      const full: EjesAcceptance = { analysisKey: ANALYSIS, splits: [], plainRemovals: keysOf(ACCEPTED_KEYS_LIMIT), merges: [], twinRemovals: [], pointChoices: [] };

      const next = acceptanceAfter(full, ANALYSIS, { list: EjesAcceptList.PLAIN_REMOVALS, keys: ["k0"], accepted: false });

      expect(next.plainRemovals).toHaveLength(ACCEPTED_KEYS_LIMIT - 1);
    });
  });

  describe("acceptKeysOf: the analysis key gates the keys", () => {
    const acceptance: EjesAcceptance = { analysisKey: ANALYSIS, splits: [], plainRemovals: ["5001"], merges: ["6103"], twinRemovals: [], pointChoices: [] };

    it("should return no keys when nothing was accepted", () => {
      expect(acceptKeysOf(null, ANALYSIS)).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: [] });
    });

    it("should return no keys when the analysis of the screen has no key", () => {
      expect(acceptKeysOf(acceptance, undefined)).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: [] });
    });

    it("should return no keys when the analysis key differs from the one they were accepted on", () => {
      expect(acceptKeysOf(acceptance, "host|5432|gis|user|tables-b")).toEqual({ splits: [], plainRemovals: [], merges: [], twinRemovals: [] });
    });

    it("should return the keys of both lists when the analysis key matches", () => {
      expect(acceptKeysOf(acceptance, ANALYSIS)).toEqual({ splits: [], plainRemovals: ["5001"], merges: ["6103"], twinRemovals: [] });
    });
  });

  describe("acceptedRequestOf: the accepted object of the real-run request", () => {
    it("should send plain removals as {ref} and merges as {newRef}, in order", () => {
      expect(acceptedRequestOf({ splits: [], plainRemovals: ["5001", "5002"], merges: ["6103"], twinRemovals: [] })).toEqual({
        splits: [],
        plainRemovals: [{ ref: "5001" }, { ref: "5002" }],
        merges: [{ newRef: "6103" }],
        twinRemovals: [],
        twinPicks: [],
      });
    });

    it("should send all lists as empty arrays when nothing is accepted, a valid empty accepted object", () => {
      expect(acceptedRequestOf({ splits: [], plainRemovals: [], merges: [], twinRemovals: [] })).toEqual({
        splits: [],
        plainRemovals: [],
        merges: [],
        twinRemovals: [],
        twinPicks: [],
      });
    });

    it("should send the twin copy picks as {ref, department, locality}, in order", () => {
      const request = acceptedRequestOf(
        { splits: [], plainRemovals: [], merges: [], twinRemovals: [] },
        [],
        [{ ref: "3002", department: "SORIANO", locality: "MERCEDES" }]
      );

      expect(request.twinPicks).toEqual([{ ref: "3002", department: "SORIANO", locality: "MERCEDES" }]);
    });

    it("should send an accepted split with the user's choices only, as {oldRef, choices}", () => {
      const request = acceptedRequestOf(
        { splits: ["6901"], plainRemovals: [], merges: [], twinRemovals: [] },
        [{ oldRef: "6901", pointId: "7", newRef: "6902" }]
      );

      expect(request.splits).toEqual([{ oldRef: "6901", choices: [{ pointId: "7", newRef: "6902" }] }]);
    });

    it("should send an accepted split with no choices as an empty choices list, and leave choices of other splits out", () => {
      const request = acceptedRequestOf(
        { splits: ["6901"], plainRemovals: [], merges: [], twinRemovals: [] },
        [{ oldRef: "6950", pointId: "3", newRef: "6951" }]
      );

      expect(request.splits).toEqual([{ oldRef: "6901", choices: [] }]);
    });

    it("should omit the choices of a split that is not accepted", () => {
      const request = acceptedRequestOf(
        { splits: [], plainRemovals: [], merges: [], twinRemovals: [] },
        [{ oldRef: "6901", pointId: "7", newRef: "6902" }]
      );

      expect(request.splits).toEqual([]);
    });
  });
});
