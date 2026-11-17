import { describe, expect, it } from "vitest";
import { INVALID_CHOICE_REFS_LIMIT } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { CHOICE_NOT_APPLICABLE_MESSAGE, choiceNotApplicableOf } from "@/modules/routine-jobs/jobs/ejes-calles/services/writeStatements";

describe("choiceNotApplicableOf: the abort message of an invalid choice (EJS-16)", () => {
  it("should give the plain message when no old reftramo is named", () => {
    expect(choiceNotApplicableOf([])).toBe(CHOICE_NOT_APPLICABLE_MESSAGE);
  });

  it("should name the old reftramos after the plain message, comma separated", () => {
    expect(choiceNotApplicableOf(["6001", "6002"])).toBe(`${CHOICE_NOT_APPLICABLE_MESSAGE} Tramos: 6001, 6002.`);
  });

  it("should name exactly the refs it is given, up to INVALID_CHOICE_REFS_LIMIT of them (boundary)", () => {
    expect(INVALID_CHOICE_REFS_LIMIT).toBe(5);

    const refs = ["1", "2", "3", "4", "5"];

    expect(choiceNotApplicableOf(refs)).toBe(`${CHOICE_NOT_APPLICABLE_MESSAGE} Tramos: 1, 2, 3, 4, 5.`);
  });
});
