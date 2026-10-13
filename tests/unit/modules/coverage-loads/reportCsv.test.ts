import { describe, expect, it } from "vitest";
import { formatCompactDate } from "@/modules/coverage-loads/indicators/domain/compactDate";
import { formatCsvField, formatCsvLine } from "@/modules/coverage-loads/indicators/domain/csvFormat";
import { buildRejectedCsv, buildRejectedFileName } from "@/modules/coverage-loads/indicators/domain/rejectedCsv";
import {
  buildReportCsv,
  buildReportFileName,
  formatPercentage,
} from "@/modules/coverage-loads/indicators/domain/reportCsv";
import { ReportKind } from "@/modules/coverage-loads/indicators/constants";
import type { RejectedRow, ReportRow } from "@/modules/coverage-loads/indicators/types";
import { latin1Bytes } from "./csvBuilders";

function reportRow(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    departamento: "ARTIGAS",
    localidad: "BELLA UNION",
    porcentajecobertura: "99.90",
    fecha_novedad: "01-09-2026",
    ...overrides,
  };
}

describe("formatCsvField / formatCsvLine (AC-17)", () => {
  it("should leave a plain value unquoted", () => {
    // Arrange, Act & Assert
    expect(formatCsvField("BELLA UNION")).toBe("BELLA UNION");
  });

  it.each([
    ["a separator", "A;B", '"A;B"'],
    ["a quote", 'A"B', '"A""B"'],
    ["a line feed", "A\nB", '"A\nB"'],
    ["a carriage return", "A\rB", '"A\rB"'],
  ])("should enclose a value that contains %s", (_label, value, expected) => {
    // Arrange, Act & Assert
    expect(formatCsvField(value)).toBe(expected);
  });

  it("should right-trim but keep leading spaces", () => {
    // Arrange, Act & Assert
    expect(formatCsvField("  A  \t")).toBe("  A");
  });

  it("should decide on quoting after trimming", () => {
    // Arrange, Act & Assert
    expect(formatCsvField("A \n")).toBe("A");
    expect(formatCsvField("A;B \n")).toBe('"A;B"');
  });

  it("should return an empty string for an empty or blank value", () => {
    // Arrange, Act & Assert
    expect(formatCsvField("")).toBe("");
    expect(formatCsvField("   ")).toBe("");
  });

  it("should join with semicolons and end with a single LF", () => {
    // Arrange, Act
    const line = formatCsvLine(["a", "b;c", "d"]);

    // Assert
    expect(line).toBe('a;"b;c";d\n');
    expect(line).not.toContain("\r");
  });
});

describe("formatPercentage (AC-19)", () => {
  it.each([
    ["91.30", "91.3"],
    ["100.00", "100"],
    ["0.00", "0"],
    ["12.35", "12.35"],
    ["99.90", "99.9"],
    ["40.70", "40.7"],
    ["10.00", "10"],
    ["50.50", "50.5"],
    ["7.05", "7.05"],
    ["100", "100"],
    ["0", "0"],
    ["10", "10"],
    ["  91.30  ", "91.3"],
    ["", ""],
  ])("should render %j as %j", (value, expected) => {
    // Arrange, Act & Assert
    expect(formatPercentage(value)).toBe(expected);
  });
});

describe("buildReportCsv (AC-16..20)", () => {
  it("should write the localidad header and four columns with LF endings", () => {
    // Arrange
    const rows = [reportRow(), reportRow({ localidad: "BALTASAR BRUM", porcentajecobertura: "91.30" })];

    // Act
    const text = Buffer.from(buildReportCsv(ReportKind.LOCALIDAD, rows)).toString("latin1");

    // Assert
    expect(text).toBe(
      "departamento;localidad;porcentajecobertura;fecha_novedad\n" +
        "ARTIGAS;BELLA UNION;99.9;01-09-2026\n" +
        "ARTIGAS;BALTASAR BRUM;91.3;01-09-2026\n"
    );
  });

  it.each([ReportKind.MAYOR50, ReportKind.NOVEDAD])("should write three columns without the percentage for %s", (kind) => {
    // Arrange & Act
    const text = Buffer.from(buildReportCsv(kind, [reportRow()])).toString("latin1");

    // Assert
    expect(text).toBe("departamento;localidad;fecha_novedad\nARTIGAS;BELLA UNION;01-09-2026\n");
  });

  it("should encode accented characters as ISO-8859-1 bytes", () => {
    // Arrange
    const rows = [reportRow({ departamento: "PAYSANDÚ", localidad: "ÑANDÚ É" })];

    // Act
    const bytes = buildReportCsv(ReportKind.MAYOR50, rows);

    // Assert
    const expected = latin1Bytes("departamento;localidad;fecha_novedad\nPAYSANDÚ;ÑANDÚ É;01-09-2026\n");
    expect(Array.from(bytes)).toEqual(Array.from(expected));
    expect(bytes).toContain(0xda);
    expect(bytes).toContain(0xd1);
  });

  it("should replace characters outside ISO-8859-1 with a question mark", () => {
    // Arrange & Act
    const text = Buffer.from(buildReportCsv(ReportKind.MAYOR50, [reportRow({ localidad: "A€B" })])).toString("latin1");

    // Assert
    expect(text).toContain("ARTIGAS;A?B;");
  });

  it("should enclose only the values that need it and right-trim every value", () => {
    // Arrange
    const rows = [reportRow({ departamento: "A;B  ", localidad: 'C"D', porcentajecobertura: "50.00" })];

    // Act
    const text = Buffer.from(buildReportCsv(ReportKind.LOCALIDAD, rows)).toString("latin1");

    // Assert
    expect(text.split("\n")[1]).toBe('"A;B";"C""D";50;01-09-2026');
  });

  it("should produce a 0-byte file with no header when there are no rows", () => {
    // Arrange, Act & Assert
    for (const kind of Object.values(ReportKind)) {
      expect(buildReportCsv(kind, [])).toHaveLength(0);
    }
  });

  it("should never emit a carriage return", () => {
    // Arrange & Act
    const bytes = buildReportCsv(ReportKind.LOCALIDAD, [reportRow(), reportRow({ localidad: "OTRA" })]);

    // Assert
    expect(bytes).not.toContain(0x0d);
  });
});

describe("report file names (AC-21)", () => {
  it.each([
    [ReportKind.LOCALIDAD, "reporte_cobertura_lte_localidad__20261009.csv"],
    [ReportKind.MAYOR50, "reporte_cobertura_lte_localidad_mayor50__20261009.csv"],
    [ReportKind.NOVEDAD, "reporte_cobertura_lte_localidad_novedad__20261009.csv"],
  ])("should name the %s report with a double underscore and the injected run day", (kind, expected) => {
    // Arrange
    const runDay = new Date(2026, 9, 9, 12, 0, 0);

    // Act & Assert
    expect(buildReportFileName(kind, runDay)).toBe(expected);
  });

  it("should zero-pad single-digit months and days using the local calendar parts", () => {
    // Arrange
    const lateEvening = new Date(2026, 0, 5, 23, 59, 59);

    // Act & Assert
    expect(formatCompactDate(lateEvening)).toBe("20260105");
    expect(formatCompactDate(new Date(2026, 11, 31, 0, 0, 0))).toBe("20261231");
  });
});

describe("rejected rows CSV (AC-26)", () => {
  const row = (overrides: Partial<RejectedRow> = {}): RejectedRow => ({
    file: "IndicadoresLTE_20260901.csv",
    line: 12,
    text: "A;B;abc;Si",
    reason: 'El porcentaje "abc" no es un número.',
    ...overrides,
  });

  it("should start with the archivo;linea;texto;motivo header and end every line with LF", () => {
    // Arrange & Act
    const csv = buildRejectedCsv([row()]);

    // Assert
    expect(csv.split("\n")[0]).toBe("archivo;linea;texto;motivo");
    expect(csv.endsWith("\n")).toBe(true);
    expect(csv).not.toContain("\r");
  });

  it("should enclose the raw text and reason, doubling their quotes", () => {
    // Arrange & Act
    const csv = buildRejectedCsv([row()]);

    // Assert
    expect(csv.split("\n")[1]).toBe('IndicadoresLTE_20260901.csv;12;"A;B;abc;Si";"El porcentaje ""abc"" no es un número."');
  });

  it("should keep a line break inside the raw text as part of one quoted field", () => {
    // Arrange & Act
    const csv = buildRejectedCsv([row({ text: '"A\nB";C;abc;Si' })]);

    // Assert
    expect(csv).toContain('"""A\nB"";C;abc;Si"');
  });

  it("should write only the header when there are no rejected rows", () => {
    // Arrange, Act & Assert
    expect(buildRejectedCsv([])).toBe("archivo;linea;texto;motivo\n");
  });

  it("should list the rows in the order given", () => {
    // Arrange & Act
    const lines = buildRejectedCsv([row({ line: 3 }), row({ line: 2 })]).trim().split("\n");

    // Assert
    expect(lines[1]).toContain(";3;");
    expect(lines[2]).toContain(";2;");
  });

  it("should name the file with the injected run day", () => {
    // Arrange & Act & Assert
    expect(buildRejectedFileName(new Date(2026, 9, 9))).toBe("filas_rechazadas_20261009.csv");
  });
});
