import { describe, expect, it } from "vitest";
import { buildUnidadTerritorialCsv } from "@/modules/routine-jobs/ui/reportCsv/unidadTerritorialCsv";
import type { UnitResult } from "@/modules/routine-jobs/jobs/unidad-territorial/types";
import { BOM, parseCsv, unitResultOf, unitTargetReportOf } from "./reportCsvFixtures";

const HEADER = ["Tabla", "Cambio", "Provincia", "Nombre", "Id", "Distancia (m)", "Relación de área"];

const TARGET = "unidades_destino";
const INSERTED = "Insertada";
const MODIFIED = "Geometría modificada";
const DETECTED = "Geometría detectada (no aplicada)";

const FORBIDDEN_TEXTS = [
  "Informe",
  "Modo",
  "Etapa",
  "Generado",
  "Resultado incierto",
  "Simulación",
  "no se aplicaron",
  "Cambio de fuente",
  "Filas leídas",
  "Candidatas",
  "Omitidas",
  "Sin cambios",
  "Faltantes en origen",
  "Ambiguas",
  "Unidad faltante",
  "Unidad ambigua",
  "Unidad omitida",
  "Advertencia",
  "Leer localidades",
];

const rawCsvOf = (overrides: Partial<UnitResult> = {}): string =>
  buildUnidadTerritorialCsv(unitResultOf(overrides));

const rowsOf = (overrides: Partial<UnitResult> = {}): string[][] => parseCsv(rawCsvOf(overrides));

const dataRowsOf = (overrides: Partial<UnitResult> = {}): string[][] => rowsOf(overrides).slice(1);

describe("buildUnidadTerritorialCsv", () => {
  describe("envelope", () => {
    it("should start with the UTF-8 BOM", () => {
      expect(rawCsvOf().startsWith(BOM)).toBe(true);
    });

    it("should write the flat table header as the first row", () => {
      expect(rowsOf()[0]).toEqual(HEADER);
    });

    it("should separate rows with CRLF and end the body without a bare line feed", () => {
      const body = rawCsvOf().slice(BOM.length).replace(/\r\n$/, "");
      const lines = body.split("\r\n");

      expect(lines[0]).toBe("Tabla,Cambio,Provincia,Nombre,Id,Distancia (m),Relación de área");
      expect(lines[1]).toBe('unidades_destino,Insertada,02,"Unidad ""Centro"", norte",7001,,');
      expect(body.replace(/\r\n/g, "")).not.toContain("\n");
    });

    it("should write only the header when the target has no inserted or changed units", () => {
      const csv = rawCsvOf({
        target: unitTargetReportOf({ inserted: 0, insertedList: [], changed: 0, geometryChanges: [] }),
      });

      expect(parseCsv(csv)).toEqual([HEADER]);
      expect(csv.slice(BOM.length).replace(/\r\n$/, "")).toBe(HEADER.join(","));
    });
  });

  describe("inserted rows", () => {
    it("should write one Insertada row per inserted unit with its province, name and id", () => {
      expect(dataRowsOf()).toContainEqual([TARGET, INSERTED, "02", 'Unidad "Centro", norte', "7001", "", ""]);
    });

    it("should write every inserted unit without truncating past the UI limit of 20", () => {
      expect(dataRowsOf().filter((row) => row[1] === INSERTED)).toHaveLength(25);
    });
  });

  describe("geometry rows", () => {
    it("should write one modified row per geometry change with its name, distance and area ratio", () => {
      expect(dataRowsOf()).toContainEqual([TARGET, MODIFIED, "02", "Unidad geom uno", "", "4.5", "1.1"]);
    });

    it("should write every geometry change without truncating past the UI limit of 20", () => {
      expect(dataRowsOf().filter((row) => row[1] === MODIFIED)).toHaveLength(25);
    });

    it("should write the detected-not-applied wording for every geometry change when the geometry was not applied", () => {
      const rows = dataRowsOf({ target: unitTargetReportOf({ updateApplied: false }) });
      const geometry = rows.filter((row) => row[1] === DETECTED || row[1] === MODIFIED);

      expect(geometry).toHaveLength(25);
      expect(geometry.every((row) => row[1] === DETECTED)).toBe(true);
      expect(rows.filter((row) => row[1] === INSERTED)).toHaveLength(25);
    });
  });

  describe("content restrictions", () => {
    it("should write exactly the inserted and geometry rows with no font-change or count rows", () => {
      const rows = dataRowsOf();

      expect(rows).toHaveLength(50);
      expect(rows.every((row) => row.length === HEADER.length)).toBe(true);
      expect(rows.every((row) => row[1] === INSERTED || row[1] === MODIFIED)).toBe(true);
    });

    it("should write no metadata, counts, notes, totals, skipped, samples, warnings or timings", () => {
      const csv = rawCsvOf();

      FORBIDDEN_TEXTS.forEach((text) => expect(csv).not.toContain(text));
    });

    it("should write the same rows in a dry run", () => {
      expect(dataRowsOf({ dryRun: true })).toEqual(dataRowsOf({ dryRun: false }));
    });

    it("should write the same rows when the outcome is unknown", () => {
      expect(dataRowsOf({ outcomeUnknown: true })).toEqual(dataRowsOf({ outcomeUnknown: false }));
    });
  });

  describe("ordering", () => {
    it("should order numeric province ids numerically so that 2 comes before 10", () => {
      const rows = dataRowsOf({
        target: unitTargetReportOf({
          inserted: 2,
          insertedList: [
            { provinceId: "10", name: "Unidad diez", id: 1 },
            { provinceId: "2", name: "Unidad dos", id: 2 },
          ],
          changed: 0,
          geometryChanges: [],
        }),
      });

      expect(rows).toEqual([
        [TARGET, INSERTED, "2", "Unidad dos", "2", "", ""],
        [TARGET, INSERTED, "10", "Unidad diez", "1", "", ""],
      ]);
    });
  });

  describe("quoting and hostile text", () => {
    it("should quote a unit name containing commas and quotes so that it round-trips", () => {
      expect(rawCsvOf()).toContain('"Unidad ""Centro"", norte"');
    });

    it("should neutralize formula triggers and keep quotes, commas and line breaks inside one cell", () => {
      const rows = dataRowsOf({
        target: unitTargetReportOf({
          inserted: 1,
          insertedList: [{ provinceId: "=02", name: '+Unidad, "x"\nfin', id: 5 }],
          changed: 1,
          geometryChanges: [{ provinceId: "-03", name: "@cmd", distance: null, areaRatio: null }],
        }),
      });

      expect(rows).toEqual([
        [TARGET, INSERTED, "'=02", '\'+Unidad, "x"\nfin', "5", "", ""],
        [TARGET, MODIFIED, "'-03", "'@cmd", "", "", ""],
      ]);
    });
  });
});
