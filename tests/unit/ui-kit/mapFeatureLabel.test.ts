import { describe, expect, it } from "vitest";
import { labelOffsetOf } from "@/ui-kit/map/MapFeatureLabel";

describe("labelOffsetOf", () => {
  it("should give six distinct vertical offsets at least one label height apart, alternating above and below", () => {
    const offsets = [0, 1, 2, 3, 4, 5].map((slot) => labelOffsetOf(slot)[1]);

    expect(offsets).toEqual([-14, 14, -42, 42, -70, 70]);
    const sorted = [...offsets].sort((a, b) => a - b);
    sorted.slice(1).forEach((value, index) => expect(value - sorted[index]).toBeGreaterThanOrEqual(28));
  });

  it("should never shift a label horizontally", () => {
    expect(labelOffsetOf(3)[0]).toBe(0);
  });
});
