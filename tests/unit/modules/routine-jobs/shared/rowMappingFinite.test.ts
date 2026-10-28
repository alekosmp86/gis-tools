import { describe, expect, it } from "vitest";
import { nullableNumber, numberOf } from "@/modules/routine-jobs/jobs/shared/rowMapping";

describe("numberOf never yields NaN or Infinity", () => {
  it.each(["abc", "", "12abc", NaN, Infinity, -Infinity])("should read %j as 0", (value) => {
    expect(numberOf(value)).toBe(0);
  });

  it("should read numeric text and finite numbers as themselves", () => {
    expect(numberOf("12")).toBe(12);
    expect(numberOf(3.5)).toBe(3.5);
    expect(numberOf(-4)).toBe(-4);
  });
});

describe("nullableNumber never yields NaN or Infinity", () => {
  it.each(["abc", NaN, Infinity, -Infinity])("should read %j as null", (value) => {
    expect(nullableNumber(value)).toBeNull();
  });

  it("should keep zero and finite numeric text", () => {
    expect(nullableNumber(0)).toBe(0);
    expect(nullableNumber("3.5")).toBe(3.5);
  });
});
