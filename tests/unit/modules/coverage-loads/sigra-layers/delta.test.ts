import { describe, expect, it } from "vitest";
import {
  DELTA_PLACEHOLDER,
  deltaClassName,
  formatDelta,
  layerDelta,
  resultDelta,
} from "@/modules/coverage-loads/sigra-layers/ui/delta";
import shared from "@/modules/coverage-loads/sigra-layers/ui/SigraShared.module.css";
import { LayerLoadStatus, type LayerLoadResult } from "@/modules/coverage-loads/sigra-layers/types";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";

const LAYER_ID = SigraLayerId.ZONAS_FTTH;

function resultOf(overrides: Partial<LayerLoadResult> = {}): LayerLoadResult {
  return {
    layerId: LAYER_ID,
    status: LayerLoadStatus.LOADED,
    downloaded: 1111,
    staged: 2222,
    duplicatesIgnored: 33,
    previousCount: 4444,
    finalCount: 5555,
    elapsedMs: 10,
    step: null,
    message: "Carga correcta",
    auditWarning: null,
    ...overrides,
  };
}

const THOUSANDS_SEPARATOR = "[.,\\s\\u00a0\\u202f]";

describe("layerDelta", () => {
  it("should return the difference between the WFS count and the table row count when both are known", () => {
    // Arrange
    const rowCount = 12345;
    const wfsCount = 54321;

    // Act
    const delta = layerDelta(rowCount, wfsCount);

    // Assert
    expect(delta).toBe(41976);
  });

  it("should return a negative delta when the WFS count is lower than the row count", () => {
    // Arrange & Act
    const delta = layerDelta(100, 95);

    // Assert
    expect(delta).toBe(-5);
  });

  it("should return zero when the WFS count equals the row count", () => {
    // Arrange & Act
    const delta = layerDelta(777, 777);

    // Assert
    expect(delta).toBe(0);
  });

  it("should return zero, not null, when both counts are zero", () => {
    // Arrange & Act
    const delta = layerDelta(0, 0);

    // Assert
    expect(delta).toBe(0);
  });

  it("should return null when the row count is null", () => {
    // Arrange & Act
    const delta = layerDelta(null, 500);

    // Assert
    expect(delta).toBeNull();
  });

  it("should return null when the WFS count is null", () => {
    // Arrange & Act
    const delta = layerDelta(500, null);

    // Assert
    expect(delta).toBeNull();
  });

  it("should return null when both counts are null", () => {
    // Arrange & Act
    const delta = layerDelta(null, null);

    // Assert
    expect(delta).toBeNull();
  });
});

describe("resultDelta", () => {
  it("should compare the staged count with the previous count on a dry run", () => {
    // Arrange
    const result = resultOf({ staged: 2222, previousCount: 4444, finalCount: 9999 });

    // Act
    const delta = resultDelta(result, true);

    // Assert
    expect(delta).toBe(-2222);
  });

  it("should compare the final count with the previous count on a real run", () => {
    // Arrange
    const result = resultOf({ staged: 2222, previousCount: 4444, finalCount: 5555 });

    // Act
    const delta = resultDelta(result, false);

    // Assert
    expect(delta).toBe(1111);
  });

  it("should ignore the final count on a dry run and use the staged count even when final is null", () => {
    // Arrange
    const result = resultOf({ staged: 4444, previousCount: 4444, finalCount: null });

    // Act
    const delta = resultDelta(result, true);

    // Assert
    expect(delta).toBe(0);
  });

  it("should return null on a real run when the final count is null", () => {
    // Arrange
    const result = resultOf({ staged: 2222, previousCount: 4444, finalCount: null });

    // Act
    const delta = resultDelta(result, false);

    // Assert
    expect(delta).toBeNull();
  });

  it("should return null when there is no previous count, on a dry run or a real run", () => {
    // Arrange
    const result = resultOf({ previousCount: null });

    // Act & Assert
    expect(resultDelta(result, true)).toBeNull();
    expect(resultDelta(result, false)).toBeNull();
  });

  it("should return null for a FAILED layer whatever its counts", () => {
    // Arrange
    const result = resultOf({ status: LayerLoadStatus.FAILED, previousCount: 4444, finalCount: 5555 });

    // Act & Assert
    expect(resultDelta(result, true)).toBeNull();
    expect(resultDelta(result, false)).toBeNull();
  });

  it("should return null for a REJECTED_VALIDATION layer whatever its counts", () => {
    // Arrange
    const result = resultOf({ status: LayerLoadStatus.REJECTED_VALIDATION, staged: 1, previousCount: 4444, finalCount: 5555 });

    // Act & Assert
    expect(resultDelta(result, true)).toBeNull();
    expect(resultDelta(result, false)).toBeNull();
  });

  it("should return a zero delta for a successful layer whose count did not change", () => {
    // Arrange
    const result = resultOf({ status: LayerLoadStatus.DRY_RUN_OK, staged: 4444, previousCount: 4444 });

    // Act
    const delta = resultDelta(result, true);

    // Assert
    expect(delta).toBe(0);
  });
});

describe("formatDelta", () => {
  it("should return the placeholder when the delta is null", () => {
    // Arrange & Act
    const text = formatDelta(null);

    // Assert
    expect(text).toBe(DELTA_PLACEHOLDER);
    expect(text).toBe("—");
  });

  it("should prefix a positive delta with a plus sign and group its thousands", () => {
    // Arrange & Act
    const text = formatDelta(1234);

    // Assert
    expect(text).toMatch(new RegExp(`^\\+1${THOUSANDS_SEPARATOR}?234$`));
  });

  it("should prefix a delta of one with a plus sign", () => {
    // Arrange & Act & Assert
    expect(formatDelta(1)).toBe("+1");
  });

  it("should keep the minus sign and no plus sign for a negative delta", () => {
    // Arrange & Act
    const text = formatDelta(-1234);

    // Assert
    expect(text).toMatch(new RegExp(`^-1${THOUSANDS_SEPARATOR}?234$`));
    expect(text.startsWith("+")).toBe(false);
  });

  it("should keep the minus sign for a delta of minus one", () => {
    // Arrange & Act & Assert
    expect(formatDelta(-1)).toBe("-1");
  });

  it("should print zero without a sign", () => {
    // Arrange & Act
    const text = formatDelta(0);

    // Assert
    expect(text).toBe("0");
  });
});

describe("deltaClassName", () => {
  it("should return the positive class for a positive delta", () => {
    // Arrange & Act
    const className = deltaClassName(5);

    // Assert
    expect(className).toBe(shared.positive);
    expect(className).toBeTruthy();
  });

  it("should return the negative class for a negative delta", () => {
    // Arrange & Act
    const className = deltaClassName(-5);

    // Assert
    expect(className).toBe(shared.negative);
    expect(className).toBeTruthy();
  });

  it("should return no class for a zero delta", () => {
    // Arrange & Act & Assert
    expect(deltaClassName(0)).toBe("");
  });

  it("should return no class for a null delta", () => {
    // Arrange & Act & Assert
    expect(deltaClassName(null)).toBe("");
  });

  it("should use different classes for positive and negative deltas", () => {
    // Arrange & Act & Assert
    expect(deltaClassName(1)).not.toBe(deltaClassName(-1));
  });
});
