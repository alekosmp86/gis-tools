import { describe, expect, it } from "vitest";
import {
  AvanceFileKind,
  ELIMINATED_STATUS,
  EXCLUDED_DISTRICT_STATUSES,
  STAGING_UDPEM,
  ZONES,
} from "@/modules/coverage-loads/avance-ftth/constants";
import {
  arrangeOutcomes,
  assertLoadable,
  buildPlan,
  HISTORY_SKIPPED_REASON,
  LoadRefusedError,
} from "@/modules/coverage-loads/avance-ftth/domain/plan";
import { buildFileError } from "@/modules/coverage-loads/avance-ftth/domain/csvAvance";
import { ParseKind } from "@/modules/coverage-loads/avance-ftth/types";
import type { AvanceDbState, ParseOutcome } from "@/modules/coverage-loads/avance-ftth/types";
import { makeParsedFile, makeRow } from "./avanceHarness";

function healthyState(overrides: Partial<AvanceDbState> = {}): AvanceDbState {
  return {
    staging: {
      [AvanceFileKind.INT]: { rows: 0, fechaact: null },
      [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
    },
    avance: { rows: 0, oldestLoad: null, newestLoad: null, loadedToday: false },
    historyRows: 0,
    zoneRows: 7587,
    zoneStatuses: [{ status: "Existente", count: 7000 }],
    avanceByStatus: [],
    shortfalls: [],
    ...overrides,
  };
}

const interior = (rowCount = 5, overrides = {}) =>
  makeParsedFile(AvanceFileKind.INT, Array.from({ length: rowCount }, () => makeRow()), overrides);
const montevideo = (rowCount = 5, overrides = {}) =>
  makeParsedFile(AvanceFileKind.UDPEM, Array.from({ length: rowCount }, () => makeRow()), overrides);

function fileOutcome(file: ReturnType<typeof interior>): ParseOutcome {
  return { kind: ParseKind.FILE, file };
}

describe("avance-ftth plan (AC-7 .. AC-10)", () => {
  describe("arrangeOutcomes (AC-1, AC-9)", () => {
    it("should accept exactly one file of each kind in the fixed order INT then UDPEM", () => {
      // Arrange
      const udpem = montevideo();
      const int = interior();

      // Act
      const { files, fileErrors } = arrangeOutcomes([fileOutcome(udpem), fileOutcome(int)]);

      // Assert
      expect(files.map((file) => file.kind)).toEqual([AvanceFileKind.INT, AvanceFileKind.UDPEM]);
      expect(fileErrors).toEqual([]);
    });

    it("should report a missing UDPEM file with the expected name format", () => {
      // Arrange & Act
      const { files, fileErrors } = arrangeOutcomes([fileOutcome(interior())]);

      // Assert
      expect(files).toHaveLength(1);
      expect(fileErrors).toEqual([
        { fileName: "", message: "Falta el archivo de Montevideo (UDPEM) (SituacionFTTH_UDPEM_ddmmaaaa.csv)." },
      ]);
    });

    it("should report a missing INT file when only UDPEM arrives", () => {
      // Arrange & Act
      const { fileErrors } = arrangeOutcomes([fileOutcome(montevideo())]);

      // Assert
      expect(fileErrors[0].message).toBe("Falta el archivo de Interior (SituacionFTTH_INT_ddmmaaaa.csv).");
    });

    it("should refuse both files of a duplicated kind and keep none of them", () => {
      // Arrange
      const first = interior(1, { fileName: "SituacionFTTH_INT_01012026.csv", fechaact: "01012026" });
      const second = interior(1, { fileName: "SituacionFTTH_INT_02012026.csv", fechaact: "02012026" });

      // Act
      const { files, fileErrors } = arrangeOutcomes([fileOutcome(first), fileOutcome(second), fileOutcome(montevideo())]);

      // Assert
      expect(files.map((file) => file.kind)).toEqual([AvanceFileKind.UDPEM]);
      expect(fileErrors.map((error) => error.fileName)).toEqual(["SituacionFTTH_INT_01012026.csv", "SituacionFTTH_INT_02012026.csv"]);
      expect(fileErrors[0].message).toContain("Se subieron 2 archivos de Interior");
    });

    it("should carry a misnamed file as an error and still ask for the missing kind", () => {
      // Arrange
      const misnamed = buildFileError("malo.csv", "nombre inválido");

      // Act
      const { files, fileErrors } = arrangeOutcomes([misnamed, fileOutcome(montevideo())]);

      // Assert
      expect(files).toHaveLength(1);
      expect(fileErrors.map((error) => error.message)).toEqual([
        "nombre inválido",
        "Falta el archivo de Interior (SituacionFTTH_INT_ddmmaaaa.csv).",
      ]);
    });
  });

  describe("a clean plan", () => {
    it("should report both files, the database state and allow the load with no blockers or warnings", () => {
      // Arrange
      const files = [interior(5, { rejectedTotal: 0 }), montevideo(3)];

      // Act
      const plan = buildPlan(files, [], healthyState());

      // Assert
      expect(plan.canLoad).toBe(true);
      expect(plan.blockers).toEqual([]);
      expect(plan.warnings).toEqual([]);
      expect(plan.files.map((file) => [file.kind, file.rowsRead, file.validRows])).toEqual([
        [AvanceFileKind.INT, 5, 5],
        [AvanceFileKind.UDPEM, 3, 3],
      ]);
      expect(plan.zoneRows).toBe(7587);
      expect(plan.excludedStatuses).toEqual([...EXCLUDED_DISTRICT_STATUSES]);
      expect(plan.historyWillBeSkipped).toBe(false);
    });

    it("should carry the per-file figures of the parse into the plan", () => {
      // Arrange
      const rejected = [{ file: "x", line: 3, text: "t", reason: "r" }];
      const file = interior(4, { rowsRead: 9, rejected, rejectedTotal: 5, junkRows: 0, emptyEdificioRows: 2, duplicateKeys: 1 });

      // Act
      const plan = buildPlan([file, montevideo()], [], healthyState());

      // Assert
      expect(plan.files[0]).toMatchObject({
        fileName: "SituacionFTTH_INT_21092026.csv",
        fechaact: "21092026",
        rowsRead: 9,
        validRows: 4,
        rejectedRows: rejected,
        rejectedTotal: 5,
        emptyEdificioRows: 2,
        duplicateKeys: 1,
      });
    });
  });

  describe("blockers (AC-9)", () => {
    it("should block on a file-level error and keep its message", () => {
      // Arrange
      const errors = [{ fileName: "malo.csv", message: "nombre inválido" }];

      // Act
      const plan = buildPlan([montevideo()], errors, healthyState());

      // Assert
      expect(plan.canLoad).toBe(false);
      expect(plan.blockers).toContain("nombre inválido");
      expect(plan.fileErrors).toEqual(errors);
    });

    it.each([
      ["INT", () => [interior(0, { rejectedTotal: 7 }), montevideo()], 'El archivo "SituacionFTTH_INT_21092026.csv" no tiene ninguna fila válida (7 rechazadas).'],
      ["UDPEM", () => [interior(), montevideo(0, { rejectedTotal: 2 })], 'El archivo "SituacionFTTH_UDPEM_21092026.csv" no tiene ninguna fila válida (2 rechazadas).'],
    ])("should block when the %s file has zero valid rows", (_label, buildFiles, message) => {
      // Arrange & Act
      const plan = buildPlan(buildFiles(), [], healthyState());

      // Assert
      expect(plan.canLoad).toBe(false);
      expect(plan.blockers).toEqual([message]);
    });

    it("should not block a file with a single valid row", () => {
      // Arrange & Act
      const plan = buildPlan([interior(1), montevideo(1)], [], healthyState());

      // Assert
      expect(plan.canLoad).toBe(true);
    });

    it("should block on a privilege shortfall with the shared message", () => {
      // Arrange
      const state = healthyState({ shortfalls: [{ table: STAGING_UDPEM, tableExists: true, missing: ["TRUNCATE", "DELETE"] }] });

      // Act
      const plan = buildPlan([interior(), montevideo()], [], state);

      // Assert
      expect(plan.canLoad).toBe(false);
      expect(plan.blockers).toEqual([`Faltan privilegios sobre ${STAGING_UDPEM}: TRUNCATE, DELETE.`]);
      expect(plan.privilegeShortfalls).toEqual([
        { table: STAGING_UDPEM, tableExists: true, missing: ["TRUNCATE", "DELETE"], message: plan.blockers[0] },
      ]);
    });

    it("should block on a missing table", () => {
      // Arrange
      const state = healthyState({ shortfalls: [{ table: "historico.h_avance_uruguay", tableExists: false, missing: [] }] });

      // Act
      const plan = buildPlan([interior(), montevideo()], [], state);

      // Assert
      expect(plan.blockers).toEqual(["La tabla historico.h_avance_uruguay no existe en esta base de datos."]);
      expect(plan.canLoad).toBe(false);
    });

    it("should block when the zones layer is empty", () => {
      // Arrange & Act
      const plan = buildPlan([interior(), montevideo()], [], healthyState({ zoneRows: 0, zoneStatuses: [] }));

      // Assert
      expect(plan.canLoad).toBe(false);
      expect(plan.blockers).toEqual([`La capa de zonas ${ZONES} está vacía: no hay con qué cruzar las planillas.`]);
    });

    it("should explain an unreadable zones layer by its privilege shortfall only, not as an empty layer", () => {
      // Arrange
      const state = healthyState({ zoneRows: 0, shortfalls: [{ table: ZONES, tableExists: true, missing: ["SELECT"] }] });

      // Act
      const plan = buildPlan([interior(), montevideo()], [], state);

      // Assert
      expect(plan.blockers).toEqual([`Faltan privilegios sobre ${ZONES}: SELECT.`]);
    });

    it("should list every blocker when several apply", () => {
      // Arrange
      const state = healthyState({ zoneRows: 0 });

      // Act
      const plan = buildPlan([interior(0)], [{ fileName: "", message: "Falta el archivo" }], state);

      // Assert
      expect(plan.blockers).toHaveLength(3);
      expect(plan.canLoad).toBe(false);
    });
  });

  describe("warnings (AC-10) never block", () => {
    it("should warn when the two file dates differ", () => {
      // Arrange
      const files = [interior(5, { fechaact: "21092026" }), montevideo(5, { fechaact: "22092026" })];

      // Act
      const plan = buildPlan(files, [], healthyState());

      // Assert
      expect(plan.canLoad).toBe(true);
      expect(plan.warnings).toEqual([
        "Los archivos tienen fechas distintas: SituacionFTTH_INT_21092026.csv (21092026) y SituacionFTTH_UDPEM_22092026.csv (22092026).",
      ]);
    });

    it("should not warn about dates when they are equal", () => {
      // Arrange & Act
      const plan = buildPlan([interior(), montevideo()], [], healthyState());

      // Assert
      expect(plan.warnings).toEqual([]);
    });

    it("should warn when the staging table already holds the incoming fechaact", () => {
      // Arrange
      const state = healthyState({
        staging: {
          [AvanceFileKind.INT]: { rows: 3, fechaact: "21092026" },
          [AvanceFileKind.UDPEM]: { rows: 0, fechaact: "21092026" },
        },
      });

      // Act
      const plan = buildPlan([interior(), montevideo()], [], state);

      // Assert
      expect(plan.warnings).toEqual(["La tabla de planillas de Interior ya tiene cargada la fecha 21092026; se reemplazará."]);
    });

    it("should not warn about an already loaded date when the staging table holds another date", () => {
      // Arrange
      const state = healthyState({
        staging: {
          [AvanceFileKind.INT]: { rows: 3, fechaact: "20092026" },
          [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
        },
      });

      // Act
      const plan = buildPlan([interior(), montevideo()], [], state);

      // Assert
      expect(plan.warnings).toEqual([]);
    });

    it("should warn with both numbers when fewer rows would remain than the staging table holds, counting without junk", () => {
      // Arrange
      const rows = [makeRow(), makeRow(), makeRow({ conca: "CZONA" })];
      const file = makeParsedFile(AvanceFileKind.INT, rows);
      const state = healthyState({
        staging: {
          [AvanceFileKind.INT]: { rows: 3, fechaact: "01012026" },
          [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
        },
      });

      // Act
      const plan = buildPlan([file, montevideo()], [], state);

      // Assert
      expect(plan.warnings).toEqual(["Interior: quedarían 2 filas en la planilla (sin la basura CZONA) y hoy hay 3."]);
    });

    it.each([
      ["exactly equal", 5, 5],
      ["more", 5, 8],
    ])("should not warn about shrinking when the incoming rows are %s than the current ones", (_label, current, incoming) => {
      // Arrange
      const state = healthyState({
        staging: {
          [AvanceFileKind.INT]: { rows: current, fechaact: "01012026" },
          [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
        },
      });

      // Act
      const plan = buildPlan([interior(incoming), montevideo()], [], state);

      // Assert
      expect(plan.warnings).toEqual([]);
    });

    it("should warn when the incoming rows are exactly one fewer than the current ones", () => {
      // Arrange
      const state = healthyState({
        staging: {
          [AvanceFileKind.INT]: { rows: 6, fechaact: "01012026" },
          [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
        },
      });

      // Act
      const plan = buildPlan([interior(5), montevideo()], [], state);

      // Assert
      expect(plan.warnings).toHaveLength(1);
      expect(plan.warnings[0]).toContain("quedarían 5 filas");
    });

    it("should warn about rejected rows, empty or #N/A edificio and duplicate keys, naming the file and the totals", () => {
      // Arrange
      const file = interior(5, { rejectedTotal: 4, emptyEdificioRows: 7, duplicateKeys: 2 });

      // Act
      const plan = buildPlan([file, montevideo()], [], healthyState());

      // Assert
      expect(plan.warnings).toEqual([
        "SituacionFTTH_INT_21092026.csv: 4 filas rechazadas, no se cargan.",
        "SituacionFTTH_INT_21092026.csv: 7 filas con edificio vacío o #N/A; se cargan igual que en el job anterior.",
        "SituacionFTTH_INT_21092026.csv: 2 claves (edificio, cable, zona) repetidas; el reporte de duplicados las lista.",
      ]);
    });

    it("should warn how many current Avance rows come from eliminated zones and say they are included under parity", () => {
      // Arrange
      const state = healthyState({
        avanceByStatus: [
          { status: "Existente", count: 7000 },
          { status: ELIMINATED_STATUS, count: 90 },
        ],
      });

      // Act
      const plan = buildPlan([interior(), montevideo()], [], state);

      // Assert
      expect(plan.canLoad).toBe(true);
      expect(plan.warnings).toEqual([
        "90 filas del Avance actual provienen de zonas Proyectado/Eliminacion y se incluyen, igual que el job anterior.",
      ]);
      expect(plan.avanceByStatus).toEqual(state.avanceByStatus);
    });

    it("should not warn about eliminated zones when none of the current rows joins one", () => {
      // Arrange
      const state = healthyState({ avanceByStatus: [{ status: "Existente", count: 10 }] });

      // Act
      const plan = buildPlan([interior(), montevideo()], [], state);

      // Assert
      expect(plan.warnings).toEqual([]);
    });

    it("should warn that the history copy is skipped when the current Avance was loaded today", () => {
      // Arrange
      const state = healthyState({ avance: { rows: 10, oldestLoad: "2026-10-20", newestLoad: "2026-10-20", loadedToday: true } });

      // Act
      const plan = buildPlan([interior(), montevideo()], [], state);

      // Assert
      expect(plan.historyWillBeSkipped).toBe(true);
      expect(plan.warnings).toEqual(["El Avance actual ya fue cargado hoy: no se copia al historial (historial omitido)."]);
      expect(HISTORY_SKIPPED_REASON).toBe("historial omitido: el Avance actual ya fue cargado hoy");
    });

    it("should keep the warning order: dates, shrink, content, current Avance", () => {
      // Arrange
      const state = healthyState({
        staging: {
          [AvanceFileKind.INT]: { rows: 9, fechaact: "21092026" },
          [AvanceFileKind.UDPEM]: { rows: 0, fechaact: null },
        },
        avance: { rows: 1, oldestLoad: "2026-10-20", newestLoad: "2026-10-20", loadedToday: true },
        avanceByStatus: [{ status: ELIMINATED_STATUS, count: 1 }],
      });
      const files = [interior(5, { rejectedTotal: 1 }), montevideo(5, { fechaact: "22092026" })];

      // Act
      const plan = buildPlan(files, [], state);

      // Assert
      expect(plan.warnings).toEqual([
        "Los archivos tienen fechas distintas: SituacionFTTH_INT_21092026.csv (21092026) y SituacionFTTH_UDPEM_22092026.csv (22092026).",
        "La tabla de planillas de Interior ya tiene cargada la fecha 21092026; se reemplazará.",
        "Interior: quedarían 5 filas en la planilla (sin la basura CZONA) y hoy hay 9.",
        "SituacionFTTH_INT_21092026.csv: 1 filas rechazadas, no se cargan.",
        "1 filas del Avance actual provienen de zonas Proyectado/Eliminacion y se incluyen, igual que el job anterior.",
        "El Avance actual ya fue cargado hoy: no se copia al historial (historial omitido).",
      ]);
    });
  });

  describe("assertLoadable", () => {
    it("should throw a LoadRefusedError that carries the plan when there are blockers", () => {
      // Arrange
      const plan = buildPlan([interior(0)], [], healthyState());

      // Act
      const attempt = () => assertLoadable(plan);

      // Assert
      expect(attempt).toThrow(LoadRefusedError);
      try {
        attempt();
      } catch (error) {
        expect((error as LoadRefusedError).plan).toBe(plan);
        expect((error as LoadRefusedError).message).toBe(plan.blockers.join(" "));
      }
    });

    it("should do nothing when the plan can load", () => {
      // Arrange
      const plan = buildPlan([interior(), montevideo()], [], healthyState());

      // Act & Assert
      expect(() => assertLoadable(plan)).not.toThrow();
    });
  });
});
