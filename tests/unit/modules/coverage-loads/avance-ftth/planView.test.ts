import { describe, expect, it } from "vitest";
import { AvanceFileKind, ELIMINATED_STATUS } from "@/modules/coverage-loads/avance-ftth/constants";
import { buildPlan } from "@/modules/coverage-loads/avance-ftth/domain/plan";
import {
  buildStatusRows,
  collectRejectedRows,
  groupRejectedByFile,
  labelStatus,
  listOtherBlockers,
  warningsHeadline,
} from "@/modules/coverage-loads/avance-ftth/domain/planView";
import type { AvanceDbState, AvancePlan, RejectedRow } from "@/modules/coverage-loads/avance-ftth/types";
import { makeParsedFile, makeRow } from "./avanceHarness";

const INT_NAME = "SituacionFTTH_INT_21092026.csv";
const UDPEM_NAME = "SituacionFTTH_UDPEM_21092026.csv";
const EXISTING = "Existente";
const INSTALLING = "Proyectado/Instalacion";
const NO_STATUS_LABEL = "(sin estado)";

const BASE_STATE: AvanceDbState = {
  staging: {
    [AvanceFileKind.INT]: { rows: 0, fechaact: null },
    [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
  },
  avance: { rows: 0, oldestLoad: null, newestLoad: null, loadedToday: false },
  historyRows: 0,
  zoneRows: 10,
  zoneStatuses: [],
  avanceByStatus: [],
  shortfalls: [],
};

function rejectedRow(file: string, line: number): RejectedRow {
  return { file, line, text: `fila ${line}`, reason: "motivo" };
}

function planWith(state: Partial<AvanceDbState> = {}): AvancePlan {
  const files = [
    makeParsedFile(AvanceFileKind.INT, [makeRow()]),
    makeParsedFile(AvanceFileKind.UDPEM, [makeRow()]),
  ];
  return buildPlan(files, [], { ...BASE_STATE, ...state });
}

describe("avance-ftth plan view helpers (AC-20b, AC-29)", () => {
  describe("labelStatus", () => {
    it("should label an empty status with the 'sin estado' text", () => {
      // Arrange & Act & Assert
      expect(labelStatus("")).toBe(NO_STATUS_LABEL);
    });

    it.each([EXISTING, INSTALLING, ELIMINATED_STATUS])("should return the known status %j unchanged", (status) => {
      // Arrange & Act & Assert
      expect(labelStatus(status)).toBe(status);
    });

    it("should not treat a whitespace-only or look-alike status as empty", () => {
      // Arrange & Act & Assert
      expect(labelStatus(" ")).toBe(" ");
      expect(labelStatus(NO_STATUS_LABEL)).toBe(NO_STATUS_LABEL);
    });
  });

  describe("warningsHeadline", () => {
    it("should return the singular text when there is exactly one warning", () => {
      // Arrange & Act & Assert
      expect(warningsHeadline(1)).toBe("1 advertencia");
    });

    it.each([
      [2, "2 advertencias"],
      [7, "7 advertencias"],
      [100, "100 advertencias"],
    ])("should return the plural text for %i warnings", (count, expected) => {
      // Arrange & Act & Assert
      expect(warningsHeadline(count)).toBe(expected);
    });

    it("should return an empty string when there are no warnings", () => {
      // Arrange & Act & Assert
      expect(warningsHeadline(0)).toBe("");
    });

    it.each([-1, -10, Number.NaN])("should return an empty string for the invalid count %s", (count) => {
      // Arrange & Act & Assert
      expect(warningsHeadline(count)).toBe("");
    });
  });

  describe("collectRejectedRows and groupRejectedByFile", () => {
    it("should flatten the listed rejected rows of every file in file order", () => {
      // Arrange
      const files = [
        makeParsedFile(AvanceFileKind.INT, [makeRow()], { rejected: [rejectedRow(INT_NAME, 2), rejectedRow(INT_NAME, 5)], rejectedTotal: 2 }),
        makeParsedFile(AvanceFileKind.UDPEM, [makeRow()], { rejected: [rejectedRow(UDPEM_NAME, 3)], rejectedTotal: 1 }),
      ];
      const plan = buildPlan(files, [], BASE_STATE);

      // Act
      const rows = collectRejectedRows(plan);

      // Assert
      expect(rows.map((row) => [row.file, row.line])).toEqual([[INT_NAME, 2], [INT_NAME, 5], [UDPEM_NAME, 3]]);
    });

    it("should return nothing when no file rejected a row", () => {
      // Arrange & Act & Assert
      expect(collectRejectedRows(planWith())).toEqual([]);
      expect(groupRejectedByFile([])).toEqual([]);
    });

    it("should group by file keeping the order in which the files first appear", () => {
      // Arrange
      const rows = [rejectedRow("b.csv", 2), rejectedRow("a.csv", 7), rejectedRow("b.csv", 9)];

      // Act
      const groups = groupRejectedByFile(rows);

      // Assert
      expect(groups.map((group) => group.file)).toEqual(["b.csv", "a.csv"]);
      expect(groups[0].rows.map((row) => row.line)).toEqual([2, 9]);
      expect(groups[1].rows.map((row) => row.line)).toEqual([7]);
    });
  });

  describe("listOtherBlockers", () => {
    it("should leave out the blockers already shown as file errors", () => {
      // Arrange
      const plan = buildPlan([], [{ fileName: "x.csv", message: "nombre inválido" }], { ...BASE_STATE, zoneRows: 0 });

      // Act
      const others = listOtherBlockers(plan);

      // Assert
      expect(plan.blockers).toContain("nombre inválido");
      expect(others).not.toContain("nombre inválido");
      expect(others.some((blocker) => blocker.includes("está vacía"))).toBe(true);
    });

    it("should be empty when there are no blockers", () => {
      // Arrange & Act & Assert
      expect(listOtherBlockers(planWith())).toEqual([]);
    });
  });

  describe("buildStatusRows (AC-20b)", () => {
    it("should list one row per status seen in the zones or in the current Avance, sorted by status", () => {
      // Arrange
      const plan = planWith({
        zoneStatuses: [
          { status: INSTALLING, count: 20 },
          { status: EXISTING, count: 100 },
        ],
        avanceByStatus: [
          { status: ELIMINATED_STATUS, count: 4 },
          { status: EXISTING, count: 60 },
        ],
      });

      // Act
      const rows = buildStatusRows(plan);

      // Assert
      expect(rows).toEqual([
        { status: EXISTING, zones: 100, currentAvanceRows: 60, isExcluded: false },
        { status: ELIMINATED_STATUS, zones: 0, currentAvanceRows: 4, isExcluded: false },
        { status: INSTALLING, zones: 20, currentAvanceRows: 0, isExcluded: false },
      ]);
    });

    it("should return no rows when neither the zones nor the Avance report a status", () => {
      // Arrange & Act & Assert
      expect(buildStatusRows(planWith())).toEqual([]);
    });

    it("should mark only the statuses the plan says are excluded", () => {
      // Arrange
      const plan: AvancePlan = {
        ...planWith({
          zoneStatuses: [
            { status: EXISTING, count: 5 },
            { status: ELIMINATED_STATUS, count: 2 },
          ],
        }),
        excludedStatuses: [ELIMINATED_STATUS],
      };

      // Act
      const rows = buildStatusRows(plan);

      // Assert
      expect(rows.find((row) => row.status === ELIMINATED_STATUS)?.isExcluded).toBe(true);
      expect(rows.find((row) => row.status === EXISTING)?.isExcluded).toBe(false);
    });

    it("should show the eliminated-zone rows as included, with the parity warning in the same plan (decision O1)", () => {
      // Arrange
      const plan = planWith({
        zoneStatuses: [
          { status: EXISTING, count: 100 },
          { status: ELIMINATED_STATUS, count: 30 },
        ],
        avanceByStatus: [
          { status: EXISTING, count: 7000 },
          { status: ELIMINATED_STATUS, count: 90 },
        ],
      });

      // Act
      const rows = buildStatusRows(plan);

      // Assert
      expect(plan.excludedStatuses).toEqual([]);
      expect(rows.find((row) => row.status === ELIMINATED_STATUS)).toEqual({
        status: ELIMINATED_STATUS,
        zones: 30,
        currentAvanceRows: 90,
        isExcluded: false,
      });
      expect(plan.warnings).toContain(
        `90 filas del Avance actual provienen de zonas ${ELIMINATED_STATUS} y se incluyen, igual que el job anterior.`
      );
    });

    it("should keep a status that is empty as its own row so labelStatus can name it", () => {
      // Arrange
      const plan = planWith({ zoneStatuses: [{ status: "", count: 3 }] });

      // Act
      const rows = buildStatusRows(plan);

      // Assert
      expect(rows).toEqual([{ status: "", zones: 3, currentAvanceRows: 0, isExcluded: false }]);
      expect(labelStatus(rows[0].status)).toBe(NO_STATUS_LABEL);
    });
  });
});
