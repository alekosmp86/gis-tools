import { describe, expect, it } from "vitest";
import { buildCargarLocalidadesCsv } from "@/modules/routine-jobs/ui/reportCsv/cargarLocalidadesCsv";
import type { CargarLocalidadesResult } from "@/modules/routine-jobs/jobs/cargar-localidades/types";
import {
  BOM,
  cargarLocalidadesResultOf,
  parseCsv,
  targetReportOf,
} from "./reportCsvFixtures";

const HEADER = ["Tabla", "Cambio", "Provincia", "Nombre", "Id", "Distancia (m)", "Relación de área"];

const NORTE = "localidades_norte";
const SUR = "localidades_sur";
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
  "Filas leídas",
  "Candidatas",
  "Omitidas",
  "Sin cambios",
  "Faltantes en origen",
  "Ambiguas",
  "Código distinto",
  "Faltante uno",
  "Ambigua uno",
  "Código distinto uno",
  "Localidad omitida",
  "Advertencia",
  "Hay 50 filas",
  "Leer origen",
  "Aplicar destino",
];

const rawCsvOf = (overrides: Partial<CargarLocalidadesResult> = {}): string =>
  buildCargarLocalidadesCsv(cargarLocalidadesResultOf(overrides));

const rowsOf = (overrides: Partial<CargarLocalidadesResult> = {}): string[][] => parseCsv(rawCsvOf(overrides));

const dataRowsOf = (overrides: Partial<CargarLocalidadesResult> = {}): string[][] => rowsOf(overrides).slice(1);

const rowsOfTable = (rows: string[][], table: string): string[][] => rows.filter((row) => row[0] === table);

describe("buildCargarLocalidadesCsv", () => {
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
      expect(lines[1]).toBe("localidades_norte,Insertada,CORDOBA,Localidad nueva 1,9001,,");
      expect(body.replace(/\r\n/g, "")).not.toContain("\n");
    });

    it("should write only the header when no target has inserted or changed localities", () => {
      const csv = rawCsvOf({ targets: [targetReportOf(NORTE), targetReportOf(SUR)] });

      expect(parseCsv(csv)).toEqual([HEADER]);
      expect(csv.slice(BOM.length).replace(/\r\n$/, "")).toBe(HEADER.join(","));
    });
  });

  describe("inserted rows", () => {
    it("should write one Insertada row per inserted locality with its province, name and id", () => {
      expect(dataRowsOf()).toContainEqual([NORTE, INSERTED, "SANTA CRUZ", 'Villa "Los Pinos", norte', "9001", "", ""]);
      expect(dataRowsOf()).toContainEqual([NORTE, INSERTED, "CORDOBA", "Localidad nueva 24", "9024", "", ""]);
    });

    it("should write every inserted locality without truncating past the UI limit of 20", () => {
      expect(rowsOfTable(dataRowsOf(), NORTE).filter((row) => row[1] === INSERTED)).toHaveLength(25);
    });

    it("should leave the distance and area ratio empty on inserted rows", () => {
      const inserted = rowsOfTable(dataRowsOf(), NORTE).filter((row) => row[1] === INSERTED);

      expect(inserted.every((row) => row[5] === "" && row[6] === "")).toBe(true);
    });
  });

  describe("geometry rows", () => {
    it("should write one modified row per geometry change with its name, distance and area ratio", () => {
      expect(dataRowsOf()).toContainEqual([NORTE, MODIFIED, "JUJUY", "Geometría cambia uno", "", "12.5", "1.25"]);
    });

    it("should write every geometry change without truncating past the UI limit of 20", () => {
      expect(rowsOfTable(dataRowsOf(), NORTE).filter((row) => row[1] === MODIFIED)).toHaveLength(25);
    });

    it("should write the detected-not-applied wording and no modified rows for a target whose geometry was not applied", () => {
      expect(rowsOfTable(dataRowsOf(), SUR)).toEqual([[SUR, DETECTED, "MENDOZA", "Sur geom", "", "7.75", "2"]]);
    });

    it("should leave the id empty on geometry rows", () => {
      const geometry = dataRowsOf().filter((row) => row[1] === MODIFIED || row[1] === DETECTED);

      expect(geometry.every((row) => row[4] === "")).toBe(true);
    });
  });

  describe("ordering", () => {
    it("should order rows by table, then Insertada before geometry rows, then province, then name", () => {
      const rows = dataRowsOf({
        targets: [
          targetReportOf(NORTE, {
            inserted: 3,
            insertedList: [
              { department: "JUJUY", name: "Beta", id: 2 },
              { department: "CHACO", name: "Gamma", id: 3 },
              { department: "JUJUY", name: "Alfa", id: 1 },
            ],
            changed: 2,
            geometryChanges: [
              { department: "JUJUY", name: "Zeta", distance: 1, areaRatio: 1 },
              { department: "CHACO", name: "Eta", distance: 2, areaRatio: 2 },
            ],
          }),
          targetReportOf(SUR, { inserted: 1, insertedList: [{ department: "CHACO", name: "Omega", id: 9 }] }),
        ],
      });

      expect(rows).toEqual([
        [NORTE, INSERTED, "CHACO", "Gamma", "3", "", ""],
        [NORTE, INSERTED, "JUJUY", "Alfa", "1", "", ""],
        [NORTE, INSERTED, "JUJUY", "Beta", "2", "", ""],
        [NORTE, MODIFIED, "CHACO", "Eta", "", "2", "2"],
        [NORTE, MODIFIED, "JUJUY", "Zeta", "", "1", "1"],
        [SUR, INSERTED, "CHACO", "Omega", "9", "", ""],
      ]);
    });
  });

  describe("content restrictions", () => {
    it("should write only the seven flat columns on every row", () => {
      expect(dataRowsOf().every((row) => row.length === HEADER.length)).toBe(true);
    });

    it("should write only the inserted and geometry change kinds in the Cambio column", () => {
      const allowedKinds = [INSERTED, MODIFIED, DETECTED];

      expect(dataRowsOf().every((row) => allowedKinds.includes(row[1]))).toBe(true);
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

  describe("multi-target isolation", () => {
    it("should keep each target's rows under its own table and never mix names across targets", () => {
      const rows = dataRowsOf();

      expect(rowsOfTable(rows, SUR).some((row) => row.includes("Localidad nueva 1"))).toBe(false);
      expect(rowsOfTable(rows, NORTE).some((row) => row.includes("Sur geom"))).toBe(false);
    });
  });

  describe("quoting and hostile text", () => {
    it("should quote a locality name containing commas and quotes so that it round-trips", () => {
      expect(rawCsvOf()).toContain('"Villa ""Los Pinos"", norte"');
    });

    it("should neutralize formula triggers and keep quotes, commas and line breaks inside one cell", () => {
      const rows = dataRowsOf({
        targets: [
          targetReportOf(NORTE, {
            inserted: 1,
            insertedList: [{ department: "-CHACO", name: '=HYPERLINK("x"), "norte"\nsur', id: 1 }],
            changed: 1,
            geometryChanges: [{ department: "+SALTA", name: "@cmd", distance: null, areaRatio: null }],
          }),
        ],
      });

      expect(rows).toEqual([
        [NORTE, INSERTED, "'-CHACO", '\'=HYPERLINK("x"), "norte"\nsur', "1", "", ""],
        [NORTE, MODIFIED, "'+SALTA", "'@cmd", "", "", ""],
      ]);
    });
  });
});
