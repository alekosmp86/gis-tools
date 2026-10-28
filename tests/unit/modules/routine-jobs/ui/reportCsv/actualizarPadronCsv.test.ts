import { describe, expect, it } from "vitest";
import { buildActualizarPadronCsv } from "@/modules/routine-jobs/ui/reportCsv/actualizarPadronCsv";
import type { ActualizarPadronResult } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { BOM, actualizarPadronResultOf, parseCsv } from "./reportCsvFixtures";

const HEADER = ["Cambio", "Cantidad"];
const WRITTEN_ROW = ["Filas escritas", "940"];

const FORBIDDEN_TEXTS = [
  "Informe",
  "Modo",
  "Etapa",
  "Generado",
  "Resultado incierto",
  "Simulación",
  "Filas leídas",
  "Filas omitidas",
  "Geometrías reparadas",
  "Localidad no encontrada",
  "DEPARTAMENTO 0",
  "LOC NO 0",
  "URBANO",
  "Advertencia de padrón",
  "Cargar tabla de trabajo",
  "Estadísticas",
  "timeout",
];

const rawCsvOf = (overrides: Partial<ActualizarPadronResult> = {}): string =>
  buildActualizarPadronCsv(actualizarPadronResultOf(overrides));

const rowsOf = (overrides: Partial<ActualizarPadronResult> = {}): string[][] => parseCsv(rawCsvOf(overrides));

describe("buildActualizarPadronCsv", () => {
  describe("envelope", () => {
    it("should start with the UTF-8 BOM", () => {
      expect(rawCsvOf().startsWith(BOM)).toBe(true);
    });

    it("should write the Cambio,Cantidad header as the first row", () => {
      expect(rowsOf()[0]).toEqual(HEADER);
    });

    it("should separate rows with CRLF and end the body without a bare line feed", () => {
      const body = rawCsvOf().slice(BOM.length).replace(/\r\n$/, "");

      expect(body.split("\r\n")).toEqual(["Cambio,Cantidad", "Filas escritas,940"]);
    });
  });

  describe("database changes only", () => {
    it("should write exactly the Filas escritas row after the header", () => {
      expect(rowsOf().slice(1)).toEqual([WRITTEN_ROW]);
    });

    it("should write no read, skipped, repaired, skip reason, group, sample, key, warning, timing or analyze rows", () => {
      const csv = rawCsvOf({ analyze: { status: "failed", message: "timeout" } });

      FORBIDDEN_TEXTS.forEach((text) => expect(csv).not.toContain(text));
    });

    it("should write the same row in a dry run", () => {
      expect(rowsOf({ dryRun: true })).toEqual(rowsOf({ dryRun: false }));
    });

    it("should write the same row when the outcome is unknown", () => {
      expect(rowsOf({ outcomeUnknown: true })).toEqual(rowsOf({ outcomeUnknown: false }));
    });
  });
});
