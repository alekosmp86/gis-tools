import { describe, expect, it } from "vitest";
import { buildActualizarPadronCsv } from "@/modules/routine-jobs/ui/reportCsv/actualizarPadronCsv";
import type { ActualizarPadronResult, PadronGeometryChange, PadronInserted } from "@/modules/routine-jobs/jobs/actualizar-padron/types";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { actualizarPadronResultOf, actualizarTargetReportOf, BOM, parseCsv } from "./reportCsvFixtures";

const HEADER = [
  "Tabla",
  "Cambio",
  "Tipo",
  "Provincia",
  "Localidad",
  "Padrón",
  "Distancia (m)",
  "Relación de área",
  "Id",
  "Tipo anterior",
  "Localidad anterior",
  "Padrón anterior",
];
const TABLE = "carto.padron_tmp_actualizacion";
const INSERTED = "Insertada";
const MODIFIED = "Geometría modificada";
const DETECTED = "Geometría detectada (no aplicada)";
const CELL_COUNT = HEADER.length;
const markerOf = (shown: number, total: number, noun: string): string =>
  `Lista incompleta: se muestran las primeras ${shown} de ${total} ${noun}`;

const FORBIDDEN_TEXTS = [
  "Informe",
  "Modo",
  "Etapa",
  "Generado",
  "Resultado incierto",
  "Simulación",
  "Filas leídas",
  "Candidatas",
  "Omitidas",
  "Sin cambios",
  "Faltantes en destino",
  "Ambiguas",
  "Advertencia",
  "Estadísticas",
  "Tiempos",
  "Clasificar padrones",
  "Tabla de trabajo",
  "Localidad no encontrada",
  "Clave duplicada",
];

const rawCsvOf = (overrides: Partial<ActualizarPadronResult> = {}): string =>
  buildActualizarPadronCsv(actualizarPadronResultOf(overrides));

const rowsOf = (overrides: Partial<ActualizarPadronResult> = {}): string[][] => parseCsv(rawCsvOf(overrides));

const dataRowsOf = (overrides: Partial<ActualizarPadronResult> = {}): string[][] => rowsOf(overrides).slice(1);

const withTarget = (target: Parameters<typeof actualizarTargetReportOf>[0]): Partial<ActualizarPadronResult> => ({
  target: actualizarTargetReportOf(target),
});

const insertedOf = (overrides: Partial<PadronInserted> = {}): PadronInserted => ({
  id: 1,
  department: "CORDOBA",
  locality: "Villa Maria",
  typePadron: "URBANO",
  provinceId: 2,
  localityId: 10,
  number: "1",
  ...overrides,
});

const geometryOf = (overrides: Partial<PadronGeometryChange> & { number: string }): PadronGeometryChange => ({
  department: "JUJUY",
  locality: "Humahuaca",
  typePadron: "URBANO",
  provinceId: 3,
  localityId: 20,
  distance: 1,
  areaRatio: 0.5,
  ...overrides,
});

describe("buildActualizarPadronCsv (AP-49)", () => {
  describe("envelope", () => {
    it("should start with the UTF-8 BOM", () => {
      expect(rawCsvOf().startsWith(BOM)).toBe(true);
    });

    it("should write the flat table header as the first row, with the Spanish column names", () => {
      expect(rowsOf()[0]).toEqual(HEADER);
    });

    it("should separate rows with CRLF and end the body without a bare line feed", () => {
      const body = rawCsvOf({ target: actualizarTargetReportOf({ inserted: 0, insertedList: [], changed: 0, geometryChanges: [] }) })
        .slice(BOM.length)
        .replace(/\r\n$/, "");

      expect(body).toBe(HEADER.join(","));
    });

    it("should write only the header when the target has no inserted and no changed padrones", () => {
      const csv = rawCsvOf({ target: actualizarTargetReportOf({ inserted: 0, insertedList: [], changed: 0, geometryChanges: [] }) });

      expect(parseCsv(csv)).toEqual([HEADER]);
    });

    it("should write every row with the eight columns of the header", () => {
      expect(dataRowsOf().every((row) => row.length === CELL_COUNT)).toBe(true);
    });
  });

  describe("inserted rows (AP-42, AP-49)", () => {
    it("should write one Insertada row per inserted padron with its table, type, department, locality and number", () => {
      const rows = dataRowsOf({ target: actualizarTargetReportOf({ inserted: 1, insertedList: [insertedOf({ id: 9001, number: "100" })], changed: 0, geometryChanges: [], updated: 0 }) });

      expect(rows).toEqual([[TABLE, INSERTED, "URBANO", "CORDOBA", "Villa Maria", "100", "", "", "", "", "", ""]]);
    });

    it("should leave the distance and area cells empty for inserted padrones", () => {
      const rows = dataRowsOf();

      expect(rows.filter((row) => row[1] === INSERTED).every((row) => row[6] === "" && row[7] === "")).toBe(true);
    });

    it("should never write the internal id of an inserted padron", () => {
      const csv = rawCsvOf({ target: actualizarTargetReportOf({ inserted: 1, insertedList: [insertedOf({ id: 987654, number: "100" })], changed: 0, geometryChanges: [] }) });

      expect(csv).not.toContain("987654");
    });
  });

  describe("geometry rows (AP-44, AP-49)", () => {
    it("should write Geometría modificada for each geometry change when the update was applied", () => {
      const rows = dataRowsOf({ target: actualizarTargetReportOf({ inserted: 0, insertedList: [], geometryChanges: [geometryOf({ number: "7", distance: 4.5, areaRatio: 1.1 })], changed: 1, updated: 1 }) });

      expect(rows).toEqual([[TABLE, MODIFIED, "URBANO", "JUJUY", "Humahuaca", "7", "4.5", "1.1", "", "", "", ""]]);
    });

    it("should write Geometría detectada (no aplicada) for every geometry change when the update was not applied", () => {
      const rows = dataRowsOf({ target: actualizarTargetReportOf({ updateApplied: false, updated: 0 }) });
      const geometry = rows.filter((row) => row[1] === DETECTED || row[1] === MODIFIED);

      expect(geometry).toHaveLength(25);
      expect(geometry.every((row) => row[1] === DETECTED)).toBe(true);
    });

    it("should write an empty distance and area cell when the geometry change has no measure", () => {
      const rows = dataRowsOf({ target: actualizarTargetReportOf({ inserted: 0, insertedList: [], geometryChanges: [geometryOf({ number: "8", distance: null, areaRatio: null })], changed: 1 }) });

      expect(rows).toEqual([[TABLE, MODIFIED, "URBANO", "JUJUY", "Humahuaca", "8", "", "", "", "", "", ""]]);
    });
  });

  describe("content restrictions (AP-49)", () => {
    it("should write exactly the inserted and geometry rows, with no summary, count, warning or timing rows", () => {
      const rows = dataRowsOf();

      expect(rows).toHaveLength(50);
      expect(rows.every((row) => row[1] === INSERTED || row[1] === MODIFIED)).toBe(true);
    });

    it("should write no read, skipped, ambiguous, missing, warning, timing or classification text", () => {
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

  describe("ordering (AP-49)", () => {
    it("should list every inserted padron before every geometry change, whatever their departments", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 1,
          insertedList: [insertedOf({ department: "ZZZ", number: "1" })],
          changed: 1,
          updated: 1,
          geometryChanges: [geometryOf({ department: "AAA", number: "2" })],
        }),
      });

      expect(rows.map((row) => row[1])).toEqual([INSERTED, MODIFIED]);
    });

    it("should order inserted padrones by department, then locality, then number, comparing numbers numerically", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 4,
          insertedList: [
            insertedOf({ department: "JUJUY", locality: "A", number: "1" }),
            insertedOf({ department: "CORDOBA", locality: "B", number: "10" }),
            insertedOf({ department: "CORDOBA", locality: "B", number: "2" }),
            insertedOf({ department: "CORDOBA", locality: "A", number: "9" }),
          ],
          changed: 0,
          geometryChanges: [],
          updated: 0,
        }),
      });

      expect(rows.map((row) => [row[3], row[4], row[5]])).toEqual([
        ["CORDOBA", "A", "9"],
        ["CORDOBA", "B", "2"],
        ["CORDOBA", "B", "10"],
        ["JUJUY", "A", "1"],
      ]);
    });
  });

  describe("missing values (sin dato)", () => {
    it("should write sin dato for a missing department, locality, type and number", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 1,
          insertedList: [insertedOf({ department: null, locality: null, typePadron: null, number: null })],
          changed: 0,
          geometryChanges: [],
          updated: 0,
        }),
      });

      expect(rows).toEqual([[TABLE, INSERTED, "sin dato", "sin dato", "sin dato", "sin dato", "", "", "", "", "", ""]]);
    });
  });

  describe("quoting and hostile text", () => {
    it("should quote a locality containing commas and quotes so that it round-trips", () => {
      const csv = rawCsvOf({
        target: actualizarTargetReportOf({ inserted: 1, insertedList: [insertedOf({ locality: 'Villa "Norte", sur', number: "5" })], changed: 0, geometryChanges: [] }),
      });

      expect(csv).toContain('"Villa ""Norte"", sur"');
    });

    it("should neutralise formula triggers in every text cell", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 1,
          insertedList: [insertedOf({ department: "=CMD", locality: "+suma", typePadron: "@tipo", number: "-1" })],
          changed: 0,
          geometryChanges: [],
          updated: 0,
        }),
      });

      expect(rows).toEqual([[TABLE, INSERTED, "'@tipo", "'=CMD", "'+suma", "'-1", "", "", "", "", "", ""]]);
    });
  });

  describe("cut markers (MJ-14, AP-49)", () => {
    const cutInserted = (count: number) => Array.from({ length: count }, (_, index) => insertedOf({ id: index, number: String(index) }));
    const cutGeometry = (count: number) => Array.from({ length: count }, (_, index) => geometryOf({ number: String(index) }));

    it("should close the inserted list with one marker row when the real count exceeds the list", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: DETAIL_LIST_LIMIT + 100,
          insertedList: cutInserted(DETAIL_LIST_LIMIT),
          changed: 0,
          geometryChanges: [],
          updated: 0,
        }),
      });

      expect(rows.at(-1)).toEqual([
        TABLE,
        markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 100, "padrones insertados"),
        ...Array.from({ length: CELL_COUNT - 2 }, () => ""),
      ]);
    });

    it("should close the geometry list with one marker row when the real count exceeds the list", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: 0,
          insertedList: [],
          changed: DETAIL_LIST_LIMIT + 1,
          updated: DETAIL_LIST_LIMIT + 1,
          geometryChanges: cutGeometry(DETAIL_LIST_LIMIT),
        }),
      });

      expect(rows.at(-1)?.[1]).toBe(markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 1, "geometrías que cambian"));
    });

    it("should write one marker per cut list when both lists are cut", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: DETAIL_LIST_LIMIT + 1,
          insertedList: cutInserted(DETAIL_LIST_LIMIT),
          changed: DETAIL_LIST_LIMIT + 2,
          updated: DETAIL_LIST_LIMIT + 2,
          geometryChanges: cutGeometry(DETAIL_LIST_LIMIT),
        }),
      });

      const markers = rows.filter((row) => row[1].startsWith("Lista incompleta"));
      expect(markers.map((row) => row[1])).toEqual([
        markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 1, "padrones insertados"),
        markerOf(DETAIL_LIST_LIMIT, DETAIL_LIST_LIMIT + 2, "geometrías que cambian"),
      ]);
    });

    it("should write no marker when every list fits its real count", () => {
      const rows = dataRowsOf({
        target: actualizarTargetReportOf({
          inserted: DETAIL_LIST_LIMIT,
          insertedList: cutInserted(DETAIL_LIST_LIMIT),
          changed: DETAIL_LIST_LIMIT,
          updated: DETAIL_LIST_LIMIT,
          geometryChanges: cutGeometry(DETAIL_LIST_LIMIT),
        }),
      });

      expect(rows.some((row) => row[1].startsWith("Lista incompleta"))).toBe(false);
    });
  });

  describe("target fixture passthrough", () => {
    it("should export the table name of the target report in every row", () => {
      const rows = dataRowsOf(withTarget({ table: "carto.padron" }));

      expect(rows.every((row) => row[0] === "carto.padron")).toBe(true);
    });
  });
});
