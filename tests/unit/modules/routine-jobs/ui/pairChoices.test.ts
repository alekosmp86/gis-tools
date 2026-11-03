import { describe, expect, it } from "vitest";
import { PAIR_STATUS, PAIR_TIER } from "@/modules/routine-jobs/jobs/actualizar-padron/constants";
import type { PadronNamedKey, PadronPair, PairChoice } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import {
  ambiguousGroupsOf,
  isUnappliedGroup,
  sameChoices,
  takenOldIds,
  unappliedChoicesOf,
  withChoice,
  withChoices,
  withoutChoices,
} from "@/modules/routine-jobs/ui/pairChoices";

const newKeyOf = (overrides: Partial<PadronNamedKey> = {}): PadronNamedKey => ({
  typePadron: "RURAL",
  provinceId: 6,
  localityId: 120,
  number: "100",
  department: "Dpto Norte",
  locality: "Localidad Uno",
  ...overrides,
});

const oldKeyOf = (overrides: Partial<PadronNamedKey> = {}): PadronNamedKey => ({
  typePadron: "RURAL",
  provinceId: 6,
  localityId: 120,
  number: "90",
  department: "Dpto Norte",
  locality: "Localidad Uno",
  ...overrides,
});

const pairOf = (overrides: Partial<PadronPair> = {}): PadronPair => ({
  status: PAIR_STATUS.NOT_APPLIED_AMBIGUOUS,
  tier: PAIR_TIER.STRICT,
  changes: [],
  oldId: 1,
  old: oldKeyOf(),
  new: newKeyOf(),
  overlap: 0.99,
  areaRatio: 1,
  oldAreaM2: 100,
  newAreaM2: 100,
  areaChangePct: 100,
  centroidLat: -34.9,
  centroidLon: -56.2,
  ...overrides,
});

const choiceOf = (overrides: Partial<PairChoice> = {}): PairChoice => ({
  typePadron: "RURAL",
  provinceId: 6,
  localityId: 120,
  number: "100",
  oldId: 1,
  ...overrides,
});

describe("pairChoices", () => {
  describe("ambiguousGroupsOf", () => {
    it("should group two ambiguous candidates of the same new key into one group in report order", () => {
      const pairs = [
        pairOf({ oldId: 11, old: oldKeyOf({ number: "81" }), overlap: 0.9, areaRatio: 0.95, tier: PAIR_TIER.LOOSE }),
        pairOf({ oldId: 12, old: oldKeyOf({ number: "82" }) }),
      ];

      const groups = ambiguousGroupsOf(pairs);

      expect(groups).toHaveLength(1);
      expect(groups[0]).toMatchObject({
        key: { typePadron: "RURAL", provinceId: 6, localityId: 120, number: "100" },
        department: "Dpto Norte",
        locality: "Localidad Uno",
      });
      expect(groups[0].candidates).toEqual([
        { oldId: 11, oldType: "RURAL", oldLocality: "Localidad Uno", oldNumber: "81", tier: PAIR_TIER.LOOSE, overlap: 0.9, areaRatio: 0.95 },
        { oldId: 12, oldType: "RURAL", oldLocality: "Localidad Uno", oldNumber: "82", tier: PAIR_TIER.STRICT, overlap: 0.99, areaRatio: 1 },
      ]);
    });

    it("should create one group per distinct new key when the new keys differ by locality", () => {
      const pairs = [
        pairOf({ oldId: 11 }),
        pairOf({ oldId: 12, new: newKeyOf({ localityId: 121 }) }),
      ];

      const groups = ambiguousGroupsOf(pairs);

      expect(groups.map((group) => group.key.localityId)).toEqual([120, 121]);
      expect(groups.map((group) => group.candidates.map((candidate) => candidate.oldId))).toEqual([[11], [12]]);
    });

    it("should ignore APPLIED pairs when grouping ambiguous candidates", () => {
      const pairs = [pairOf({ status: PAIR_STATUS.APPLIED, oldId: 11 })];

      expect(ambiguousGroupsOf(pairs)).toEqual([]);
    });

    it("should skip an ambiguous pair whose new key lacks a number", () => {
      const pairs = [pairOf({ oldId: 11, new: newKeyOf({ number: null }) })];

      expect(ambiguousGroupsOf(pairs)).toEqual([]);
    });

    it("should return no groups when there are no pairs", () => {
      expect(ambiguousGroupsOf([])).toEqual([]);
    });
  });

  describe("withChoice", () => {
    it("should replace the earlier choice of the same new key and move it to the end", () => {
      const earlier = choiceOf({ oldId: 1 });
      const other = choiceOf({ number: "200", oldId: 2 });
      const replacement = choiceOf({ oldId: 3 });

      const next = withChoice([earlier, other], replacement);

      expect(next).toEqual([other, replacement]);
    });

    it("should append the choice when no earlier choice has the same new key", () => {
      const existing = choiceOf({ number: "200", oldId: 2 });
      const added = choiceOf({ oldId: 5 });

      expect(withChoice([existing], added)).toEqual([existing, added]);
    });

    it("should keep a null old id choice that pairs nothing as a regular choice", () => {
      const cleared = choiceOf({ oldId: null });

      expect(withChoice([], cleared)).toEqual([cleared]);
    });
  });

  describe("takenOldIds", () => {
    it("should return the old ids chosen for other groups and exclude the group's own choice", () => {
      const groups = ambiguousGroupsOf([
        pairOf({ oldId: 11 }),
        pairOf({ oldId: 12, new: newKeyOf({ number: "300" }) }),
      ]);
      const [own, other] = groups;
      const choices = [choiceOf({ number: "100", oldId: 11 }), choiceOf({ number: "300", oldId: 12 })];

      expect([...takenOldIds(choices, own)]).toEqual([12]);
      expect([...takenOldIds(choices, other)]).toEqual([11]);
    });

    it("should ignore null old id choices when collecting taken old ids", () => {
      const groups = ambiguousGroupsOf([pairOf({ oldId: 11 }), pairOf({ oldId: 12, new: newKeyOf({ number: "300" }) })]);
      const choices = [choiceOf({ number: "300", oldId: null })];

      expect([...takenOldIds(choices, groups[0])]).toEqual([]);
    });
  });

  describe("sameChoices", () => {
    it("should return true for two empty lists", () => {
      expect(sameChoices([], [])).toBe(true);
    });

    it("should return true for the same choices listed in another order", () => {
      const first = choiceOf({ oldId: 1 });
      const second = choiceOf({ number: "200", oldId: 2 });

      expect(sameChoices([first, second], [second, first])).toBe(true);
    });

    it("should return false when a list is empty and the other holds a choice", () => {
      expect(sameChoices([choiceOf({ oldId: 1 })], [])).toBe(false);
      expect(sameChoices([], [choiceOf({ oldId: 1 })])).toBe(false);
    });

    it("should return false when the same new key is chosen with another old id", () => {
      expect(sameChoices([choiceOf({ oldId: 1 })], [choiceOf({ oldId: 2 })])).toBe(false);
    });

    it("should return false when a chosen old id is compared with a null no-pair choice of the same key", () => {
      expect(sameChoices([choiceOf({ oldId: 1 })], [choiceOf({ oldId: null })])).toBe(false);
    });

    it("should return false when one list has an extra choice for another new key", () => {
      const first = choiceOf({ oldId: 1 });
      const extra = choiceOf({ number: "200", oldId: 2 });

      expect(sameChoices([first, extra], [first])).toBe(false);
    });
  });

  describe("unappliedChoicesOf and isUnappliedGroup", () => {
    const appliedPair = pairOf({ status: PAIR_STATUS.APPLIED, oldId: 1 });
    const ambiguousPair = pairOf({ status: PAIR_STATUS.NOT_APPLIED_AMBIGUOUS, oldId: 1 });

    it("should clear a choice whose own submitted version ended as an APPLIED pair in the shown run", () => {
      const chosen = choiceOf({ oldId: 1 });

      expect(unappliedChoicesOf([chosen], [chosen], [appliedPair])).toEqual([]);
    });

    it("should report a submitted choice whose pair did not end as APPLIED in the shown run", () => {
      const chosen = choiceOf({ oldId: 1 });

      expect(unappliedChoicesOf([chosen], [chosen], [ambiguousPair])).toEqual([chosen]);
    });

    it("should not report a choice picked after the shown run, since it was never submitted", () => {
      const picked = choiceOf({ oldId: 1 });

      expect(unappliedChoicesOf([picked], [], [ambiguousPair])).toEqual([]);
    });

    it("should never report a null old id choice as unapplied", () => {
      const cleared = choiceOf({ oldId: null });

      expect(unappliedChoicesOf([cleared], [cleared], [])).toEqual([]);
    });

    it("should keep a choice unapplied when the only APPLIED pair carries another new key with the same old id", () => {
      const chosen = choiceOf({ oldId: 1 });
      const otherKeyApplied = pairOf({ status: PAIR_STATUS.APPLIED, oldId: 1, new: newKeyOf({ number: "999" }) });

      expect(unappliedChoicesOf([chosen], [chosen], [otherKeyApplied])).toEqual([chosen]);
    });

    it("should flag the group of an unapplied choice and not the group of a choice that applied", () => {
      const groups = ambiguousGroupsOf([pairOf({ oldId: 11 }), pairOf({ oldId: 12, new: newKeyOf({ number: "300" }) })]);
      const [failedGroup, otherGroup] = groups;
      const unapplied = [choiceOf({ number: "100", oldId: 11 })];

      expect(isUnappliedGroup(failedGroup, unapplied)).toBe(true);
      expect(isUnappliedGroup(otherGroup, unapplied)).toBe(false);
    });

    it("should flag no group when there are no unapplied choices", () => {
      const groups = ambiguousGroupsOf([pairOf({ oldId: 11 })]);

      expect(isUnappliedGroup(groups[0], [])).toBe(false);
    });
  });

  describe("withChoices (bulk form of withChoice)", () => {
    const FIRST = choiceOf({ number: "100", oldId: 1 });
    const SECOND = choiceOf({ number: "200", oldId: 2 });
    const THIRD = choiceOf({ number: "300", oldId: 3 });

    it("should add every incoming choice to an empty list", () => {
      expect(withChoices([], [FIRST, SECOND])).toEqual([FIRST, SECOND]);
    });

    it("should keep the choices of other new keys when incoming choices are added", () => {
      const result = withChoices([FIRST], [SECOND, THIRD]);

      expect(result).toHaveLength(3);
      expect(result).toEqual(expect.arrayContaining([FIRST, SECOND, THIRD]));
    });

    it("should replace the earlier choice of a new key without leaving a duplicate", () => {
      const replacement = choiceOf({ number: "100", oldId: 9 });

      const result = withChoices([FIRST, SECOND], [replacement]);

      expect(result).toHaveLength(2);
      expect(result).toEqual(expect.arrayContaining([replacement, SECOND]));
      expect(result).not.toContainEqual(FIRST);
    });

    it("should keep the last of two incoming choices that name the same new key", () => {
      const later = choiceOf({ number: "100", oldId: 9 });

      const result = withChoices([], [FIRST, later]);

      expect(result).toEqual([later]);
    });

    it("should return the same choices when the incoming list is empty", () => {
      expect(withChoices([FIRST, SECOND], [])).toEqual([FIRST, SECOND]);
    });

    it("should not mutate the choices it was given", () => {
      const current = [FIRST];
      const incoming = [SECOND];

      withChoices(current, incoming);

      expect(current).toEqual([FIRST]);
      expect(incoming).toEqual([SECOND]);
    });
  });

  describe("withoutChoices (bulk form of withoutChoice)", () => {
    const FIRST = choiceOf({ number: "100", oldId: 1 });
    const SECOND = choiceOf({ number: "200", oldId: 2 });
    const THIRD = choiceOf({ number: "300", oldId: 3 });

    it("should remove every choice whose new key is listed, whatever its old id", () => {
      const removed = [choiceOf({ number: "100", oldId: 99 }), choiceOf({ number: "200", oldId: null })];

      expect(withoutChoices([FIRST, SECOND, THIRD], removed)).toEqual([THIRD]);
    });

    it("should keep every choice when none of the listed new keys is chosen", () => {
      expect(withoutChoices([FIRST, SECOND], [choiceOf({ number: "999" })])).toEqual([FIRST, SECOND]);
    });

    it("should return every choice when the removed list is empty", () => {
      expect(withoutChoices([FIRST, SECOND], [])).toEqual([FIRST, SECOND]);
    });

    it("should return an empty list when every chosen new key is removed", () => {
      expect(withoutChoices([FIRST, SECOND], [FIRST, SECOND])).toEqual([]);
    });

    it("should not mutate the choices it was given", () => {
      const current = [FIRST, SECOND];

      withoutChoices(current, [FIRST]);

      expect(current).toEqual([FIRST, SECOND]);
    });
  });
});
