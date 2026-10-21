import { describe, expect, it } from "vitest";
import {
  collectRejectedRows,
  groupRejectedByFile,
  listIncompleteMessages,
  listOtherBlockers,
} from "@/modules/coverage-loads/indicators/domain/planView";
import type { CutPlan, IndicatorsPlan, LoadedCut, LoadResult, RejectedRow } from "@/modules/coverage-loads/indicators/client";

function rejected(file: string, line: number): RejectedRow {
  return { file, line, text: `fila ${line}`, reason: "motivo" };
}

function cutPlan(fileName: string, rejectedRows: RejectedRow[]): CutPlan {
  return {
    fileName,
    fechaact: "2026-09-01",
    totalRows: 10,
    validRows: 10 - rejectedRows.length,
    rejectedRows,
    existingRows: 0,
    incomplete: rejectedRows.length > 0,
    shrinks: false,
    replaceMessage: "",
    incompleteMessage: null,
    shrinkMessage: null,
  };
}

function plan(overrides: Partial<IndicatorsPlan> = {}): IndicatorsPlan {
  return {
    cuts: [],
    fileErrors: [],
    privilegeShortfalls: [],
    canLoad: true,
    requiresAcceptShrink: false,
    hasIncompleteCut: false,
    blockers: [],
    ...overrides,
  };
}

function loadedCut(incompleteMessage: string | null): LoadedCut {
  return {
    fileName: "f.csv",
    fechaact: "2026-09-01",
    replacedRows: 0,
    insertedRows: 1,
    storedRows: 1,
    rejectedRows: incompleteMessage ? 1 : 0,
    incomplete: incompleteMessage !== null,
    incompleteMessage,
  };
}

describe("planView (AC-28)", () => {
  describe("collectRejectedRows", () => {
    it("should flatten the rejected rows of every cut in plan order", () => {
      // Arrange
      const first = [rejected("a.csv", 3), rejected("a.csv", 5)];
      const second = [rejected("b.csv", 2)];

      // Act
      const rows = collectRejectedRows(plan({ cuts: [cutPlan("a.csv", first), cutPlan("c.csv", []), cutPlan("b.csv", second)] }));

      // Assert
      expect(rows).toEqual([...first, ...second]);
    });

    it("should return an empty list when there are no cuts", () => {
      // Arrange, Act & Assert
      expect(collectRejectedRows(plan())).toEqual([]);
    });
  });

  describe("groupRejectedByFile", () => {
    it("should group by file keeping the order in which files first appear", () => {
      // Arrange
      const rows = [rejected("b.csv", 4), rejected("a.csv", 2), rejected("b.csv", 9), rejected("a.csv", 3)];

      // Act
      const groups = groupRejectedByFile(rows);

      // Assert
      expect(groups.map((group) => group.file)).toEqual(["b.csv", "a.csv"]);
      expect(groups[0].rows.map((row) => row.line)).toEqual([4, 9]);
      expect(groups[1].rows.map((row) => row.line)).toEqual([2, 3]);
    });

    it("should return no groups for no rows", () => {
      // Arrange, Act & Assert
      expect(groupRejectedByFile([])).toEqual([]);
    });
  });

  describe("listOtherBlockers", () => {
    it("should drop the blockers that are already shown as file errors", () => {
      // Arrange
      const reviewed = plan({
        fileErrors: [{ fileName: "x.csv", message: "archivo malo" }],
        blockers: ["archivo malo", "Faltan privilegios sobre t: DELETE.", "No hay ningún archivo válido para cargar."],
      });

      // Act & Assert
      expect(listOtherBlockers(reviewed)).toEqual(["Faltan privilegios sobre t: DELETE.", "No hay ningún archivo válido para cargar."]);
    });

    it("should return an empty list when every blocker is a file error or there are none", () => {
      // Arrange, Act & Assert
      expect(listOtherBlockers(plan())).toEqual([]);
      expect(
        listOtherBlockers(plan({ fileErrors: [{ fileName: "x", message: "m" }], blockers: ["m"] }))
      ).toEqual([]);
    });
  });

  describe("listIncompleteMessages", () => {
    it("should list the message of every cut that lost rows and skip the complete ones", () => {
      // Arrange
      const result: LoadResult = {
        cuts: [loadedCut("corte 2026-08-01 incompleto: 1 de 2 filas, 1 rechazadas"), loadedCut(null), loadedCut("corte 2026-09-01 incompleto: 2 de 3 filas, 1 rechazadas")],
        totalInserted: 3,
        totalReplaced: 0,
        hasIncompleteCut: true,
        rejectedRows: [],
      };

      // Act & Assert
      expect(listIncompleteMessages(result)).toEqual([
        "corte 2026-08-01 incompleto: 1 de 2 filas, 1 rechazadas",
        "corte 2026-09-01 incompleto: 2 de 3 filas, 1 rechazadas",
      ]);
    });

    it("should return an empty list when no cut is incomplete", () => {
      // Arrange
      const result: LoadResult = { cuts: [loadedCut(null)], totalInserted: 1, totalReplaced: 0, hasIncompleteCut: false, rejectedRows: [] };

      // Act & Assert
      expect(listIncompleteMessages(result)).toEqual([]);
    });
  });
});
