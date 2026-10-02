import { describe, expect, it } from "vitest";
import { Decision, DecisionReason, Fuente } from "@/modules/address-dedup/constants";
import { summarizeRows } from "@/modules/address-dedup/domain/summary";
import { makeRow } from "./rowFactory";

describe("summarizeRows", () => {
  it("should count decision by fuente, reasons and groups against a hand-computed fixture", () => {
    // Arrange
    const rows = [
      makeRow({ group_id: 1, fuente: Fuente.IDE, decision: Decision.KEEP, decision_reason: DecisionReason.PROTECTED_SOURCE }),
      makeRow({ group_id: 1, fuente: Fuente.ANTEL, decision: Decision.KEEP, decision_reason: DecisionReason.KEPT_ALONGSIDE_PROTECTED }),
      makeRow({ group_id: 2, fuente: Fuente.ANTEL, decision: Decision.KEEP, decision_reason: DecisionReason.LOWEST_URN_KEPT }),
      makeRow({ group_id: 2, fuente: Fuente.ANTEL, decision: Decision.REMOVE, decision_reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN }),
      makeRow({ group_id: 2, fuente: Fuente.TLK, decision: Decision.REMOVE, decision_reason: DecisionReason.REDUNDANT_NOT_LOWEST_URN }),
      makeRow({ group_id: 3, fuente: Fuente.TLK, decision: Decision.REMOVE, decision_reason: DecisionReason.REDUNDANT_WITH_MATCHED }),
      makeRow({ group_id: 3, fuente: Fuente.TLK, decision: Decision.KEEP, decision_reason: DecisionReason.INFRA_MATCHED }),
    ];

    // Act
    const summary = summarizeRows(rows);

    // Assert
    expect(summary.groupCount).toBe(3);
    expect(summary.rowCount).toBe(7);
    expect(summary.byDecisionAndFuente).toEqual({
      [Decision.KEEP]: { [Fuente.IDE]: 1, [Fuente.ANTEL]: 2, [Fuente.TLK]: 1 },
      [Decision.REMOVE]: { [Fuente.ANTEL]: 1, [Fuente.TLK]: 2 },
    });
    expect(summary.byReason).toEqual({
      [DecisionReason.PROTECTED_SOURCE]: 1,
      [DecisionReason.KEPT_ALONGSIDE_PROTECTED]: 1,
      [DecisionReason.LOWEST_URN_KEPT]: 1,
      [DecisionReason.REDUNDANT_NOT_LOWEST_URN]: 2,
      [DecisionReason.REDUNDANT_WITH_MATCHED]: 1,
      [DecisionReason.INFRA_MATCHED]: 1,
    });
  });

  it("should return zero counts and empty tables for empty input", () => {
    // Arrange & Act
    const summary = summarizeRows([]);

    // Assert
    expect(summary).toEqual({ groupCount: 0, rowCount: 0, byDecisionAndFuente: {}, byReason: {} });
  });

  it("should still count a row with an empty fuente in the totals", () => {
    // Arrange
    const rows = [
      makeRow({ fuente: Fuente.ANTEL, decision: Decision.KEEP }),
      makeRow({ fuente: "", decision: Decision.KEEP }),
    ];

    // Act
    const summary = summarizeRows(rows);

    // Assert
    expect(summary.rowCount).toBe(2);
    expect(summary.byDecisionAndFuente[Decision.KEEP]).toEqual({ [Fuente.ANTEL]: 1, "": 1 });
  });
});
