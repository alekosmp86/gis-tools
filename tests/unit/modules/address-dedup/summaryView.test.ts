import { describe, expect, it } from "vitest";
import { Decision, DecisionReason, Fuente, OTHER_FUENTE_COLUMN } from "@/modules/address-dedup/constants";
import { summarizeRows } from "@/modules/address-dedup/domain/summary";
import {
  cellCount,
  columnTotal,
  decisionTotal,
  percentOf,
  reviewCount,
} from "@/modules/address-dedup/domain/summaryView";
import { makeRow } from "./rowFactory";

function fixtureSummary() {
  return summarizeRows([
    makeRow({ group_id: 1, fuente: Fuente.ANTEL, decision: Decision.KEEP, decision_reason: DecisionReason.KEPT_ALONGSIDE_PROTECTED }),
    makeRow({ group_id: 1, fuente: Fuente.IDE, decision: Decision.KEEP, decision_reason: DecisionReason.PROTECTED_SOURCE }),
    makeRow({ group_id: 2, fuente: Fuente.ANTEL, decision: Decision.REMOVE, decision_reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN }),
    makeRow({ group_id: 2, fuente: Fuente.TLK, decision: Decision.REMOVE, decision_reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN }),
    makeRow({ group_id: 2, fuente: "", decision: Decision.REMOVE, decision_reason: DecisionReason.REDUNDANT_WITH_MATCHED }),
    makeRow({ group_id: 2, fuente: "XYZ", decision: Decision.KEEP, decision_reason: DecisionReason.INFRA_MATCHED }),
  ]);
}

describe("summaryView", () => {
  it("should total each decision across every fuente, unknown ones included", () => {
    // Arrange
    const summary = fixtureSummary();

    // Act & Assert
    expect(decisionTotal(summary, Decision.REMOVE)).toBe(3);
    expect(decisionTotal(summary, Decision.KEEP)).toBe(3);
  });

  it("should count a cell, gathering unknown and empty fuentes in the other column", () => {
    // Arrange
    const summary = fixtureSummary();

    // Act & Assert
    expect(cellCount(summary, Decision.REMOVE, Fuente.ANTEL)).toBe(1);
    expect(cellCount(summary, Decision.REMOVE, Fuente.IDE)).toBe(0);
    expect(cellCount(summary, Decision.REMOVE, OTHER_FUENTE_COLUMN)).toBe(1);
    expect(cellCount(summary, Decision.KEEP, OTHER_FUENTE_COLUMN)).toBe(1);
  });

  it("should total each column over both decisions", () => {
    // Arrange
    const summary = fixtureSummary();

    // Act & Assert
    expect(columnTotal(summary, Fuente.ANTEL)).toBe(2);
    expect(columnTotal(summary, Fuente.TLK)).toBe(1);
    expect(columnTotal(summary, Fuente.IDE)).toBe(1);
    expect(columnTotal(summary, OTHER_FUENTE_COLUMN)).toBe(2);
  });

  it("should reconcile row totals, column totals and the grand total", () => {
    // Arrange
    const summary = fixtureSummary();
    const columns = [Fuente.ANTEL, Fuente.TLK, Fuente.IDE, OTHER_FUENTE_COLUMN] as const;

    // Act
    const columnSum = columns.reduce((total, column) => total + columnTotal(summary, column), 0);
    const rowSum = decisionTotal(summary, Decision.KEEP) + decisionTotal(summary, Decision.REMOVE);

    // Assert
    expect(columnSum).toBe(summary.rowCount);
    expect(rowSum).toBe(summary.rowCount);
  });

  it("should read the review count from byReason, zero when absent", () => {
    // Arrange & Act & Assert
    expect(reviewCount(fixtureSummary())).toBe(1);
    expect(reviewCount(summarizeRows([]))).toBe(0);
  });

  it("should return zeros for an empty summary", () => {
    // Arrange
    const summary = summarizeRows([]);

    // Act & Assert
    expect(decisionTotal(summary, Decision.REMOVE)).toBe(0);
    expect(cellCount(summary, Decision.KEEP, Fuente.ANTEL)).toBe(0);
    expect(columnTotal(summary, OTHER_FUENTE_COLUMN)).toBe(0);
  });
});

describe("percentOf", () => {
  it.each([
    [1, 3, 33.3],
    [2, 3, 66.7],
    [1, 8, 12.5],
    [5, 5, 100],
    [0, 7, 0],
  ])("should round %i of %i to %f percent with one decimal", (part, total, expected) => {
    // Arrange & Act & Assert
    expect(percentOf(part, total)).toBe(expected);
  });

  it("should return 0, never NaN, when the total is zero", () => {
    // Arrange & Act
    const percent = percentOf(0, 0);

    // Assert
    expect(percent).toBe(0);
    expect(Number.isNaN(percent)).toBe(false);
  });
});
