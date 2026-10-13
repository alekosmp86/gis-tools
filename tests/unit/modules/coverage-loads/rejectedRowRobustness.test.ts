import { describe, expect, it } from "vitest";
import {
  FileRejection,
  parseIndicatorsFile,
  RejectionReason,
  tokenizeRecords,
} from "@/modules/coverage-loads/indicators/domain/csvIndicators";
import { buildRejectedCsv } from "@/modules/coverage-loads/indicators/domain/rejectedCsv";
import { ParseKind } from "@/modules/coverage-loads/indicators/types";
import type { ParsedCut } from "@/modules/coverage-loads/indicators/types";
import { csvBytes, dataLine, validDataLines } from "./csvBuilders";

const FILE_NAME = "IndicadoresLTE_20260901.csv";
const MARKER = "…";
const MAX_TEXT = 500;
const NUL = "\u0000";
const NUL_REASON = "contiene un carácter nulo (NUL).";
const QUOTE_REASON = "comilla sin cerrar.";

function parseCut(lines: ReadonlyArray<string>, options: Parameters<typeof csvBytes>[1] = {}): ParsedCut {
  const outcome = parseIndicatorsFile(FILE_NAME, csvBytes(lines, options));
  if (outcome.kind !== ParseKind.CUT) throw new Error(`expected a cut, got: ${outcome.error.message}`);
  return outcome.cut;
}

function parseError(lines: ReadonlyArray<string>, options: Parameters<typeof csvBytes>[1] = {}): string {
  const outcome = parseIndicatorsFile(FILE_NAME, csvBytes(lines, options));
  if (outcome.kind !== ParseKind.ERROR) throw new Error("expected a file error");
  return outcome.error.message;
}

/** A rejected (non-numeric porcentaje) single-line record that is exactly `length` characters long. */
function badRowOfLength(length: number): string {
  const prefix = "D;L;abc;";
  return prefix + "x".repeat(length - prefix.length);
}

describe("rejected row text truncation", () => {
  it("should keep a rejected row of exactly 500 characters unchanged", () => {
    // Arrange
    const line = badRowOfLength(MAX_TEXT);

    // Act
    const cut = parseCut([...validDataLines(1), line]);

    // Assert
    expect(line).toHaveLength(MAX_TEXT);
    expect(cut.rejected).toHaveLength(1);
    expect(cut.rejected[0].text).toBe(line);
  });

  it("should cut a rejected row of 501 characters to the first 500 plus the marker", () => {
    // Arrange
    const line = badRowOfLength(MAX_TEXT + 1);

    // Act
    const cut = parseCut([...validDataLines(1), line]);

    // Assert
    expect(cut.rejected[0].text).toBe(line.slice(0, MAX_TEXT) + MARKER);
    expect(cut.rejected[0].text).toHaveLength(MAX_TEXT + 1);
  });

  it("should bound a rejected row of about 10 MB to 501 characters", () => {
    // Arrange
    const line = badRowOfLength(10 * 1024 * 1024);

    // Act
    const cut = parseCut([...validDataLines(1), line]);

    // Assert
    expect(cut.rejected).toHaveLength(1);
    expect(cut.rejected[0].text).toBe(line.slice(0, MAX_TEXT) + MARKER);
    expect(cut.rejected[0].text.length).toBeLessThanOrEqual(MAX_TEXT + 1);
  });

  it("should truncate a multi-line quoted record by its raw length and keep the next row's line number", () => {
    // Arrange
    const quoted = `"${"abcdefghi\n".repeat(60)}"`;
    const raw = `D;${quoted};10;Si`;
    const next = dataLine("OTRO", "LOC", "5", "No");

    // Act
    const cut = parseCut([...validDataLines(1), raw, next]);

    // Assert
    expect(raw.length).toBeGreaterThan(MAX_TEXT);
    expect(cut.rejected).toHaveLength(1);
    expect(cut.rejected[0].line).toBe(3);
    expect(cut.rejected[0].text).toBe(raw.slice(0, MAX_TEXT) + MARKER);
    expect(cut.rows.map((row) => row.departamento)).toEqual(["DEPTO0", "OTRO"]);
  });

  it("should carry the truncated text into the rejected CSV", () => {
    // Arrange
    const cut = parseCut([...validDataLines(1), badRowOfLength(2000)]);

    // Act
    const csv = buildRejectedCsv(cut.rejected);

    // Assert
    expect(csv).toContain(`D;L;abc;${"x".repeat(MAX_TEXT - 8)}${MARKER}`);
    expect(csv).not.toContain("x".repeat(MAX_TEXT));
    expect(csv.length).toBeLessThan(1500);
  });

  it("should leave the text of short rejected rows untouched", () => {
    // Arrange & Act
    const cut = parseCut([...validDataLines(1), "BAD;ROW;abc;Si"]);

    // Assert
    expect(cut.rejected[0].text).toBe("BAD;ROW;abc;Si");
  });
});

describe("unterminated quote", () => {
  it.each([
    ["first", '"X;Y;1;Si'],
    ["middle", 'D;"Y;1;Si'],
    ["last", 'D;L;1;"Si'],
  ])("should reject the last record when a quote opens in the %s field", (_label, last) => {
    // Arrange & Act
    const cut = parseCut([...validDataLines(2), last], { trailingEol: false });

    // Assert
    expect(cut.rows).toHaveLength(2);
    expect(cut.rejected).toEqual([{ file: FILE_NAME, line: 4, text: last, reason: QUOTE_REASON }]);
    expect(RejectionReason.unterminatedQuote()).toBe(QUOTE_REASON);
  });

  it("should report the line where the record starts when the open quote spans several lines", () => {
    // Arrange
    const last = '"X;Y;1;Si\nmas\ntexto';

    // Act
    const cut = parseCut([...validDataLines(1), last]);

    // Assert
    expect(cut.rejected).toHaveLength(1);
    expect(cut.rejected[0].line).toBe(3);
    expect(cut.rejected[0].reason).toBe(QUOTE_REASON);
  });

  it("should give the same reason for a lone quote at the end of the file", () => {
    // Arrange & Act
    const cut = parseCut([...validDataLines(1), '"'], { trailingEol: false });

    // Assert
    expect(cut.rejected).toEqual([{ file: FILE_NAME, line: 3, text: '"', reason: QUOTE_REASON }]);
  });

  it("should give the same reason for a quote opened on the last line with no trailing newline", () => {
    // Arrange & Act
    const cut = parseCut([...validDataLines(1), 'D;"abierta;1;Si'], { trailingEol: false });

    // Assert
    expect(cut.rejected[0].reason).toBe(QUOTE_REASON);
  });

  it("should give the same reason when the file ends with the newline after the open quote", () => {
    // Arrange & Act
    const cut = parseCut([...validDataLines(1), 'D;"abierta;1;Si']);

    // Assert
    expect(cut.rejected[0].reason).toBe(QUOTE_REASON);
  });

  it("should replace the validation reason, even for a record that would also be badly formed", () => {
    // Arrange & Act
    const cut = parseCut([...validDataLines(1), '"a;b']);

    // Assert
    expect(cut.rejected[0].reason).toBe(QUOTE_REASON);
  });

  it("should not affect a properly closed quote with embedded newlines and doubled quotes", () => {
    // Arrange
    const line = 'DEP;"LOC ""X""\nY";10;Si';

    // Act
    const cut = parseCut([line], { trailingEol: false });

    // Assert
    expect(cut.rejected.map((row) => row.reason)).not.toContain(QUOTE_REASON);
    expect(cut.rows).toEqual([{ departamento: "DEP", localidad: 'LOC "X"\nY', porcentaje: "10", cobertura: "Si" }]);
  });

  it("should swallow everything after an unterminated quote in the middle of the file as one bounded rejected row", () => {
    // Arrange
    const lines = [...validDataLines(3), 'D;"oops;1;Si', ...validDataLines(100)];

    // Act
    const cut = parseCut(lines);

    // Assert
    expect(cut.rows).toHaveLength(3);
    expect(cut.rejected).toHaveLength(1);
    expect(cut.rejected[0].line).toBe(5);
    expect(cut.rejected[0].reason).toBe(QUOTE_REASON);
    expect(cut.rejected[0].text).toHaveLength(MAX_TEXT + 1);
    expect(cut.rejected[0].text.endsWith(MARKER)).toBe(true);
  });

  it("should reject the file when its only data row is the unterminated record", () => {
    // Arrange & Act
    const message = parseError(['D;"abierta;1;Si']);

    // Assert
    expect(message).toBe(FileRejection.noValidRows(FILE_NAME, 1));
  });

  it("should flag only the last record as unterminated when it ends inside a quote", () => {
    // Arrange & Act
    const records = tokenizeRecords('H\n"A;B"\nC;"D');

    // Assert
    expect(records.map((record) => record.unterminatedQuote)).toEqual([false, false, true]);
  });

  it("should flag no record when every quote is closed", () => {
    // Arrange & Act
    const records = tokenizeRecords('H\n"A\nB";"C"\nD;E\n');

    // Assert
    expect(records.every((record) => !record.unterminatedQuote)).toBe(true);
  });
});

describe("NUL character", () => {
  it.each([
    ["Departamento", `DEP${NUL};LOC;10;Si`],
    ["Localidad", `DEP;LOC${NUL};10;Si`],
    ["Porcentaje", `DEP;LOC;1${NUL}0;Si`],
    ["Cobertura", `DEP;LOC;10;Si${NUL}`],
  ])("should reject a row with a NUL in %s", (_label, line) => {
    // Arrange & Act
    const cut = parseCut([...validDataLines(1), line]);

    // Assert
    expect(cut.rejected).toEqual([{ file: FILE_NAME, line: 3, text: line, reason: NUL_REASON }]);
    expect(RejectionReason.containsNul()).toBe(NUL_REASON);
  });

  it("should reject a NUL inside a quoted field", () => {
    // Arrange
    const line = `DEP;"LO${NUL}C";10;Si`;

    // Act
    const cut = parseCut([...validDataLines(1), line]);

    // Assert
    expect(cut.rejected[0].reason).toBe(NUL_REASON);
  });

  it("should reject a field that is only a NUL", () => {
    // Arrange & Act
    const cut = parseCut([...validDataLines(1), `${NUL};LOC;10;Si`]);

    // Assert
    expect(cut.rejected[0].reason).toBe(NUL_REASON);
  });

  it("should report the column count, not the NUL, when the column count is wrong", () => {
    // Arrange & Act
    const cut = parseCut([...validDataLines(1), `DEP${NUL};LOC;10`]);

    // Assert
    expect(cut.rejected[0].reason).toBe(RejectionReason.columnCount(3));
  });

  it("should keep the valid rows around a NUL row and list file, line and text of the rejected one", () => {
    // Arrange
    const nulLine = `DEP;LOC${NUL}X;10;Si`;

    // Act
    const cut = parseCut([...validDataLines(2), nulLine, dataLine("UNO", "DOS", "3", "No")]);

    // Assert
    expect(cut.rows).toHaveLength(3);
    expect(cut.rejected).toEqual([{ file: FILE_NAME, line: 4, text: nulLine, reason: NUL_REASON }]);
  });

  it("should not count a NUL row as a duplicate of a valid first occurrence", () => {
    // Arrange & Act
    const cut = parseCut([dataLine("A", "B", "10", "Si"), `A;B;10;Si${NUL}`]);

    // Assert
    expect(cut.rows).toHaveLength(1);
    expect(cut.rejected.map((row) => row.reason)).toEqual([NUL_REASON]);
  });

  it("should not let a NUL first occurrence poison the key for a later valid row with the same key", () => {
    // Arrange & Act
    const cut = parseCut([`A;B;1${NUL}0;Si`, dataLine("A", "B", "10", "Si")]);

    // Assert
    expect(cut.rows).toEqual([{ departamento: "A", localidad: "B", porcentaje: "10", cobertura: "Si" }]);
    expect(cut.rejected.map((row) => row.reason)).toEqual([NUL_REASON]);
  });

  it("should reject the file when its only row has a NUL", () => {
    // Arrange & Act
    const message = parseError([`DEP${NUL};LOC;10;Si`]);

    // Assert
    expect(message).toBe(FileRejection.noValidRows(FILE_NAME, 1));
  });
});
