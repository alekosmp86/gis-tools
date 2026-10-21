import { describe, expect, it } from "vitest";
import { iter } from "but-unzip";
import {
  REPORT_COLUMNS,
  REPORT_FILE_PREFIX,
  REPORT_KINDS,
  ReportKind,
} from "@/modules/coverage-loads/avance-ftth/constants";
import { formatCompactDate } from "@/modules/coverage-loads/shared/domain/compactDate";
import { parseContentDispositionFileName } from "@/modules/coverage-loads/shared/domain/contentDisposition";
import { formatCsvLine } from "@/modules/coverage-loads/avance-ftth/domain/csvFormat";
import { encodeLatin1 } from "@/modules/coverage-loads/shared/domain/latin1";
import { buildRejectedCsv, buildRejectedFileName } from "@/modules/coverage-loads/avance-ftth/domain/rejectedCsv";
import {
  buildReportFileName,
  buildReportText,
  buildReportZip,
  buildReportZipName,
} from "@/modules/coverage-loads/avance-ftth/domain/reportFiles";
import { buildZip } from "@/modules/coverage-loads/avance-ftth/domain/zipWriter";
import type { ReportData, ReportRow } from "@/modules/coverage-loads/avance-ftth/types";
import { latin1 } from "./avanceHarness";

const RUN_DAY = new Date(2026, 9, 9, 15, 30, 44);
const decode = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");

function rowOf(kind: ReportKind, fill: (name: string, index: number) => string): ReportRow {
  return REPORT_COLUMNS[kind].map((column, index) => fill(column.name, index));
}

async function unzipAll(zip: Uint8Array): Promise<Array<{ name: string; bytes: Uint8Array }>> {
  const entries: Array<{ name: string; bytes: Uint8Array }> = [];
  for (const entry of iter(zip)) entries.push({ name: entry.filename, bytes: new Uint8Array(await entry.read()) });
  return entries;
}

interface CentralEntry {
  readonly name: string;
  readonly crc: number;
  readonly size: number;
  readonly offset: number;
  readonly method: number;
  readonly flags: number;
}

function readCentralDirectory(zip: Uint8Array): { entries: CentralEntry[]; total: number } {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const total = view.getUint16(end + 10, true);
  let cursor = view.getUint32(end + 16, true);
  const entries: CentralEntry[] = [];
  for (let index = 0; index < total; index += 1) {
    expect(view.getUint32(cursor, true)).toBe(0x02014b50);
    const nameLength = view.getUint16(cursor + 28, true);
    entries.push({
      name: Buffer.from(zip.subarray(cursor + 46, cursor + 46 + nameLength)).toString("latin1"),
      crc: view.getUint32(cursor + 16, true),
      size: view.getUint32(cursor + 24, true),
      offset: view.getUint32(cursor + 42, true),
      method: view.getUint16(cursor + 10, true),
      flags: view.getUint16(cursor + 8, true),
    });
    cursor += 46 + nameLength;
  }
  return { entries, total };
}

describe("avance-ftth report files (AC-22)", () => {
  describe("csv line format", () => {
    it("should join with ; end with LF and leave plain values unquoted", () => {
      // Arrange & Act & Assert
      expect(formatCsvLine(["a", "b c", "", "ñ"])).toBe("a;b c;;ñ\n");
    });

    it.each([
      ["separator", "a;b", '"a;b"'],
      ["quote", 'a"b', '"a""b"'],
      ["line feed", "a\nb", '"a\nb"'],
      ["carriage return", "a\rb", '"a\rb"'],
    ])("should enclose a value with a %s only", (_label, value, expected) => {
      // Arrange & Act & Assert
      expect(formatCsvLine([value, "plain"])).toBe(`${expected};plain\n`);
    });
  });

  describe("report text", () => {
    it.each(REPORT_KINDS)("should write only the header for an empty %s report", (kind) => {
      // Arrange
      const header = REPORT_COLUMNS[kind].map((column) => column.name).join(";") + "\n";

      // Act
      const text = decode(buildReportText(kind, []));

      // Assert
      expect(text).toBe(header);
    });

    it("should list exactly the legacy columns of every report", () => {
      // Arrange & Act & Assert
      expect(Object.fromEntries(REPORT_KINDS.map((kind) => [kind, REPORT_COLUMNS[kind].map((column) => column.name)]))).toEqual({
        duplicado_planilla_obras: [
          "central", "cable", "zona", "empresa", "plano_al_com", "ejecutor", "director",
          "etiqueta", "conca", "edificio", "fechaact", "fuente", "fechacarga",
        ],
        error_estados_modificados: [
          "edificio", "historico_edificio", "cable", "historico_cable", "zona", "historico_zona", "estado",
          "historico_estado", "empresa", "historico_empresa", "fecha", "historico_fecha", "director",
          "historico_director", "ejecutor", "historico_ejecutor", "historico_fechacarga",
        ],
        zonas_en_planilla_no_en_SIGRA: ["edificio", "cable", "zona", "conca", "etiqueta"],
        zonas_en_SIGRA_no_en_planilla: [
          "id_distrito", "edificio", "identificacion_de_la_central", "codigo_distrito", "nombre_central",
          "cable", "zona", "conca", "situacion_distrito", "id_terminalfibraoptica", "codigo_terminalfibraoptica",
        ],
        ZONAS_FTTH_fuera_central: ["gid", "central", "cable", "zona", "conca", "edificio", "fecha", "estado", "fechacarga"],
      });
    });

    it("should write header then one LF-terminated line per row with ; separators and ISO dates as given", () => {
      // Arrange
      const rows = [
        ["1", "C1", "01", "02", "CONCA UNO", "EDIF1", "2020-01-02", "EJECUTADA", "2026-09-21"],
        ["2", "C2", "03", "04", "CONCA DOS", "EDIF2", "", "EN TRABAJO", "2026-09-22"],
      ];

      // Act
      const text = decode(buildReportText(ReportKind.FUERA_CENTRAL, rows));

      // Assert
      expect(text).toBe(
        "gid;central;cable;zona;conca;edificio;fecha;estado;fechacarga\n" +
          "1;C1;01;02;CONCA UNO;EDIF1;2020-01-02;EJECUTADA;2026-09-21\n" +
          "2;C2;03;04;CONCA DOS;EDIF2;;EN TRABAJO;2026-09-22\n"
      );
      expect(text).not.toContain("\r");
    });

    it("should enclose in quotes only the values that contain a separator, a quote or a line break", () => {
      // Arrange
      const row = ["E1", "01", "02", 'CON;CA "X"', "ETIQUETA"];

      // Act
      const text = decode(buildReportText(ReportKind.EN_PLANILLA_NO_EN_SIGRA, [row]));

      // Assert
      expect(text.split("\n")[1]).toBe('E1;01;02;"CON;CA ""X""";ETIQUETA');
    });

    it("should trim the columns the legacy trimmed and keep edificio of error_estados untouched", () => {
      // Arrange
      const row = rowOf(ReportKind.ERROR_ESTADOS, (name) => `  ${name}  `);

      // Act
      const line = decode(buildReportText(ReportKind.ERROR_ESTADOS, [row])).split("\n")[1];
      const values = line.split(";");

      // Assert
      expect(values[0]).toBe("  edificio  ");
      expect(values.slice(1)).toEqual(REPORT_COLUMNS[ReportKind.ERROR_ESTADOS].slice(1).map((column) => column.name));
    });

    it("should encode the text as ISO-8859-1 bytes", () => {
      // Arrange
      const row = ["Ñandú", "Ñ", "ü", "Piñeyro ÁÉÍÓÚ", "ç"];

      // Act
      const bytes = buildReportText(ReportKind.EN_PLANILLA_NO_EN_SIGRA, [row]);

      // Assert
      const expected = latin1("edificio;cable;zona;conca;etiqueta\nÑandú;Ñ;ü;Piñeyro ÁÉÍÓÚ;ç\n");
      expect(Array.from(bytes)).toEqual(Array.from(expected));
      expect(Array.from(bytes)).toContain(0xd1);
    });

    it("should write ? for characters that ISO-8859-1 cannot hold, as the legacy writer did", () => {
      // Arrange & Act & Assert
      expect(decode(encodeLatin1("a€b—c✓"))).toBe("a?b?c?");
    });

    it("should write multi-line values quoted and keep the line feed inside", () => {
      // Arrange
      const row = ["E1", "01", "01", "UNO\nDOS", "X"];

      // Act
      const text = decode(buildReportText(ReportKind.EN_PLANILLA_NO_EN_SIGRA, [row]));

      // Assert
      expect(text).toContain('"UNO\nDOS"');
    });
  });

  describe("file names", () => {
    it.each([
      [ReportKind.DUPLICADO, "reporte_avance_duplicado_planilla_obras_20261009.txt"],
      [ReportKind.EN_PLANILLA_NO_EN_SIGRA, "reporte_avance_zonas_en_planilla_no_en_SIGRA_20261009.txt"],
      [ReportKind.EN_SIGRA_NO_EN_PLANILLA, "reporte_avance_zonas_en_SIGRA_no_en_planilla_20261009.txt"],
      [ReportKind.ERROR_ESTADOS, "reporte_avance_error_estados_modificados_20261009.txt"],
      [ReportKind.FUERA_CENTRAL, "reporte_avance_ZONAS_FTTH_fuera_central_20261009.txt"],
    ])("should name the %s report %s from the injected run day", (kind, expected) => {
      // Arrange & Act & Assert
      expect(buildReportFileName(kind, RUN_DAY)).toBe(expected);
    });

    it("should name the zip AvanceFTTH_Reportes<yyyymmdd>.zip", () => {
      // Arrange & Act & Assert
      expect(buildReportZipName(RUN_DAY)).toBe("AvanceFTTH_Reportes20261009.zip");
    });

    it("should zero-pad single digit months and days and keep the year", () => {
      // Arrange & Act & Assert
      expect(formatCompactDate(new Date(2027, 0, 5))).toBe("20270105");
      expect(formatCompactDate(new Date(2026, 11, 31))).toBe("20261231");
    });

    it("should use only ASCII in every file name", () => {
      // Arrange
      const names = [...REPORT_KINDS.map((kind) => buildReportFileName(kind, RUN_DAY)), buildReportZipName(RUN_DAY)];

      // Act & Assert
      for (const name of names) expect(name).toMatch(/^[\x20-\x7e]+$/);
      for (const kind of REPORT_KINDS) expect(REPORT_FILE_PREFIX[kind]).toMatch(/^[A-Za-z_]+_$/);
    });

    it("should read the file name back from a Content-Disposition header", () => {
      // Arrange & Act & Assert
      expect(parseContentDispositionFileName('attachment; filename="a_b.zip"')).toBe("a_b.zip");
      expect(parseContentDispositionFileName("attachment; filename=plain.txt")).toBe("plain.txt");
      expect(parseContentDispositionFileName("attachment")).toBeNull();
      expect(parseContentDispositionFileName(null)).toBeNull();
    });
  });

  describe("zip writer", () => {
    it("should round-trip every produced entry with an independent reader: names and bytes", async () => {
      // Arrange
      const reports: ReportData[] = REPORT_KINDS.map((kind, index) => ({
        kind,
        rows: [rowOf(kind, (name) => `${name}-${index}-ñ`)],
        error: null,
      }));

      // Act
      const zip = buildReportZip(reports, RUN_DAY);
      const entries = await unzipAll(zip);

      // Assert
      expect(entries.map((entry) => entry.name)).toEqual(REPORT_KINDS.map((kind) => buildReportFileName(kind, RUN_DAY)));
      for (const [index, entry] of entries.entries()) {
        expect(Array.from(entry.bytes)).toEqual(Array.from(buildReportText(REPORT_KINDS[index], reports[index].rows ?? [])));
      }
    });

    it("should pack the reports in the legacy order whatever order they arrive in", async () => {
      // Arrange
      const reports: ReportData[] = [...REPORT_KINDS].reverse().map((kind) => ({ kind, rows: [], error: null }));

      // Act
      const entries = await unzipAll(buildReportZip(reports, RUN_DAY));

      // Assert
      expect(entries.map((entry) => entry.name)).toEqual(REPORT_KINDS.map((kind) => buildReportFileName(kind, RUN_DAY)));
    });

    it("should leave a failed report (no rows) out of the zip and keep the others", async () => {
      // Arrange
      const reports: ReportData[] = [
        { kind: ReportKind.DUPLICADO, rows: [], error: null },
        { kind: ReportKind.FUERA_CENTRAL, rows: null, error: "boom" },
      ];

      // Act
      const entries = await unzipAll(buildReportZip(reports, RUN_DAY));

      // Assert
      expect(entries.map((entry) => entry.name)).toEqual([buildReportFileName(ReportKind.DUPLICADO, RUN_DAY)]);
    });

    it("should write a header-only file for an empty report inside the zip", async () => {
      // Arrange
      const reports: ReportData[] = [{ kind: ReportKind.EN_PLANILLA_NO_EN_SIGRA, rows: [], error: null }];

      // Act
      const [entry] = await unzipAll(buildReportZip(reports, RUN_DAY));

      // Assert
      expect(decode(entry.bytes)).toBe("edificio;cable;zona;conca;etiqueta\n");
    });

    it("should store the entries with the CRC-32 of their bytes (known vector 123456789 = 0xCBF43926)", () => {
      // Arrange
      const vector = new TextEncoder().encode("123456789");

      // Act
      const { entries } = readCentralDirectory(buildZip([{ name: "vector.txt", bytes: vector }], RUN_DAY));

      // Assert
      expect(entries[0].crc).toBe(0xcbf43926);
      expect(entries[0].size).toBe(9);
      expect(entries[0].method).toBe(0);
    });

    it("should write an empty file entry with CRC 0 and size 0 and read it back", async () => {
      // Arrange
      const zip = buildZip([{ name: "vacio.txt", bytes: new Uint8Array(0) }, { name: "uno.txt", bytes: new Uint8Array([1]) }], RUN_DAY);

      // Act
      const { entries } = readCentralDirectory(zip);
      const read = await unzipAll(zip);

      // Assert
      expect(entries[0]).toMatchObject({ name: "vacio.txt", crc: 0, size: 0 });
      expect(read[0].bytes).toHaveLength(0);
      expect(Array.from(read[1].bytes)).toEqual([1]);
    });

    it("should give each central entry the offset of its local header and count all entries", () => {
      // Arrange
      const zip = buildZip(
        [
          { name: "a.txt", bytes: new Uint8Array([1, 2, 3]) },
          { name: "bb.txt", bytes: new Uint8Array([4, 5]) },
        ],
        RUN_DAY
      );

      // Act
      const { entries, total } = readCentralDirectory(zip);
      const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

      // Assert
      expect(total).toBe(2);
      expect(entries.map((entry) => entry.offset)).toEqual([0, 30 + 5 + 3]);
      for (const entry of entries) expect(view.getUint32(entry.offset, true)).toBe(0x04034b50);
    });

    it("should produce a valid empty archive when there are no entries", () => {
      // Arrange & Act
      const zip = buildZip([], RUN_DAY);

      // Assert
      expect(zip).toHaveLength(22);
      expect(readCentralDirectory(zip).total).toBe(0);
      expect([...iter(zip)]).toEqual([]);
    });

    it("should stamp the DOS time and date from the given moment (even seconds, year from 1980)", () => {
      // Arrange
      const zip = buildZip([{ name: "a.txt", bytes: new Uint8Array([1]) }], RUN_DAY);
      const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);

      // Act
      const time = view.getUint16(10, true);
      const date = view.getUint16(12, true);

      // Assert
      expect(time).toBe((15 << 11) | (30 << 5) | 22);
      expect(date).toBe(((2026 - 1980) << 9) | (10 << 5) | 9);
    });

    it("should keep every entry name ASCII in the archive for the report zip", () => {
      // Arrange
      const reports: ReportData[] = REPORT_KINDS.map((kind) => ({ kind, rows: [], error: null }));

      // Act
      const { entries } = readCentralDirectory(buildReportZip(reports, RUN_DAY));

      // Assert
      expect(entries).toHaveLength(5);
      for (const entry of entries) expect(entry.name).toMatch(/^[\x20-\x7e]+$/);
    });
  });

  describe("rejected rows CSV (AC-29)", () => {
    it("should write the archivo;linea;texto;motivo header and one quoted-when-needed line per rejected row", () => {
      // Arrange
      const rows = [
        { file: "SituacionFTTH_INT_21092026.csv", line: 7, text: "a;b;c", reason: "Se esperaban 10 columnas y hay 3." },
        { file: "SituacionFTTH_INT_21092026.csv", line: 9, text: "sin", reason: 'tiene "comillas"' },
      ];

      // Act
      const csv = buildRejectedCsv(rows);

      // Assert
      expect(csv).toBe(
        "archivo;linea;texto;motivo\n" +
          'SituacionFTTH_INT_21092026.csv;7;"a;b;c";Se esperaban 10 columnas y hay 3.\n' +
          'SituacionFTTH_INT_21092026.csv;9;sin;"tiene ""comillas"""\n'
      );
    });

    it("should write only the header when nothing was rejected", () => {
      // Arrange & Act & Assert
      expect(buildRejectedCsv([])).toBe("archivo;linea;texto;motivo\n");
    });

    it("should name the download with the run day", () => {
      // Arrange & Act & Assert
      expect(buildRejectedFileName(RUN_DAY)).toBe("filas_rechazadas_20261009.csv");
    });
  });
});
