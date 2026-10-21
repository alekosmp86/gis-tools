import { describe, expect, it } from "vitest";
import { evaluateLoad } from "@/modules/coverage-loads/sigra-layers/domain/validation";

describe("evaluateLoad", () => {
  it("should pass with a null ratio when the final table is empty and nothing was staged", () => {
    const verdict = evaluateLoad({ stagedCount: 0, finalCount: 0 });

    expect(verdict.ok).toBe(true);
    expect(verdict.ratio).toBeNull();
  });

  it("should pass with a null ratio when the final table is empty and rows were staged", () => {
    const verdict = evaluateLoad({ stagedCount: 500, finalCount: 0 });

    expect(verdict.ok).toBe(true);
    expect(verdict.ratio).toBeNull();
  });

  it("should pass when staged is 97 of 100", () => {
    const verdict = evaluateLoad({ stagedCount: 97, finalCount: 100 });

    expect(verdict.ok).toBe(true);
    expect(verdict.ratio).toBeCloseTo(0.97, 10);
  });

  it("should fail when staged is 96 of 100", () => {
    const verdict = evaluateLoad({ stagedCount: 96, finalCount: 100 });

    expect(verdict.ok).toBe(false);
    expect(verdict.ratio).toBeCloseTo(0.96, 10);
  });

  it("should pass when staged is exactly 970 of 1000", () => {
    const verdict = evaluateLoad({ stagedCount: 970, finalCount: 1000 });

    expect(verdict.ok).toBe(true);
  });

  it("should fail when staged is 969 of 1000", () => {
    const verdict = evaluateLoad({ stagedCount: 969, finalCount: 1000 });

    expect(verdict.ok).toBe(false);
  });

  it("should pass when staged is larger than final", () => {
    const verdict = evaluateLoad({ stagedCount: 150, finalCount: 100 });

    expect(verdict.ok).toBe(true);
    expect(verdict.ratio).toBeCloseTo(1.5, 10);
  });

  it("should pass when staged equals final", () => {
    const verdict = evaluateLoad({ stagedCount: 100, finalCount: 100 });

    expect(verdict.ok).toBe(true);
    expect(verdict.ratio).toBe(1);
  });

  it("should fail when nothing was staged but the final table has rows", () => {
    const verdict = evaluateLoad({ stagedCount: 0, finalCount: 5 });

    expect(verdict.ok).toBe(false);
    expect(verdict.ratio).toBe(0);
  });

  it("should name both counts in the message when the load is rejected", () => {
    const verdict = evaluateLoad({ stagedCount: 96, finalCount: 100 });

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/96/);
    expect(verdict.message).toMatch(/100/);
  });

  it("should name both counts for a large rejected load", () => {
    const verdict = evaluateLoad({ stagedCount: 12345, finalCount: 289000 });

    expect(verdict.ok).toBe(false);
    expect(verdict.message).toMatch(/12345|12\.345|12,345/);
    expect(verdict.message).toMatch(/289000|289\.000|289,000/);
  });

  it("should return a string message when the load passes", () => {
    const verdict = evaluateLoad({ stagedCount: 100, finalCount: 100 });

    expect(typeof verdict.message).toBe("string");
  });
});
