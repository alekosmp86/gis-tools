import { describe, expect, it } from "vitest";
import { isScrolledPastThreshold, resolveScrollBehavior } from "@/ui-kit/components/backToTopLogic";

describe("backToTopLogic", () => {
  describe("isScrolledPastThreshold", () => {
    it.each([
      [0, false],
      [399, false],
      [400, false],
      [400.5, true],
      [401, true],
      [100000, true],
      [-1, false],
      [-500, false],
    ])("should return the expected visibility for scrollY=%s with the default threshold", (scrollY, expected) => {
      expect(isScrolledPastThreshold(scrollY)).toBe(expected);
    });

    it("should use a custom threshold when provided", () => {
      expect(isScrolledPastThreshold(100, 100)).toBe(false);
      expect(isScrolledPastThreshold(101, 100)).toBe(true);
      expect(isScrolledPastThreshold(401, 1000)).toBe(false);
    });
  });

  describe("resolveScrollBehavior", () => {
    it("should return auto when the user prefers reduced motion", () => {
      expect(resolveScrollBehavior(true)).toBe("auto");
    });

    it("should return smooth when the user does not prefer reduced motion", () => {
      expect(resolveScrollBehavior(false)).toBe("smooth");
    });
  });
});
