import { describe, expect, it } from "vitest";
import {
  assertLoadable,
  buildPlan,
  describeIncompleteCut,
  listLoadBlockers,
  LoadRefusedError,
  PlanMessage,
  rejectRepeatedDates,
  splitOutcomes,
  type HistoryState,
} from "@/modules/coverage-loads/indicators/domain/plan";
import { buildLoadResult } from "@/modules/coverage-loads/indicators/domain/loadResult";
import { ParseKind } from "@/modules/coverage-loads/indicators/types";
import type { FileError, LoadedCut, ParseOutcome, ParsedCut } from "@/modules/coverage-loads/indicators/types";
import { makeCut, makeRejected, makeRows } from "./csvBuilders";

const NO_HISTORY: HistoryState = { existingRowsByDate: {}, shortfalls: [] };

function historyWith(existing: Record<string, number>): HistoryState {
  return { existingRowsByDate: existing, shortfalls: [] };
}

function cutOutcome(cut: ParsedCut): ParseOutcome {
  return { kind: ParseKind.CUT, cut };
}

function errorOutcome(fileName: string, message = "mal"): ParseOutcome {
  return { kind: ParseKind.ERROR, error: { fileName, message } };
}

describe("plan (AC-6..9)", () => {
  describe("describeIncompleteCut (AC-7)", () => {
    it("should return the exact Spanish message when 3 of 615 rows were rejected", () => {
      // Arrange
      const cut = makeCut("2026-09-01", makeRows(612), makeRejected("f.csv", 3));

      // Act
      const message = describeIncompleteCut(cut);

      // Assert
      expect(message).toBe("corte 2026-09-01 incompleto: 612 de 615 filas, 3 rechazadas");
    });

    it("should return null when no row was rejected", () => {
      // Arrange
      const cut = makeCut("2026-09-01", makeRows(5));

      // Act & Assert
      expect(describeIncompleteCut(cut)).toBeNull();
    });
  });

  describe("buildPlan per-cut flags", () => {
    it("should flag a cut incomplete and carry the message, totals and rejected rows", () => {
      // Arrange
      const rejected = makeRejected("f.csv", 3);
      const cut = makeCut("2026-09-01", makeRows(612), rejected);

      // Act
      const plan = buildPlan([cut], [], historyWith({ "2026-09-01": 0 }));

      // Assert
      expect(plan.cuts[0]).toMatchObject({
        fileName: "IndicadoresLTE_20260901.csv",
        fechaact: "2026-09-01",
        totalRows: 615,
        validRows: 612,
        rejectedRows: rejected,
        incomplete: true,
        incompleteMessage: "corte 2026-09-01 incompleto: 612 de 615 filas, 3 rechazadas",
      });
      expect(plan.hasIncompleteCut).toBe(true);
    });

    it("should not flag a cut incomplete when nothing was rejected", () => {
      // Arrange
      const cut = makeCut("2026-09-01", makeRows(10));

      // Act
      const plan = buildPlan([cut], [], NO_HISTORY);

      // Assert
      expect(plan.cuts[0].incomplete).toBe(false);
      expect(plan.cuts[0].incompleteMessage).toBeNull();
      expect(plan.hasIncompleteCut).toBe(false);
    });

    it.each([
      ["fewer valid rows than stored", 612, 615, true],
      ["one fewer valid row than stored", 614, 615, true],
      ["as many valid rows as stored", 615, 615, false],
      ["more valid rows than stored", 616, 615, false],
      ["nothing stored", 10, 0, false],
    ])("should compute the shrink flag correctly with %s", (_label, valid, existing, shrinks) => {
      // Arrange
      const cut = makeCut("2026-09-01", makeRows(valid));

      // Act
      const plan = buildPlan([cut], [], historyWith({ "2026-09-01": existing }));

      // Assert
      expect(plan.cuts[0].shrinks).toBe(shrinks);
      expect(plan.cuts[0].existingRows).toBe(existing);
      expect(plan.requiresAcceptShrink).toBe(shrinks);
      expect(plan.cuts[0].shrinkMessage).toBe(
        shrinks ? `corte 2026-09-01: el historial tiene ${existing} filas y quedarían ${valid}; el corte se reduce` : null
      );
    });

    it("should compare valid rows, not total rows, with the stored rows", () => {
      // Arrange: 612 valid + 3 rejected = 615 total, 615 stored
      const cut = makeCut("2026-09-01", makeRows(612), makeRejected("f.csv", 3));

      // Act
      const plan = buildPlan([cut], [], historyWith({ "2026-09-01": 615 }));

      // Assert
      expect(plan.cuts[0].shrinks).toBe(true);
    });

    it("should describe what will be replaced when rows exist", () => {
      // Arrange
      const cut = makeCut("2026-09-01", makeRows(615));

      // Act
      const plan = buildPlan([cut], [], historyWith({ "2026-09-01": 615 }));

      // Assert
      expect(plan.cuts[0].replaceMessage).toBe("corte 2026-09-01: 615 filas existentes serán reemplazadas por 615 nuevas");
    });

    it("should describe a brand-new cut when no row exists", () => {
      // Arrange
      const cut = makeCut("2026-09-01", makeRows(7));

      // Act
      const plan = buildPlan([cut], [], NO_HISTORY);

      // Assert
      expect(plan.cuts[0].replaceMessage).toBe("corte 2026-09-01: 7 filas nuevas; no hay filas existentes para esa fecha");
    });
  });

  describe("several files in one run (AC-9)", () => {
    it("should plan each file as its own cut with its own existing rows and flags", () => {
      // Arrange
      const august = makeCut("2026-08-01", makeRows(10));
      const september = makeCut("2026-09-01", makeRows(5), makeRejected("f.csv", 1));

      // Act
      const plan = buildPlan([august, september], [], historyWith({ "2026-08-01": 10, "2026-09-01": 8 }));

      // Assert
      expect(plan.cuts.map((cut) => [cut.fechaact, cut.existingRows, cut.shrinks, cut.incomplete])).toEqual([
        ["2026-08-01", 10, false, false],
        ["2026-09-01", 8, true, true],
      ]);
      expect(plan.canLoad).toBe(true);
      expect(plan.requiresAcceptShrink).toBe(true);
      expect(plan.hasIncompleteCut).toBe(true);
    });
  });

  describe("blockers and canLoad (AC-6, AC-14)", () => {
    it("should allow the load when there are cuts and nothing blocks", () => {
      // Arrange & Act
      const plan = buildPlan([makeCut("2026-09-01", makeRows(2))], [], NO_HISTORY);

      // Assert
      expect(plan.canLoad).toBe(true);
      expect(plan.blockers).toEqual([]);
    });

    it("should block the load and list the message of every file error", () => {
      // Arrange
      const fileErrors: FileError[] = [
        { fileName: "a.csv", message: "primero" },
        { fileName: "b.csv", message: "segundo" },
      ];

      // Act
      const plan = buildPlan([makeCut("2026-09-01", makeRows(2))], fileErrors, NO_HISTORY);

      // Assert
      expect(plan.canLoad).toBe(false);
      expect(plan.blockers).toEqual(["primero", "segundo"]);
      expect(plan.fileErrors).toEqual(fileErrors);
    });

    it("should say there is nothing to load when there are no cuts and no file errors", () => {
      // Arrange & Act
      const plan = buildPlan([], [], NO_HISTORY);

      // Assert
      expect(plan.canLoad).toBe(false);
      expect(plan.blockers).toEqual(["No hay ningún archivo válido para cargar."]);
    });

    it("should not add the nothing-to-load blocker when file errors already explain the empty plan", () => {
      // Arrange & Act
      const plan = buildPlan([], [{ fileName: "a.csv", message: "mal" }], NO_HISTORY);

      // Assert
      expect(plan.blockers).toEqual(["mal"]);
    });

    it("should block the load and explain a missing table", () => {
      // Arrange
      const history: HistoryState = {
        existingRowsByDate: {},
        shortfalls: [{ table: "public.indicadores_lte", tableExists: false, missing: [] }],
      };

      // Act
      const plan = buildPlan([makeCut("2026-09-01", makeRows(2))], [], history);

      // Assert
      expect(plan.canLoad).toBe(false);
      expect(plan.privilegeShortfalls).toEqual([
        {
          table: "public.indicadores_lte",
          tableExists: false,
          missing: [],
          message: "La tabla public.indicadores_lte no existe en esta base de datos.",
        },
      ]);
      expect(plan.blockers).toEqual(["La tabla public.indicadores_lte no existe en esta base de datos."]);
    });

    it("should append the DBA hint when DELETE is missing on the history table", () => {
      // Arrange
      const history: HistoryState = {
        existingRowsByDate: {},
        shortfalls: [{ table: "historico.h_cobertura_lte_localidad", tableExists: true, missing: ["INSERT", "DELETE"] }],
      };

      // Act
      const plan = buildPlan([makeCut("2026-09-01", makeRows(2))], [], history);

      // Assert
      expect(plan.privilegeShortfalls[0].message).toBe(
        `Faltan privilegios sobre historico.h_cobertura_lte_localidad: INSERT, DELETE. ${PlanMessage.deleteHint()}`
      );
    });

    it("should not append the DBA hint when only other privileges are missing, or for the staging table", () => {
      // Arrange
      const history: HistoryState = {
        existingRowsByDate: {},
        shortfalls: [
          { table: "historico.h_cobertura_lte_localidad", tableExists: true, missing: ["SELECT"] },
          { table: "public.indicadores_lte", tableExists: true, missing: ["INSERT", "DELETE"] },
        ],
      };

      // Act
      const plan = buildPlan([makeCut("2026-09-01", makeRows(2))], [], history);

      // Assert
      expect(plan.privilegeShortfalls.map((item) => item.message)).toEqual([
        "Faltan privilegios sobre historico.h_cobertura_lte_localidad: SELECT.",
        "Faltan privilegios sobre public.indicadores_lte: INSERT, DELETE.",
      ]);
    });
  });

  describe("shrink guard (AC-8)", () => {
    const shrinkingPlan = () =>
      buildPlan([makeCut("2026-09-01", makeRows(612), makeRejected("f.csv", 3))], [], historyWith({ "2026-09-01": 615 }));

    it("should list the accept-shrink blocker when the plan shrinks and the box is not ticked", () => {
      // Arrange & Act
      const blockers = listLoadBlockers(shrinkingPlan(), false);

      // Assert
      expect(blockers).toEqual([PlanMessage.needsAcceptShrink()]);
    });

    it("should list no blocker when the plan shrinks and the reduction is accepted", () => {
      // Arrange & Act & Assert
      expect(listLoadBlockers(shrinkingPlan(), true)).toEqual([]);
    });

    it("should keep the plan blockers whether or not the reduction is accepted", () => {
      // Arrange
      const plan = buildPlan([], [{ fileName: "a.csv", message: "mal" }], NO_HISTORY);

      // Act & Assert
      expect(listLoadBlockers(plan, false)).toEqual(["mal"]);
      expect(listLoadBlockers(plan, true)).toEqual(["mal"]);
    });

    it("should not require acceptance for a plan that does not shrink", () => {
      // Arrange
      const plan = buildPlan([makeCut("2026-09-01", makeRows(5))], [], historyWith({ "2026-09-01": 5 }));

      // Act & Assert
      expect(listLoadBlockers(plan, false)).toEqual([]);
    });

    it("should throw LoadRefusedError carrying the plan when the shrink is not accepted", () => {
      // Arrange
      const plan = shrinkingPlan();

      // Act
      const attempt = () => assertLoadable(plan, false);

      // Assert
      expect(attempt).toThrow(LoadRefusedError);
      try {
        attempt();
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as LoadRefusedError).plan).toBe(plan);
        expect((error as LoadRefusedError).name).toBe("LoadRefusedError");
        expect((error as LoadRefusedError).message).toBe(PlanMessage.needsAcceptShrink());
      }
    });

    it("should not throw when the shrink is accepted", () => {
      // Arrange & Act & Assert
      expect(() => assertLoadable(shrinkingPlan(), true)).not.toThrow();
    });

    it("should join every blocker into the refusal message", () => {
      // Arrange
      const plan = buildPlan(
        [makeCut("2026-09-01", makeRows(1))],
        [{ fileName: "a.csv", message: "uno" }],
        historyWith({ "2026-09-01": 5 })
      );

      // Act & Assert
      expect(() => assertLoadable(plan, false)).toThrow(`uno ${PlanMessage.needsAcceptShrink()}`);
    });
  });

  describe("rejectRepeatedDates (AC-6)", () => {
    it("should reject both files when two files carry the same date", () => {
      // Arrange
      const first = makeCut("2026-09-01", makeRows(2), [], "IndicadoresLTE_20260901.csv");
      const second = makeCut("2026-09-01", makeRows(3), [], "copia_IndicadoresLTE_20260901.csv");

      // Act
      const outcomes = rejectRepeatedDates([cutOutcome(first), cutOutcome(second)]);

      // Assert
      expect(outcomes.map((outcome) => outcome.kind)).toEqual([ParseKind.ERROR, ParseKind.ERROR]);
      const messages = outcomes.map((outcome) => (outcome.kind === ParseKind.ERROR ? outcome.error.message : ""));
      expect(messages[0]).toBe(
        'Los archivos "IndicadoresLTE_20260901.csv" y "copia_IndicadoresLTE_20260901.csv" corresponden al mismo corte 2026-09-01; se rechazan todos.'
      );
      expect(messages[1]).toBe(messages[0]);
      const names = outcomes.map((outcome) => (outcome.kind === ParseKind.ERROR ? outcome.error.fileName : ""));
      expect(names).toEqual([first.fileName, second.fileName]);
    });

    it("should leave files with different dates untouched", () => {
      // Arrange
      const august = cutOutcome(makeCut("2026-08-01", makeRows(2)));
      const september = cutOutcome(makeCut("2026-09-01", makeRows(2)));

      // Act
      const outcomes = rejectRepeatedDates([august, september]);

      // Assert
      expect(outcomes).toEqual([august, september]);
    });

    it("should reject only the files of the repeated date among several", () => {
      // Arrange
      const dupA = makeCut("2026-09-01", makeRows(2), [], "a.csv");
      const dupB = makeCut("2026-09-01", makeRows(2), [], "b.csv");
      const other = makeCut("2026-08-01", makeRows(2), [], "c.csv");

      // Act
      const outcomes = rejectRepeatedDates([cutOutcome(dupA), cutOutcome(other), cutOutcome(dupB)]);

      // Assert
      expect(outcomes.map((outcome) => outcome.kind)).toEqual([ParseKind.ERROR, ParseKind.CUT, ParseKind.ERROR]);
    });

    it("should name every file when three share a date", () => {
      // Arrange
      const cuts = ["a.csv", "b.csv", "c.csv"].map((name) => cutOutcome(makeCut("2026-09-01", makeRows(1), [], name)));

      // Act
      const [first] = rejectRepeatedDates(cuts);

      // Assert
      expect(first.kind === ParseKind.ERROR && first.error.message).toContain('"a.csv" y "b.csv" y "c.csv"');
    });

    it("should pass existing file errors through and not count them as a date", () => {
      // Arrange
      const failed = errorOutcome("bad.csv");
      const cut = cutOutcome(makeCut("2026-09-01", makeRows(1)));

      // Act
      const outcomes = rejectRepeatedDates([failed, cut]);

      // Assert
      expect(outcomes).toEqual([failed, cut]);
    });

    it("should return an empty list for no outcomes", () => {
      // Arrange, Act & Assert
      expect(rejectRepeatedDates([])).toEqual([]);
    });
  });

  describe("splitOutcomes", () => {
    it("should separate cuts from file errors keeping the upload order", () => {
      // Arrange
      const first = makeCut("2026-08-01", makeRows(1));
      const second = makeCut("2026-09-01", makeRows(1));

      // Act
      const { cuts, fileErrors } = splitOutcomes([
        cutOutcome(first),
        errorOutcome("x.csv", "uno"),
        cutOutcome(second),
        errorOutcome("y.csv", "dos"),
      ]);

      // Assert
      expect(cuts).toEqual([first, second]);
      expect(fileErrors).toEqual([
        { fileName: "x.csv", message: "uno" },
        { fileName: "y.csv", message: "dos" },
      ]);
    });
  });
});

describe("buildLoadResult", () => {
  it("should total the inserted and replaced rows and join the rejected rows in upload order", () => {
    // Arrange
    const first = makeCut("2026-08-01", makeRows(3), makeRejected("a.csv", 1), "a.csv");
    const second = makeCut("2026-09-01", makeRows(4), makeRejected("b.csv", 2), "b.csv");
    const loaded: LoadedCut[] = [
      {
        fileName: "a.csv",
        fechaact: "2026-08-01",
        replacedRows: 2,
        insertedRows: 3,
        storedRows: 3,
        rejectedRows: 1,
        incomplete: true,
        incompleteMessage: "x",
      },
      {
        fileName: "b.csv",
        fechaact: "2026-09-01",
        replacedRows: 0,
        insertedRows: 4,
        storedRows: 4,
        rejectedRows: 2,
        incomplete: false,
        incompleteMessage: null,
      },
    ];

    // Act
    const result = buildLoadResult([first, second], loaded);

    // Assert
    expect(result.totalInserted).toBe(7);
    expect(result.totalReplaced).toBe(2);
    expect(result.hasIncompleteCut).toBe(true);
    expect(result.rejectedRows.map((row) => row.file)).toEqual(["a.csv", "b.csv", "b.csv"]);
    expect(result.cuts).toBe(loaded);
  });

  it("should report no incomplete cut and zero totals for an empty run", () => {
    // Arrange, Act
    const result = buildLoadResult([], []);

    // Assert
    expect(result).toEqual({ cuts: [], totalInserted: 0, totalReplaced: 0, hasIncompleteCut: false, rejectedRows: [] });
  });
});
