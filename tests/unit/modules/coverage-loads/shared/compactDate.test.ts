import { describe, expect, it } from "vitest";
import { formatCompactDate } from "@/modules/coverage-loads/shared/domain/compactDate";

describe("formatCompactDate (AC-21)", () => {
  it("should zero-pad single-digit months and days using the local calendar parts", () => {
    // Arrange
    const lateEvening = new Date(2026, 0, 5, 23, 59, 59);

    // Act & Assert
    expect(formatCompactDate(lateEvening)).toBe("20260105");
    expect(formatCompactDate(new Date(2026, 11, 31, 0, 0, 0))).toBe("20261231");
  });
});
