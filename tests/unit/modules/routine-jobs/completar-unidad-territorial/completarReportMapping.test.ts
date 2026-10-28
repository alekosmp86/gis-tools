import { describe, expect, it } from "vitest";
import {
  completarCountsOf,
  toCompletarApplyOutcome,
  toCompletarClassification,
  toRemainingCount,
} from "@/modules/routine-jobs/jobs/completar-unidad-territorial/domain/reportMapping";
import { linkedUnitOf } from "./completarFixtures";

const classificationRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  without_address_master: 5,
  to_create: 2,
  already_had_record: 2,
  ambiguous: 1,
  ambiguous_samples: [{ id: 7, name: "Ambigua", provinceId: "09", records: 2 }],
  ...overrides,
});

describe("toCompletarClassification", () => {
  it("should map the classification counters to the report counts", () => {
    const classification = toCompletarClassification(classificationRow());

    expect(classification.counts).toEqual({ withoutAddressMaster: 5, created: 2, alreadyHadRecord: 2, ambiguous: 1 });
  });

  it("should map each ambiguous sample to its unit key and record count", () => {
    const classification = toCompletarClassification(classificationRow());

    expect(classification.ambiguousSamples).toEqual([{ id: 7, name: "Ambigua", provinceId: "09", records: 2 }]);
  });

  it("should read counters sent as numeric text as numbers", () => {
    const classification = toCompletarClassification(classificationRow({ to_create: "3", ambiguous: "0" }));

    expect(classification.counts.created).toBe(3);
    expect(classification.counts.ambiguous).toBe(0);
  });

  it("should map a missing row to zero counts and no samples", () => {
    const classification = toCompletarClassification({});

    expect(classification.counts).toEqual({ withoutAddressMaster: 0, created: 0, alreadyHadRecord: 0, ambiguous: 0 });
    expect(classification.ambiguousSamples).toEqual([]);
  });

  it("should keep a null name and province as null and never invent them", () => {
    const classification = toCompletarClassification(
      classificationRow({ ambiguous_samples: [{ id: 3, name: null, provinceId: null, records: 3 }] }),
    );

    expect(classification.ambiguousSamples[0]).toEqual({ id: 3, name: null, provinceId: null, records: 3 });
  });

  it("should map a non-array sample value to an empty sample list", () => {
    expect(toCompletarClassification(classificationRow({ ambiguous_samples: null })).ambiguousSamples).toEqual([]);
  });
});

describe("toCompletarApplyOutcome", () => {
  it("should map the created and linked totals and the linked list", () => {
    const outcome = toCompletarApplyOutcome({
      created: 1,
      linked: 2,
      linked_list: [
        { id: 101, name: "Uno", provinceId: "02", addressMasterId: 501, created: true },
        { id: 102, name: "Dos", provinceId: "02", addressMasterId: 17, created: false },
      ],
    });

    expect(outcome).toEqual({
      created: 1,
      linked: 2,
      linkedList: [
        { id: 101, name: "Uno", provinceId: "02", addressMasterId: 501, created: true },
        { id: 102, name: "Dos", provinceId: "02", addressMasterId: 17, created: false },
      ],
    });
  });

  it("should flag a unit as created only when the server says true", () => {
    const outcome = toCompletarApplyOutcome({
      created: 0,
      linked: 2,
      linked_list: [
        { id: 1, name: "a", provinceId: "02", addressMasterId: 1, created: "true" },
        { id: 2, name: "b", provinceId: "02", addressMasterId: 2, created: null },
      ],
    });

    expect(outcome.linkedList.map((unit) => unit.created)).toEqual([false, false]);
  });

  it("should map an empty row to zero totals and an empty list", () => {
    expect(toCompletarApplyOutcome({})).toEqual({ created: 0, linked: 0, linkedList: [] });
  });
});

describe("toRemainingCount", () => {
  it("should read the remaining count", () => {
    expect(toRemainingCount({ remaining: 4 })).toBe(4);
  });

  it("should read zero when the row has no remaining count", () => {
    expect(toRemainingCount({})).toBe(0);
  });
});

describe("completarCountsOf", () => {
  it("should take the created and linked totals from the apply, not from the classification", () => {
    const counts = completarCountsOf(
      {
        counts: { withoutAddressMaster: 5, created: 2, alreadyHadRecord: 2, ambiguous: 1 },
        ambiguousSamples: [],
      },
      { created: 2, linked: 4, linkedList: [linkedUnitOf()] },
    );

    expect(counts).toEqual({ withoutAddressMaster: 5, created: 2, linked: 4, alreadyHadRecord: 2, ambiguous: 1 });
  });

  it("should keep the classification counts that the apply does not report", () => {
    const counts = completarCountsOf(
      {
        counts: { withoutAddressMaster: 3, created: 0, alreadyHadRecord: 3, ambiguous: 0 },
        ambiguousSamples: [],
      },
      { created: 0, linked: 3, linkedList: [] },
    );

    expect(counts.alreadyHadRecord).toBe(3);
    expect(counts.withoutAddressMaster).toBe(3);
  });
});
