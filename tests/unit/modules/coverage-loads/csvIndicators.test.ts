import { describe, expect, it } from "vitest";
import {
  FileRejection,
  parseIndicatorsFile,
  RejectionReason,
  tokenizeRecords,
} from "@/modules/coverage-loads/indicators/domain/csvIndicators";
import { ParseKind } from "@/modules/coverage-loads/indicators/types";
import type { ParsedCut } from "@/modules/coverage-loads/indicators/types";
import { CRLF, csvBytes, dataLine, HEADER_LINE, LF, latin1Bytes, validDataLines } from "./csvBuilders";

const FILE_NAME = "IndicadoresLTE_20260901.csv";

function parseCut(lines: ReadonlyArray<string>, options: Parameters<typeof csvBytes>[1] = {}): ParsedCut {
  const outcome = parseIndicatorsFile(FILE_NAME, csvBytes(lines, options));
  if (outcome.kind !== ParseKind.CUT) throw new Error(`expected a cut, got: ${outcome.error.message}`);
  return outcome.cut;
}

function parseError(bytes: Uint8Array, fileName = FILE_NAME): string {
  const outcome = parseIndicatorsFile(fileName, bytes);
  if (outcome.kind !== ParseKind.ERROR) throw new Error("expected a file error");
  return outcome.error.message;
}

describe("tokenizeRecords (AC-2)", () => {
  it("should split on LF and keep the 1-based physical line of each record", () => {
    // Arrange & Act
    const records = tokenizeRecords("H\nA;B\nC;D\n");

    // Assert
    expect(records.map((record) => [record.line, record.raw, record.fields])).toEqual([
      [1, "H", ["H"]],
      [2, "A;B", ["A", "B"]],
      [3, "C;D", ["C", "D"]],
    ]);
  });

  it("should treat CRLF as a single terminator and keep it out of the raw text", () => {
    // Arrange & Act
    const records = tokenizeRecords("H\r\nA;B\r\nC;D");

    // Assert
    expect(records.map((record) => record.raw)).toEqual(["H", "A;B", "C;D"]);
    expect(records.map((record) => record.line)).toEqual([1, 2, 3]);
  });

  it("should treat a lone CR as a record terminator", () => {
    // Arrange & Act
    const records = tokenizeRecords("H\rA;B\rC;D\r");

    // Assert
    expect(records.map((record) => record.raw)).toEqual(["H", "A;B", "C;D"]);
  });

  it("should not emit a phantom record after the final terminator", () => {
    // Arrange & Act & Assert
    expect(tokenizeRecords("A\n")).toHaveLength(1);
    expect(tokenizeRecords("A")).toHaveLength(1);
    expect(tokenizeRecords("")).toHaveLength(0);
  });

  it("should keep a separator inside an enclosure as data", () => {
    // Arrange & Act
    const [record] = tokenizeRecords('"A;B";C;"D"');

    // Assert
    expect(record.fields).toEqual(["A;B", "C", "D"]);
  });

  it("should keep a line break inside an enclosure as data and count the physical lines it spans", () => {
    // Arrange & Act
    const records = tokenizeRecords('H\n"A\nB";X\nC;D\n');

    // Assert
    expect(records[1].fields).toEqual(["A\nB", "X"]);
    expect(records[1].raw).toBe('"A\nB";X');
    expect(records[1].line).toBe(2);
    expect(records[2].line).toBe(4);
  });

  it("should read a doubled enclosure inside an enclosure as one quote character", () => {
    // Arrange & Act
    const [record] = tokenizeRecords('"say ""hi""";B');

    // Assert
    expect(record.fields).toEqual(['say "hi"', "B"]);
  });

  it("should treat an enclosure in the middle of a field as plain text", () => {
    // Arrange & Act
    const [record] = tokenizeRecords('AB"C;D');

    // Assert
    expect(record.fields).toEqual(['AB"C', "D"]);
  });

  it("should keep an unterminated enclosure running to the end of the text", () => {
    // Arrange & Act
    const records = tokenizeRecords('H\n"A;B\nC;D\n');

    // Assert
    expect(records).toHaveLength(2);
    expect(records[1].fields).toEqual(["A;B\nC;D\n"]);
  });
});

describe("parseIndicatorsFile", () => {
  describe("file name (AC-1, AC-6)", () => {
    it("should reject the file with the name message before reading any content", () => {
      // Arrange
      const bytes = csvBytes(validDataLines(3));

      // Act
      const message = parseError(bytes, "IndicadoresLTE_2026.csv");

      // Assert
      expect(message).toContain('El archivo "IndicadoresLTE_2026.csv" no tiene un nombre válido');
    });

    it("should carry the file name and the Spanish message in the file error", () => {
      // Arrange & Act
      const outcome = parseIndicatorsFile("otro.csv", csvBytes(validDataLines(1)));

      // Assert
      expect(outcome.kind).toBe(ParseKind.ERROR);
      if (outcome.kind === ParseKind.ERROR) expect(outcome.error.fileName).toBe("otro.csv");
    });

    it("should derive fechaact from the name", () => {
      // Arrange & Act
      const cut = parseCut(validDataLines(2));

      // Assert
      expect(cut.fechaact).toBe("2026-09-01");
      expect(cut.fileName).toBe(FILE_NAME);
    });
  });

  describe("encoding (AC-2)", () => {
    it("should round-trip accented characters read as ISO-8859-1", () => {
      // Arrange
      const lines = [dataLine("PAYSANDÚ", "PASO DE LOS TOROS Ñ", "50.5", "Si"), dataLine("SORIANO", "CARDONA É", "10", "No")];

      // Act
      const cut = parseCut(lines);

      // Assert
      expect(cut.rows.map((row) => [row.departamento, row.localidad])).toEqual([
        ["PAYSANDÚ", "PASO DE LOS TOROS Ñ"],
        ["SORIANO", "CARDONA É"],
      ]);
    });

    it("should not interpret the bytes as UTF-8", () => {
      // Arrange: byte 0xE9 alone is invalid UTF-8 but is "é" in ISO-8859-1
      const bytes = Uint8Array.from([
        ...latin1Bytes(`${HEADER_LINE}\n`),
        ...latin1Bytes("DEPTO;CAF"),
        0xc9,
        ...latin1Bytes(";10;Si\n"),
      ]);

      // Act
      const outcome = parseIndicatorsFile(FILE_NAME, bytes);

      // Assert
      expect(outcome.kind === ParseKind.CUT && outcome.cut.rows[0].localidad).toBe("CAFÉ");
    });

    it("should ignore a UTF-8 byte order mark in the header line", () => {
      // Arrange
      const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...csvBytes(validDataLines(2))]);

      // Act
      const outcome = parseIndicatorsFile(FILE_NAME, bytes);

      // Assert
      expect(outcome.kind === ParseKind.CUT && outcome.cut.rows).toHaveLength(2);
    });
  });

  describe("line endings and enclosure (AC-2)", () => {
    it("should parse CRLF and LF files into the same rows", () => {
      // Arrange
      const lines = validDataLines(5);

      // Act
      const withCrlf = parseCut(lines, { eol: CRLF });
      const withLf = parseCut(lines, { eol: LF });

      // Assert
      expect(withCrlf.rows).toEqual(withLf.rows);
      expect(withCrlf.rows).toHaveLength(5);
    });

    it("should parse a file without a final line break", () => {
      // Arrange & Act
      const cut = parseCut(validDataLines(2), { trailingEol: false });

      // Assert
      expect(cut.rows).toHaveLength(2);
    });

    it("should accept a quoted field that contains a separator", () => {
      // Arrange & Act
      const cut = parseCut(['"A;B";"LOC;1";50;Si']);

      // Assert
      expect(cut.rows).toEqual([{ departamento: "A;B", localidad: "LOC;1", porcentaje: "50", cobertura: "Si" }]);
    });

    it("should accept a quoted field that contains a line break and number the next row by physical line", () => {
      // Arrange
      const lines = ['"DEP\nA";LOC1;50;Si', "DEP2;LOC2;oops;Si"];

      // Act
      const cut = parseCut(lines);

      // Assert
      expect(cut.rows[0].departamento).toBe("DEP\nA");
      expect(cut.rejected).toHaveLength(1);
      expect(cut.rejected[0].line).toBe(4);
    });
  });

  describe("field cleaning (AC-3)", () => {
    it("should trim every field and leave Cobertura as written", () => {
      // Arrange & Act
      const cut = parseCut(["  ARTIGAS  ;\tBELLA UNION \t; 91.3 ;  Si  "]);

      // Assert
      expect(cut.rows).toEqual([{ departamento: "ARTIGAS", localidad: "BELLA UNION", porcentaje: "91.3", cobertura: "Si" }]);
    });

    it("should keep lower-case Cobertura as written because the upper-casing happens in the database", () => {
      // Arrange & Act
      const cut = parseCut([dataLine("A", "B", "10", "si"), dataLine("A", "C", "10", "NO")]);

      // Assert
      expect(cut.rows.map((row) => row.cobertura)).toEqual(["si", "NO"]);
    });

    it.each([
      ["Departamento", ["-", "LOC", "50", "Si"], RejectionReason.emptyDepartamento()],
      ["Localidad", ["DEP", "-", "50", "Si"], RejectionReason.emptyLocalidad()],
      ["%", ["DEP", "LOC", "-", "Si"], RejectionReason.porcentajeNotNumber("-")],
      ["Cobertura", ["DEP", "LOC", "50", "-"], RejectionReason.coberturaInvalid("-")],
    ])("should turn a dash in %s into NULL and reject the row", (_column, fields, reason) => {
      // Arrange & Act
      const outcome = parseIndicatorsFile(FILE_NAME, csvBytes([fields.join(";"), dataLine("OK", "OK", "1", "Si")]));

      // Assert
      expect(outcome.kind === ParseKind.CUT && outcome.cut.rejected.map((row) => row.reason)).toEqual([reason]);
    });

    it("should treat a dash surrounded by spaces or quotes as NULL", () => {
      // Arrange & Act
      const cut = parseCut([' - ;LOC;50;Si', '"-";LOC2;50;Si', dataLine("OK", "OK", "1", "Si")]);

      // Assert
      expect(cut.rejected.map((row) => row.reason)).toEqual([
        RejectionReason.emptyDepartamento(),
        RejectionReason.emptyDepartamento(),
      ]);
    });

    it("should keep a dash that is part of a longer value", () => {
      // Arrange & Act
      const cut = parseCut([dataLine("A-B", "SAN-JOSE", "50", "Si")]);

      // Assert
      expect(cut.rows[0]).toMatchObject({ departamento: "A-B", localidad: "SAN-JOSE" });
    });
  });

  describe("row rejection (AC-4)", () => {
    function rejectionsOf(...lines: string[]): string[] {
      const cut = parseCut([...lines, dataLine("KEEP", "KEEP", "1", "Si")]);
      return cut.rejected.map((row) => row.reason);
    }

    it.each([
      [3, "A;B;50"],
      [5, "A;B;50;Si;extra"],
      [5, "A;B;50;Si;"],
      [1, "A"],
    ])("should reject a row with %i columns", (found, line) => {
      // Arrange & Act
      const reasons = rejectionsOf(line);

      // Assert
      expect(reasons).toEqual([RejectionReason.columnCount(found)]);
      expect(reasons[0]).toBe(`Se esperaban 4 columnas y hay ${found}.`);
    });

    it.each(["abc", "91,3", "-5", ".5", "91.", "1e2", "50%", "5 0", "0x10", "+5", "NaN"])(
      "should reject a non-numeric percentage %j",
      (value) => {
        // Arrange & Act
        const reasons = rejectionsOf(dataLine("A", "B", value, "Si"));

        // Assert
        expect(reasons).toEqual([RejectionReason.porcentajeNotNumber(value)]);
      }
    );

    it.each(["0", "0.0", "100", "100.00", "99.99", "00012", "50.123456"])("should accept the percentage %j", (value) => {
      // Arrange & Act
      const cut = parseCut([dataLine("A", "B", value, "Si")]);

      // Assert
      expect(cut.rows[0].porcentaje).toBe(value);
      expect(cut.rejected).toEqual([]);
    });

    it.each(["100.01", "100.0001", "101", "999"])("should reject the percentage %s above 100", (value) => {
      // Arrange & Act
      const reasons = rejectionsOf(dataLine("A", "B", value, "Si"));

      // Assert
      expect(reasons).toEqual([RejectionReason.porcentajeOutOfRange(value)]);
      expect(reasons[0]).toBe(`El porcentaje ${value} supera el máximo de 100.`);
    });

    it.each(["Maybe", "S", "Sí", "SII", "1", ""])("should reject the Cobertura %j", (value) => {
      // Arrange & Act
      const reasons = rejectionsOf(dataLine("A", "B", "50", value));

      // Assert
      expect(reasons).toEqual([RejectionReason.coberturaInvalid(value)]);
    });

    it.each(["Si", "SI", "si", "sI", "No", "NO", "no", "nO"])("should accept the Cobertura %s case-insensitively", (value) => {
      // Arrange & Act
      const cut = parseCut([dataLine("A", "B", "50", value)]);

      // Assert
      expect(cut.rows).toHaveLength(1);
    });

    describe("name length boundaries", () => {
      it("should accept a departamento of exactly 15 characters and reject one of 16", () => {
        // Arrange
        const fifteen = "D".repeat(15);
        const sixteen = "D".repeat(16);

        // Act
        const cut = parseCut([dataLine(fifteen, "B", "50", "Si"), dataLine(sixteen, "C", "50", "Si")]);

        // Assert
        expect(cut.rows.map((row) => row.departamento)).toEqual([fifteen]);
        expect(cut.rejected.map((row) => row.reason)).toEqual([
          "El departamento tiene 16 caracteres y el máximo es 15.",
        ]);
      });

      it("should accept a localidad of exactly 40 characters and reject one of 41", () => {
        // Arrange
        const forty = "L".repeat(40);
        const fortyOne = "L".repeat(41);

        // Act
        const cut = parseCut([dataLine("A", forty, "50", "Si"), dataLine("A", fortyOne, "50", "Si")]);

        // Assert
        expect(cut.rows.map((row) => row.localidad)).toEqual([forty]);
        expect(cut.rejected.map((row) => row.reason)).toEqual([
          "La localidad tiene 41 caracteres y el máximo es 40.",
        ]);
      });

      it("should count the length after trimming", () => {
        // Arrange
        const padded = `  ${"D".repeat(15)}  `;

        // Act
        const cut = parseCut([dataLine(padded, "B", "50", "Si")]);

        // Assert
        expect(cut.rows).toHaveLength(1);
      });
    });

    it.each([
      ["an empty departamento", ";LOC;50;Si", RejectionReason.emptyDepartamento()],
      ["a blank departamento", "   ;LOC;50;Si", RejectionReason.emptyDepartamento()],
      ["an empty localidad", "DEP;;50;Si", RejectionReason.emptyLocalidad()],
      ["a blank localidad", "DEP;  ;50;Si", RejectionReason.emptyLocalidad()],
    ])("should reject a row with %s", (_label, line, reason) => {
      // Arrange & Act
      const reasons = rejectionsOf(line);

      // Assert
      expect(reasons).toEqual([reason]);
    });

    it("should report the empty-name problem before a percentage problem in the same row", () => {
      // Arrange & Act
      const reasons = rejectionsOf(";LOC;abc;Maybe");

      // Assert
      expect(reasons).toEqual([RejectionReason.emptyDepartamento()]);
    });

    it("should report a percentage problem before a Cobertura problem in the same row", () => {
      // Arrange & Act
      const reasons = rejectionsOf("DEP;LOC;abc;Maybe");

      // Assert
      expect(reasons).toEqual([RejectionReason.porcentajeNotNumber("abc")]);
    });

    it("should reject a row made only of separators as an empty departamento", () => {
      // Arrange & Act
      const reasons = rejectionsOf(";;;");

      // Assert
      expect(reasons).toEqual([RejectionReason.emptyDepartamento()]);
    });
  });

  describe("repeated key (AC-4)", () => {
    it("should keep the first occurrence and reject every later one, naming the first line", () => {
      // Arrange
      const lines = [
        dataLine("ARTIGAS", "ARTIGAS", "91.3", "Si"),
        dataLine("ARTIGAS", "OTRA", "10", "No"),
        dataLine("ARTIGAS", "ARTIGAS", "5", "No"),
        dataLine("ARTIGAS", "ARTIGAS", "6", "No"),
      ];

      // Act
      const cut = parseCut(lines);

      // Assert
      expect(cut.rows.map((row) => row.porcentaje)).toEqual(["91.3", "10"]);
      expect(cut.rejected.map((row) => [row.line, row.reason])).toEqual([
        [4, "El departamento y la localidad ya figuran en la línea 2; se conserva la primera."],
        [5, "El departamento y la localidad ya figuran en la línea 2; se conserva la primera."],
      ]);
    });

    it("should compare the trimmed values", () => {
      // Arrange & Act
      const cut = parseCut(["A;B;1;Si", " A ; B ;2;Si"]);

      // Assert
      expect(cut.rows).toHaveLength(1);
      expect(cut.rejected).toHaveLength(1);
    });

    it("should treat a different case as a different key", () => {
      // Arrange & Act
      const cut = parseCut(["ARTIGAS;X;1;Si", "Artigas;X;1;Si"]);

      // Assert
      expect(cut.rows).toHaveLength(2);
    });

    it("should not confuse keys whose concatenation is equal", () => {
      // Arrange & Act
      const cut = parseCut(["AB;C;1;Si", "A;BC;1;Si"]);

      // Assert
      expect(cut.rows).toHaveLength(2);
    });

    it("should let a later valid row claim the key when the earlier one was rejected for another reason", () => {
      // Arrange & Act
      const cut = parseCut(["A;B;abc;Si", "A;B;50;Si"]);

      // Assert
      expect(cut.rows.map((row) => row.porcentaje)).toEqual(["50"]);
      expect(cut.rejected.map((row) => row.line)).toEqual([2]);
    });
  });

  describe("physical line numbers and raw text (AC-4)", () => {
    it("should number the first data row 2 because the header is line 1", () => {
      // Arrange & Act
      const cut = parseCut(["A;B;abc;Si", "C;D;1;Si"]);

      // Assert
      expect(cut.rejected[0]).toMatchObject({ file: FILE_NAME, line: 2, text: "A;B;abc;Si" });
    });

    it("should count skipped blank lines in the numbering", () => {
      // Arrange & Act
      const cut = parseCut(["A;B;1;Si", "", "   ", "C;D;abc;Si"]);

      // Assert
      expect(cut.rows).toHaveLength(1);
      expect(cut.rejected.map((row) => row.line)).toEqual([5]);
    });

    it("should keep the raw record text untouched, without the line terminator", () => {
      // Arrange & Act
      const cut = parseCut(["  A ; B ;abc; Si ", "C;D;1;Si"], { eol: CRLF });

      // Assert
      expect(cut.rejected[0].text).toBe("  A ; B ;abc; Si ");
    });

    it("should keep the original quoted text and embedded line break of a rejected record", () => {
      // Arrange & Act
      const cut = parseCut(['"A\nB";LOC;abc;Si', "C;D;1;Si"]);

      // Assert
      expect(cut.rejected[0].text).toBe('"A\nB";LOC;abc;Si');
    });
  });

  describe("header (AC-2)", () => {
    it.each([
      ["a different header", "Algo;Distinto;Aqui;Mismo"],
      ["a one-column header", "solo"],
      ["an empty header line", ""],
    ])("should never validate the header: %s", (_label, header) => {
      // Arrange & Act
      const cut = parseCut(validDataLines(2), { header });

      // Assert
      expect(cut.rows).toHaveLength(2);
      expect(cut.rejected).toEqual([]);
    });

    it("should take a blank first line as the header and keep the physical line numbers of later rows", () => {
      // Arrange & Act
      const cut = parseCut(["A;B;1;Si", "C;D;abc;Si", "E;F;2;No"], { header: "" });

      // Assert
      expect(cut.rows.map((row) => row.departamento)).toEqual(["A", "E"]);
      expect(cut.rejected.map((row) => row.line)).toEqual([3]);
    });

    it("should skip the first line even when it looks like data", () => {
      // Arrange
      const bytes = latin1Bytes("A;B;50;Si\nC;D;60;No\n");

      // Act
      const outcome = parseIndicatorsFile(FILE_NAME, bytes);

      // Assert
      expect(outcome.kind === ParseKind.CUT && outcome.cut.rows.map((row) => row.departamento)).toEqual(["C"]);
    });
  });

  describe("blank lines (AC-2)", () => {
    it("should skip empty and whitespace-only lines", () => {
      // Arrange & Act
      const cut = parseCut(["", "A;B;1;Si", "  \t ", "", "C;D;2;No", ""]);

      // Assert
      expect(cut.rows).toHaveLength(2);
      expect(cut.rejected).toEqual([]);
    });
  });

  describe("file-level errors (AC-6)", () => {
    it("should reject a 0-byte file as having no data rows", () => {
      // Arrange & Act
      const message = parseError(new Uint8Array(0));

      // Assert
      expect(message).toBe(FileRejection.empty(FILE_NAME));
      expect(message).toBe(`El archivo "${FILE_NAME}" no tiene filas de datos.`);
    });

    it("should reject a file with only a header", () => {
      // Arrange & Act
      const message = parseError(csvBytes([]));

      // Assert
      expect(message).toBe(FileRejection.empty(FILE_NAME));
    });

    it("should reject a file whose rows after the header are all blank", () => {
      // Arrange & Act
      const message = parseError(csvBytes(["", "  ", ""]));

      // Assert
      expect(message).toBe(FileRejection.empty(FILE_NAME));
    });

    it("should reject a file whose every row is bad, counting the rejected rows", () => {
      // Arrange
      const bytes = csvBytes(["A;B;abc;Si", "A;B;50;Maybe", "short"]);

      // Act
      const message = parseError(bytes);

      // Assert
      expect(message).toBe(FileRejection.noValidRows(FILE_NAME, 3));
      expect(message).toBe(`El archivo "${FILE_NAME}" no tiene ninguna fila válida (3 rechazadas).`);
    });

    it("should build the oversize and unreadable messages with the file name", () => {
      // Arrange, Act & Assert
      expect(FileRejection.tooLarge("a.csv", 10)).toBe('El archivo "a.csv" supera el tamaño máximo de 10 bytes.');
      expect(FileRejection.unreadable("a.csv")).toBe('No se pudo leer el archivo "a.csv".');
    });
  });

  describe("partial files (AC-5)", () => {
    it("should still yield 612 good rows when 3 of 615 rows are bad", () => {
      // Arrange
      const lines = validDataLines(615);
      lines[10] = "BAD;ROW;abc;Si";
      lines[300] = "TOO;FEW";
      lines[614] = `${"X".repeat(16)};ROW;50;Si`;

      // Act
      const cut = parseCut(lines);

      // Assert
      expect(cut.rows).toHaveLength(612);
      expect(cut.rejected).toHaveLength(3);
      expect(cut.rejected.map((row) => row.line)).toEqual([12, 302, 616]);
      expect(cut.rows.some((row) => row.localidad === "LOCALIDAD 10")).toBe(false);
    });
  });
});
