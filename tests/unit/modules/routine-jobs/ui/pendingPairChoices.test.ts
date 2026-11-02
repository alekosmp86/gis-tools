import { describe, expect, it } from "vitest";
import type { PairChoice } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { PAIR_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import {
  acceptableChoicesOf,
  choiceIndexOf,
  choicesWithinLimit,
  pendingChoiceStateIn,
  pendingChoiceStateOf,
  PendingChoiceState,
} from "@/modules/routine-jobs/ui/pendingPairChoices";

const choiceOf = (overrides: Partial<PairChoice> = {}): PairChoice => ({
  typePadron: "URBANO",
  provinceId: 2,
  localityId: 10,
  number: "100",
  oldId: 7,
  ...overrides,
});

const KEY_ONE_OLD_SEVEN = choiceOf({ number: "100", oldId: 7 });
const KEY_TWO_OLD_EIGHT = choiceOf({ number: "200", oldId: 8 });
const KEY_THREE_OLD_SEVEN = choiceOf({ number: "300", oldId: 7 });

describe("pendingPairChoices", () => {
  describe("pendingChoiceStateOf", () => {
    it("should return NONE when the pending pair has no choice", () => {
      expect(pendingChoiceStateOf(null, [KEY_ONE_OLD_SEVEN])).toBe(PendingChoiceState.NONE);
    });

    it("should return ACCEPTED when the current choices already name the same new key with the same old id", () => {
      expect(pendingChoiceStateOf(KEY_ONE_OLD_SEVEN, [KEY_TWO_OLD_EIGHT, KEY_ONE_OLD_SEVEN])).toBe(PendingChoiceState.ACCEPTED);
    });

    it("should return OPEN when no current choice names the new key or the old id", () => {
      expect(pendingChoiceStateOf(KEY_ONE_OLD_SEVEN, [KEY_TWO_OLD_EIGHT])).toBe(PendingChoiceState.OPEN);
    });

    it("should return OPEN when no choice exists yet and the list is empty", () => {
      expect(pendingChoiceStateOf(KEY_ONE_OLD_SEVEN, [])).toBe(PendingChoiceState.OPEN);
    });

    it("should return OPEN when the same new key is chosen with another old id and no other key holds the pending old id", () => {
      const sameKeyOtherOld = choiceOf({ number: "100", oldId: 55 });

      expect(pendingChoiceStateOf(KEY_ONE_OLD_SEVEN, [sameKeyOtherOld])).toBe(PendingChoiceState.OPEN);
    });

    it("should return BLOCKED when another new key already chose the pending old id", () => {
      expect(pendingChoiceStateOf(KEY_THREE_OLD_SEVEN, [KEY_ONE_OLD_SEVEN])).toBe(PendingChoiceState.BLOCKED);
    });

    it("should return BLOCKED, not ACCEPTED, when the old id is taken by another key and the same key is not chosen", () => {
      expect(pendingChoiceStateOf(KEY_THREE_OLD_SEVEN, [KEY_TWO_OLD_EIGHT, KEY_ONE_OLD_SEVEN])).toBe(PendingChoiceState.BLOCKED);
    });
  });

  describe("acceptableChoicesOf", () => {
    it("should return an empty list when there are no pending choices", () => {
      expect(acceptableChoicesOf([], [])).toEqual([]);
    });

    it("should return every open pending choice in the order given when their old ids differ", () => {
      expect(acceptableChoicesOf([KEY_ONE_OLD_SEVEN, KEY_TWO_OLD_EIGHT], [])).toEqual([KEY_ONE_OLD_SEVEN, KEY_TWO_OLD_EIGHT]);
    });

    it("should yield at most one choice per old id when two new keys name the same old id", () => {
      const result = acceptableChoicesOf([KEY_ONE_OLD_SEVEN, KEY_THREE_OLD_SEVEN], []);

      expect(result).toEqual([KEY_ONE_OLD_SEVEN]);
    });

    it("should keep the choice listed first when two new keys share an old id and the list is reversed", () => {
      const result = acceptableChoicesOf([KEY_THREE_OLD_SEVEN, KEY_ONE_OLD_SEVEN], []);

      expect(result).toEqual([KEY_THREE_OLD_SEVEN]);
    });

    it("should skip a pending choice that is already ACCEPTED in the current choices", () => {
      expect(acceptableChoicesOf([KEY_ONE_OLD_SEVEN, KEY_TWO_OLD_EIGHT], [KEY_ONE_OLD_SEVEN])).toEqual([KEY_TWO_OLD_EIGHT]);
    });

    it("should skip a pending choice that is BLOCKED by a current choice of another new key", () => {
      expect(acceptableChoicesOf([KEY_THREE_OLD_SEVEN, KEY_TWO_OLD_EIGHT], [KEY_ONE_OLD_SEVEN])).toEqual([KEY_TWO_OLD_EIGHT]);
    });

    it("should skip null entries and NONE entries without failing", () => {
      expect(acceptableChoicesOf([null, KEY_TWO_OLD_EIGHT, null], [])).toEqual([KEY_TWO_OLD_EIGHT]);
    });
  });

  describe("choiceIndexOf and pendingChoiceStateIn parity with pendingChoiceStateOf", () => {
    const CURRENT = [KEY_ONE_OLD_SEVEN, KEY_TWO_OLD_EIGHT];
    const SAME_KEY_OTHER_OLD = choiceOf({ number: "100", oldId: 55 });
    const PENDING = [KEY_ONE_OLD_SEVEN, KEY_TWO_OLD_EIGHT, KEY_THREE_OLD_SEVEN, null, SAME_KEY_OTHER_OLD];

    it("should return one state per pending pair that matches the list lookup, covering ACCEPTED, BLOCKED, NONE and OPEN", () => {
      const index = choiceIndexOf(CURRENT);

      const indexed = PENDING.map((choice) => pendingChoiceStateIn(index, choice));
      const listed = PENDING.map((choice) => pendingChoiceStateOf(choice, CURRENT));

      expect(indexed).toEqual([
        PendingChoiceState.ACCEPTED,
        PendingChoiceState.ACCEPTED,
        PendingChoiceState.BLOCKED,
        PendingChoiceState.NONE,
        PendingChoiceState.OPEN,
      ]);
      expect(indexed).toEqual(listed);
    });

    it("should return the same state from one reused index for every pending pair when the current list is empty", () => {
      const index = choiceIndexOf([]);

      for (const choice of PENDING) {
        expect(pendingChoiceStateIn(index, choice)).toBe(pendingChoiceStateOf(choice, []));
      }
    });

    it("should index the old ids of the current choices so a pending pair with a taken old id is BLOCKED", () => {
      const index = choiceIndexOf(CURRENT);

      expect(index.oldIds.has(7)).toBe(true);
      expect(index.oldIds.has(55)).toBe(false);
      expect(pendingChoiceStateIn(index, KEY_THREE_OLD_SEVEN)).toBe(PendingChoiceState.BLOCKED);
    });
  });

  describe("choicesWithinLimit", () => {
    const LIMIT = 5000;
    const choicesOfKeys = (from: number, count: number): PairChoice[] =>
      Array.from({ length: count }, (_, offset) => choiceOf({ number: `k${from + offset}`, oldId: from + offset }));
    const NEW_KEY = choiceOf({ number: "new-key", oldId: 900001 });
    const NEW_KEY_TWO = choiceOf({ number: "new-key-two", oldId: 900002 });

    it("should return the cap of 5000 used by the pending list", () => {
      expect(PAIR_LIST_LIMIT).toBe(LIMIT);
    });

    it("should return every incoming choice untruncated when the list stays under the limit", () => {
      expect(choicesWithinLimit([KEY_ONE_OLD_SEVEN, KEY_TWO_OLD_EIGHT], [], LIMIT)).toEqual({
        choices: [KEY_ONE_OLD_SEVEN, KEY_TWO_OLD_EIGHT],
        truncated: false,
      });
    });

    it("should accept a new key that brings the list exactly to the limit", () => {
      const current = choicesOfKeys(0, LIMIT - 1);

      expect(choicesWithinLimit([NEW_KEY], current, LIMIT)).toEqual({ choices: [NEW_KEY], truncated: false });
    });

    it("should refuse a new key when the list is already at the limit and report truncated", () => {
      const current = choicesOfKeys(0, LIMIT);

      expect(choicesWithinLimit([NEW_KEY], current, LIMIT)).toEqual({ choices: [], truncated: true });
    });

    it("should stop at the first new key that would pass the limit and drop every choice after it", () => {
      const current = choicesOfKeys(0, LIMIT - 1);

      expect(choicesWithinLimit([NEW_KEY, NEW_KEY_TWO], current, LIMIT)).toEqual({ choices: [NEW_KEY], truncated: true });
    });

    it("should keep a same-key replacement at the limit, because it adds nothing to the list", () => {
      const current = choicesOfKeys(0, LIMIT);
      const replacement = choiceOf({ number: "k0", oldId: 4242 });

      expect(choicesWithinLimit([replacement], current, LIMIT)).toEqual({ choices: [replacement], truncated: false });
    });

    it("should keep a same-key replacement before a refused new key and report truncated at the new key", () => {
      const current = choicesOfKeys(0, LIMIT);
      const replacement = choiceOf({ number: "k0", oldId: 4242 });

      expect(choicesWithinLimit([replacement, NEW_KEY], current, LIMIT)).toEqual({ choices: [replacement], truncated: true });
    });

    it("should count a repeated key in the incoming list once, so the second occurrence adds nothing", () => {
      expect(choicesWithinLimit([KEY_ONE_OLD_SEVEN, KEY_ONE_OLD_SEVEN], [], 1)).toEqual({
        choices: [KEY_ONE_OLD_SEVEN, KEY_ONE_OLD_SEVEN],
        truncated: false,
      });
    });

    it("should return no choices and not truncated when the incoming list is empty", () => {
      expect(choicesWithinLimit([], choicesOfKeys(0, LIMIT), LIMIT)).toEqual({ choices: [], truncated: false });
    });
  });
});
