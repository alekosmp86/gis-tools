import { describe, expect, it } from "vitest";
import { buildCargarPadronesCsv } from "@/modules/routine-jobs/ui/reportCsv/cargarPadronesCsv";
import type { CargarPadronesResult } from "@/modules/routine-jobs/jobs/cargar-padrones/types";
import { BOM, cargarPadronesResultOf, parseCsv } from "./reportCsvFixtures";

const HEADER = ["Cambio", "Cantidad"];
const RURAL_ROW = ["Padrones rurales insertados", "107"];
const URBANO_ROW = ["Padrones urbanos insertados", "207"];
const TOTAL_ROW = ["Total insertados", "304"];

const FORBIDDEN_TEXTS = [
  "Informe",
  "Modo",
  "Etapa",
  "Generado",
  "Resultado incierto",
  "Simulación",
  "Filas leídas",
  "Grupos",
  "Sin geometría",
  "Conflictos",
  "Advertencia",
  "Hay 2 filas sin clave",
  "Tiempos",
  "Leer rurales",
  "Estadísticas",
  "timeout",
  "C1",
];

const rawCsvOf = (overrides: Partial<CargarPadronesResult> = {}): string =>
  buildCargarPadronesCsv(cargarPadronesResultOf(overrides));

const rowsOf = (overrides: Partial<CargarPadronesResult> = {}): string[][] => parseCsv(rawCsvOf(overrides));

describe("buildCargarPadronesCsv", () => {
  describe("envelope", () => {
    it("should start with the UTF-8 BOM", () => {
      expect(rawCsvOf().startsWith(BOM)).toBe(true);
    });

    it("should write the Cambio,Cantidad header as the first row", () => {
      expect(rowsOf()[0]).toEqual(HEADER);
    });

    it("should separate rows with CRLF and end the body without a bare line feed", () => {
      const body = rawCsvOf().slice(BOM.length).replace(/\r\n$/, "");

      expect(body.split("\r\n")).toEqual([
        "Cambio,Cantidad",
        "Padrones rurales insertados,107",
        "Padrones urbanos insertados,207",
        "Total insertados,304",
      ]);
    });
  });

  describe("database changes only", () => {
    it("should write exactly the rural, urbano and total inserted rows after the header", () => {
      expect(rowsOf().slice(1)).toEqual([RURAL_ROW, URBANO_ROW, TOTAL_ROW]);
    });

    it("should take the total from the totals inserted count", () => {
      const rows = rowsOf({ totals: { rowsRead: 1, groups: 1, rowsMerged: 1, inserted: 999 } });

      expect(rows[3]).toEqual(["Total insertados", "999"]);
    });

    it("should write no metadata, warnings, timings, analyze status or ambiguous codes", () => {
      const csv = rawCsvOf({
        warnings: ["Hay 2 filas sin clave."],
        ambiguousLocalityCodes: [{ coddepto: "01", codloccat: "C1", nomloccat: ["Uno", "Dos"] }],
        analyze: { status: "failed", message: "timeout" },
      });

      FORBIDDEN_TEXTS.forEach((text) => expect(csv).not.toContain(text));
    });

    it("should write the same rows in a dry run", () => {
      expect(rowsOf({ dryRun: true })).toEqual(rowsOf({ dryRun: false }));
    });

    it("should write the same rows when the outcome is unknown", () => {
      expect(rowsOf({ outcomeUnknown: true })).toEqual(rowsOf({ outcomeUnknown: false }));
    });
  });
});
