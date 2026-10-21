import { describe, expect, it } from "vitest";
import { AVANCE_COLUMNS, AvanceColumnKey, AvanceFileKind, REJECTED_LIST_CAP } from "@/modules/coverage-loads/avance-ftth/constants";
import { parseAvanceFile } from "@/modules/coverage-loads/avance-ftth/domain/csvAvance";
import { tokenizeRecords } from "@/modules/coverage-loads/avance-ftth/domain/csvTokenizer";
import { decodeLatin1, encodeLatin1 } from "@/modules/coverage-loads/shared/domain/latin1";
import { ParseKind, type ParsedAvanceFile } from "@/modules/coverage-loads/avance-ftth/types";
import { fixtureBytes, latin1 } from "./avanceHarness";

const INT_NAME = "SituacionFTTH_INT_21092026.csv";
const UDPEM_NAME = "SituacionFTTH_UDPEM_21092026.csv";
const HEADER = "central;cable;zona;empresa;plano_al_com;ejecutor;director_obra;etiqueta;conca;edificio";
const GOOD_LINE = "MERCEDES;01;01;Gofinal;03/10/2012;DURLEX;Arean;EJECUTADA;MERCEDESC01ZONA 01;SORMRCDS01";

function fields(overrides: Partial<Record<string, string>> = {}): string {
  const base: Record<string, string> = {
    central: "MERCEDES",
    cable: "01",
    zona: "01",
    empresa: "Gofinal",
    plano_al_com: "03/10/2012",
    ejecutor: "DURLEX",
    director: "Arean",
    etiqueta: "EJECUTADA",
    conca: "MERCEDESC01ZONA 01",
    edificio: "SORMRCDS01",
    ...overrides,
  };
  return AVANCE_COLUMNS.map((column) => base[column.key]).join(";");
}

function parse(lines: ReadonlyArray<string>, fileName = INT_NAME, separator = "\r\n"): ParsedAvanceFile {
  const outcome = parseAvanceFile(fileName, latin1(lines.join(separator)));
  if (outcome.kind !== ParseKind.FILE) throw new Error(`unexpected file error: ${outcome.error.message}`);
  return outcome.file;
}

describe("avance-ftth CSV parsing", () => {
  describe("file level (AC-1, AC-6)", () => {
    it("should return a file error and read nothing when the name is invalid", () => {
      // Arrange & Act
      const outcome = parseAvanceFile("SituacionFTTH_INT_31022026.csv", latin1([HEADER, GOOD_LINE].join("\n")));

      // Assert
      expect(outcome.kind).toBe(ParseKind.ERROR);
      if (outcome.kind === ParseKind.ERROR) {
        expect(outcome.error.fileName).toBe("SituacionFTTH_INT_31022026.csv");
        expect(outcome.error.message).toContain("no tiene un nombre válido");
      }
    });

    it("should take fechaact from the 8 digits of the name as text for both kinds (AC-6)", () => {
      // Arrange & Act
      const interior = parse([HEADER, GOOD_LINE], "SituacionFTTH_INT_03012027.csv");
      const montevideo = parse([HEADER, GOOD_LINE], "SituacionFTTH_UDPEM_21092026.csv");

      // Assert
      expect(interior).toMatchObject({ kind: AvanceFileKind.INT, fechaact: "03012027", fileName: "SituacionFTTH_INT_03012027.csv" });
      expect(montevideo).toMatchObject({ kind: AvanceFileKind.UDPEM, fechaact: "21092026" });
    });

    it("should read zero rows from an empty file and from a header-only file", () => {
      // Arrange & Act
      const empty = parseAvanceFile(INT_NAME, new Uint8Array(0));
      const headerOnly = parse([HEADER]);

      // Assert
      expect(empty.kind).toBe(ParseKind.FILE);
      if (empty.kind === ParseKind.FILE) expect(empty.file).toMatchObject({ rowsRead: 0, rows: [], rejectedTotal: 0 });
      expect(headerOnly).toMatchObject({ rowsRead: 0, rows: [], rejectedTotal: 0 });
    });
  });

  describe("records (AC-2)", () => {
    it("should skip the header without validating it, even when it is not the expected header", () => {
      // Arrange
      const weirdHeader = "esto;no;es;la;cabecera";

      // Act
      const file = parse([weirdHeader, GOOD_LINE]);

      // Assert
      expect(file.rowsRead).toBe(1);
      expect(file.rows[0].central).toBe("MERCEDES");
      expect(file.rejectedTotal).toBe(0);
    });

    it.each([
      ["CRLF", "\r\n"],
      ["LF", "\n"],
      ["lone CR", "\r"],
    ])("should read the same rows with %s line endings", (_label, separator) => {
      // Arrange
      const lines = [HEADER, fields({ cable: "01" }), fields({ cable: "02" }), fields({ cable: "03" })];

      // Act
      const file = parse(lines, INT_NAME, separator);

      // Assert
      expect(file.rows.map((row) => row.cable)).toEqual(["01", "02", "03"]);
    });

    it("should read a file that mixes CRLF and LF and has no final line ending", () => {
      // Arrange
      const text = `${HEADER}\r\n${fields({ cable: "01" })}\n${fields({ cable: "02" })}`;

      // Act
      const outcome = parseAvanceFile(INT_NAME, latin1(text));

      // Assert
      expect(outcome.kind === ParseKind.FILE && outcome.file.rows.map((row) => row.cable)).toEqual(["01", "02"]);
    });

    it("should skip blank and whitespace-only lines and not count them as rows read", () => {
      // Arrange
      const lines = [HEADER, "", fields(), "   ", " ", fields({ cable: "02" }), "", ""];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rowsRead).toBe(2);
      expect(file.rows).toHaveLength(2);
      expect(file.rejectedTotal).toBe(0);
    });

    it("should round-trip ISO-8859-1 accents byte for byte", () => {
      // Arrange
      const line = fields({ director: "Saldaña", ejecutor: "Piñeyro Ñandú", empresa: "Ángel Ü ÿ" });
      const bytes = latin1([HEADER, line].join("\r\n"));
      expect(Array.from(bytes)).toContain(0xf1);

      // Act
      const outcome = parseAvanceFile(INT_NAME, bytes);

      // Assert
      expect(outcome.kind === ParseKind.FILE && outcome.file.rows[0]).toMatchObject({
        director: "Saldaña",
        ejecutor: "Piñeyro Ñandú",
        empresa: "Ángel Ü ÿ",
      });
    });

    it("should decode every byte value as the code point of the same value (not windows-1252)", () => {
      // Arrange
      const everyByte = Uint8Array.from({ length: 256 }, (_, value) => value);

      // Act
      const text = decodeLatin1(everyByte);

      // Assert
      expect([...text].map((char) => char.charCodeAt(0))).toEqual(Array.from({ length: 256 }, (_, value) => value));
      expect(Array.from(encodeLatin1(text))).toEqual(Array.from(everyByte));
    });

    it("should decode a buffer larger than one decoding chunk", () => {
      // Arrange
      const bytes = new Uint8Array(20000).fill(0xe9);

      // Act
      const text = decodeLatin1(bytes);

      // Assert
      expect(text).toHaveLength(20000);
      expect(text.startsWith("éé")).toBe(true);
    });

    it("should read a quoted field that holds the separator and an escaped quote, and reject a line break inside a field line by line", () => {
      // Arrange
      const quoted = `"MERC;EDES";01;01;Gofinal;03/10/2012;DURLEX;"Are""an";EJECUTADA;CONCA;SORMRCDS01`;
      const broken = [`MERCEDES;01;01;Gofinal;03/10/2012;DURLEX;Arean;EJECUTADA;"CONCA`, `DOS";SORMRCDS01`];

      // Act
      const file = parse([HEADER, quoted, ...broken], INT_NAME, "\n");

      // Assert
      expect(file.rows).toHaveLength(1);
      expect(file.rows[0]).toMatchObject({ central: "MERC;EDES", director: 'Are"an' });
      expect(file.rejected.map((row) => [row.line, row.reason])).toEqual([
        [3, "comilla sin cerrar."],
        [4, "Se esperaban 10 columnas y hay 2."],
      ]);
    });

    it("should reject only the physical line with a stray quote and load the following lines even when a later line has a quoted field", () => {
      // Arrange
      const stray = 'D;"oops;1;Si';
      const lines = [HEADER, fields({ cable: "01" }), stray, fields({ cable: "02" }), fields({ cable: "03", conca: '"CUATRO"' }), fields({ cable: "04" })];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rejected).toEqual([{ file: INT_NAME, line: 3, text: stray, reason: "comilla sin cerrar." }]);
      expect(file.rows.map((row) => row.cable)).toEqual(["01", "02", "03", "04"]);
      expect(file.rows[2].conca).toBe("CUATRO");
    });

    it("should accept quoted fields in the Interior file as well as in UDPEM", () => {
      // Arrange
      const quoted = `"MERCEDES";"01";"01";"Gofinal";"03/10/2012";"DURLEX";"Arean";"EJECUTADA";"CONCA";"SORMRCDS01"`;

      // Act
      const interior = parse([HEADER, quoted], INT_NAME);
      const montevideo = parse([HEADER, quoted], UDPEM_NAME);

      // Assert
      expect(interior.rows[0].central).toBe("MERCEDES");
      expect(montevideo.rows[0].edificio).toBe("SORMRCDS01");
    });

    it("should reject a field that spans lines one physical line at a time and keep the physical line number of later rows", () => {
      // Arrange
      const first = `MERCEDES;01;01;Gofinal;03/10/2012;DURLEX;Arean;EJECUTADA;"UNO`;
      const second = `DOS";SORMRCDS01`;
      const lines = [HEADER, first, second, "solo;dos;columnas"];

      // Act
      const file = parse(lines, INT_NAME, "\n");

      // Assert
      expect(file.rowsRead).toBe(3);
      expect(file.rows).toHaveLength(0);
      expect(file.rejected).toEqual([
        { file: INT_NAME, line: 2, text: first, reason: "comilla sin cerrar." },
        { file: INT_NAME, line: 3, text: second, reason: "Se esperaban 10 columnas y hay 2." },
        { file: INT_NAME, line: 4, text: "solo;dos;columnas", reason: "Se esperaban 10 columnas y hay 3." },
      ]);
    });

    it("should reject a row with an unterminated quote and keep the rest", () => {
      // Arrange
      const lines = [HEADER, fields(), `MERCEDES;01;01;"sin cerrar;x;y;z;a;b;c`];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rows).toHaveLength(1);
      expect(file.rejected).toHaveLength(1);
      expect(file.rejected[0].reason).toBe("comilla sin cerrar.");
      expect(file.rejected[0].line).toBe(3);
    });

    it("should confine an unterminated quote to its own physical line and keep loading the rows after it", () => {
      // Arrange
      const lines = [
        HEADER,
        fields({ cable: "01" }),
        `MERCEDES;01;01;"sin cerrar;x;y;z;a;b;c`,
        fields({ cable: "02" }),
        fields({ cable: "03" }),
      ];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rowsRead).toBe(4);
      expect(file.rows.map((row) => row.cable)).toEqual(["01", "02", "03"]);
      expect(file.rejectedTotal).toBe(1);
      expect(file.rejected).toEqual([
        { file: INT_NAME, line: 3, text: `MERCEDES;01;01;"sin cerrar;x;y;z;a;b;c`, reason: "comilla sin cerrar." },
      ]);
    });

    it.each([
      ["CRLF", "\r\n"],
      ["LF", "\n"],
    ])("should resume at the next line after an unterminated quote with %s line endings and keep later line numbers", (_label, separator) => {
      // Arrange
      const lines = [HEADER, `"abierta;sin;cerrar`, fields({ cable: "02" }), "solo;dos", fields({ cable: "04" })];

      // Act
      const file = parse(lines, UDPEM_NAME, separator);

      // Assert
      expect(file.rows.map((row) => row.cable)).toEqual(["02", "04"]);
      expect(file.rejected.map((row) => [row.line, row.reason])).toEqual([
        [2, "comilla sin cerrar."],
        [4, "Se esperaban 10 columnas y hay 2."],
      ]);
    });

    it("should reject a field spanning lines line by line and load the valid lines around it and after a later unterminated quote", () => {
      // Arrange
      const first = `MERCEDES;01;01;Gofinal;03/10/2012;DURLEX;Arean;EJECUTADA;"UNO`;
      const second = `DOS";SORMRCDS01`;
      const lines = [HEADER, fields({ cable: "01" }), first, second, fields({ cable: "03" }), `MERCEDES;"sin cerrar`, fields({ cable: "05" })];

      // Act
      const file = parse(lines, INT_NAME, "\n");

      // Assert
      expect(file.rows.map((row) => row.cable)).toEqual(["01", "03", "05"]);
      expect(file.rejected.map((row) => [row.line, row.reason])).toEqual([
        [3, "comilla sin cerrar."],
        [4, "Se esperaban 10 columnas y hay 2."],
        [6, "comilla sin cerrar."],
      ]);
      expect(file.rejected[0].text).toBe(first);
      expect(file.rejected[1].text).toBe(second);
    });

    it("should still accept escaped quotes and quotes closed within the same line", () => {
      // Arrange
      const lines = [HEADER, fields({ conca: `"CON ""X"" Y"` }), fields({ conca: `"CERRADA"`, cable: "02" })];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rejected).toEqual([]);
      expect(file.rows.map((row) => row.conca)).toEqual(['CON "X" Y', "CERRADA"]);
    });

    it("should reject a row that holds a NUL character", () => {
      // Arrange
      const lines = [HEADER, fields({ conca: "CON\u0000CA" })];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rows).toHaveLength(0);
      expect(file.rejected[0]).toMatchObject({ line: 2, reason: "contiene un carácter nulo (NUL)." });
    });
  });

  describe("column count (AC-2)", () => {
    it.each([
      ["9", "a;b;c;d;e;f;g;h;i", 9],
      ["11", "a;b;c;d;e;f;g;h;i;j;k", 11],
      ["1", "una sola columna", 1],
      ["12 (a trailing separator after a filled 11th)", "a;b;c;d;e;f;g;h;i;j;k;", 12],
    ])("should reject a row with %s columns and cite its line", (_label, line, found) => {
      // Arrange
      const lines = [HEADER, fields(), line, fields({ cable: "02" })];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rowsRead).toBe(3);
      expect(file.rows).toHaveLength(2);
      expect(file.rejectedTotal).toBe(1);
      expect(file.rejected[0]).toEqual({
        file: INT_NAME,
        line: 3,
        text: line,
        reason: `Se esperaban 10 columnas y hay ${found}.`,
      });
    });

    it.each([
      ["Interior", INT_NAME],
      ["UDPEM", UDPEM_NAME],
    ])("should accept a %s row with an empty 11th column (a trailing separator) as a 10-column row", (_label, fileName) => {
      // Arrange
      const lines = [HEADER, `${fields()};`, `${fields({ cable: "02" })};`, fields({ cable: "03" })];

      // Act
      const file = parse(lines, fileName);

      // Assert
      expect(file.rowsRead).toBe(3);
      expect(file.rejectedTotal).toBe(0);
      expect(file.rows.map((row) => row.cable)).toEqual(["01", "02", "03"]);
      expect(file.rows[0]).toMatchObject({ central: "MERCEDES", edificio: "SORMRCDS01" });
    });

    it.each([
      ["Interior", INT_NAME],
      ["UDPEM", UDPEM_NAME],
    ])("should still reject a %s row whose 11th column holds a value", (_label, fileName) => {
      // Arrange
      const line = `${fields()};sobrante`;

      // Act
      const file = parse([HEADER, line], fileName);

      // Assert
      expect(file.rows).toHaveLength(0);
      expect(file.rejected[0]).toEqual({
        file: fileName,
        line: 2,
        text: line,
        reason: "Se esperaban 10 columnas y hay 11.",
      });
    });

    it("should keep rejecting a 9-column row next to accepted trailing-separator rows", () => {
      // Arrange
      const lines = [HEADER, `${fields()};`, "a;b;c;d;e;f;g;h;i"];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rows).toHaveLength(1);
      expect(file.rejected).toEqual([
        { file: INT_NAME, line: 3, text: "a;b;c;d;e;f;g;h;i", reason: "Se esperaban 10 columnas y hay 9." },
      ]);
    });

    it("should report the physical line of a bad row after blank lines", () => {
      // Arrange
      const lines = [HEADER, "", fields(), "", "malo;malo"];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rejected[0].line).toBe(5);
    });
  });

  describe("trimming and nulls (AC-3)", () => {
    it("should trim every field including the non-breaking space the legacy trim left in the data", () => {
      // Arrange
      const line = fields({ plano_al_com: " 03/10/2012 ", central: "  MERCEDES  ", conca: "\t CONCA \t" });

      // Act
      const file = parse([HEADER, line]);

      // Assert
      expect(file.rows[0]).toMatchObject({ plano_al_com: "03/10/2012", central: "MERCEDES", conca: "CONCA" });
    });

    it("should turn empty and whitespace-only fields into null", () => {
      // Arrange
      const line = fields({ empresa: "", ejecutor: "   ", director: "  " });

      // Act
      const file = parse([HEADER, line]);

      // Assert
      expect(file.rows[0]).toMatchObject({ empresa: null, ejecutor: null, director: null });
    });

    it("should turn the exact value - into null in the Interior file only", () => {
      // Arrange
      const line = fields({ ejecutor: "-", director: " - ", etiqueta: "--", empresa: "-x" });

      // Act
      const interior = parse([HEADER, line], INT_NAME);
      const montevideo = parse([HEADER, line], UDPEM_NAME);

      // Assert
      expect(interior.rows[0]).toMatchObject({ ejecutor: null, director: null, etiqueta: "--", empresa: "-x" });
      expect(montevideo.rows[0]).toMatchObject({ ejecutor: "-", director: "-", etiqueta: "--", empresa: "-x" });
    });

    it("should turn the exact value - into null in every Interior column except plano_al_com (legacy nullif is empty for that field)", () => {
      // Arrange
      const line = AVANCE_COLUMNS.map(() => "-").join(";");

      // Act
      const file = parse([HEADER, line], INT_NAME);

      // Assert
      const expected = Object.fromEntries(
        AVANCE_COLUMNS.map((column) => [column.key, column.key === AvanceColumnKey.PLANO_AL_COM ? "-" : null])
      );
      expect(file.rows).toHaveLength(1);
      expect(file.rows[0]).toEqual(expected);
    });

    it("should keep - in plano_al_com of an Interior row after trimming, and still null an empty plano_al_com", () => {
      // Arrange
      const lines = [HEADER, fields({ plano_al_com: " - " }), fields({ plano_al_com: "" })];

      // Act
      const file = parse(lines, INT_NAME);

      // Assert
      expect(file.rows.map((row) => row.plano_al_com)).toEqual(["-", null]);
    });

    it("should never turn - into null in the UDPEM file, plano_al_com included", () => {
      // Arrange
      const line = AVANCE_COLUMNS.map(() => "-").join(";");

      // Act
      const file = parse([HEADER, line], UDPEM_NAME);

      // Assert
      expect(file.rows[0]).toEqual(Object.fromEntries(AVANCE_COLUMNS.map((column) => [column.key, "-"])));
    });

    it.each(["3/9/2020", "03/09/2020", "2020-09-03", "9-3-20", "mañana"])("should not reformat the date text %j", (date) => {
      // Arrange
      const line = fields({ plano_al_com: date });

      // Act
      const file = parse([HEADER, line]);

      // Assert
      expect(file.rows[0].plano_al_com).toBe(date);
    });

    it("should clean nothing else: case, inner spaces and zeros are kept", () => {
      // Arrange
      const line = fields({ cable: "007", zona: "Primario", conca: "Ab  Cd", edificio: "abc01" });

      // Act
      const file = parse([HEADER, line]);

      // Assert
      expect(file.rows[0]).toMatchObject({ cable: "007", zona: "Primario", conca: "Ab  Cd", edificio: "abc01" });
    });
  });

  describe("length limits (AC-4)", () => {
    it.each([
      ["central", 100],
      ["cable", 50],
      ["zona", 50],
      ["empresa", 50],
      ["plano_al_com", 50],
      ["ejecutor", 50],
      ["director", 50],
      ["etiqueta", 50],
      ["conca", 100],
      ["edificio", 20],
    ])("should accept %s at exactly %i characters and reject it at one more", (column, limit) => {
      // Arrange
      const atLimit = fields({ [column]: "x".repeat(limit) });
      const overLimit = fields({ [column]: "x".repeat(limit + 1) });

      // Act
      const file = parse([HEADER, atLimit, overLimit]);

      // Assert
      expect(file.rows).toHaveLength(1);
      expect(file.rejected).toHaveLength(1);
      expect(file.rejected[0]).toMatchObject({
        line: 3,
        reason: `El campo ${column} tiene ${limit + 1} caracteres y el máximo es ${limit}.`,
      });
    });

    it("should measure the length after trimming", () => {
      // Arrange
      const padded = fields({ edificio: `${"x".repeat(20)}   ` });

      // Act
      const file = parse([HEADER, padded]);

      // Assert
      expect(file.rows).toHaveLength(1);
      expect(file.rows[0].edificio).toHaveLength(20);
    });

    it("should list at most 200 rejected rows while counting every one", () => {
      // Arrange
      const bad = Array.from({ length: 250 }, (_, index) => `fila;${index}`);
      const lines = [HEADER, fields(), ...bad];

      // Act
      const file = parse(lines);

      // Assert
      expect(REJECTED_LIST_CAP).toBe(200);
      expect(file.rowsRead).toBe(251);
      expect(file.rejectedTotal).toBe(250);
      expect(file.rejected).toHaveLength(200);
      expect(file.rejected[0].line).toBe(3);
      expect(file.rejected[199].text).toBe("fila;199");
    });

    it("should list exactly 200 when there are exactly 200 rejected rows", () => {
      // Arrange
      const bad = Array.from({ length: 200 }, (_, index) => `fila;${index}`);

      // Act
      const file = parse([HEADER, ...bad]);

      // Assert
      expect(file.rejectedTotal).toBe(200);
      expect(file.rejected).toHaveLength(200);
    });

    it("should truncate a very long rejected line in the list with an ellipsis", () => {
      // Arrange
      const long = `x;${"y".repeat(900)}`;

      // Act
      const file = parse([HEADER, long]);

      // Assert
      expect(file.rejected[0].text).toBe(`${long.slice(0, 500)}…`);
      expect(file.rejected[0].text.length).toBe(501);
    });
  });

  describe("junk, #N/A and duplicates (AC-5, AC-8)", () => {
    it("should load junk CZONA rows and count them instead of rejecting them", () => {
      // Arrange
      const junk = ";;;;;;;0;CZONA ;#N/A";
      const lines = [HEADER, fields(), junk, junk, junk];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rows).toHaveLength(4);
      expect(file.junkRows).toBe(3);
      expect(file.rejectedTotal).toBe(0);
    });

    it("should count a conca of CZONA that only becomes junk after trimming (' CZONA  ')", () => {
      // Arrange
      const odd = " ;; ;;;;;0; CZONA  ;#N/A";

      // Act
      const file = parse([HEADER, odd]);

      // Assert
      expect(file.rows).toHaveLength(1);
      expect(file.rows[0].conca).toBe("CZONA");
      expect(file.junkRows).toBe(1);
    });

    it("should not count a conca that merely contains CZONA in the middle as junk", () => {
      // Arrange
      const lines = [HEADER, fields({ conca: "XCZONA" }), fields({ conca: "CZONA 07" }), fields({ conca: "czona" })];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.junkRows).toBe(1);
    });

    it("should count empty and #N/A edificio rows as warnings but still load them", () => {
      // Arrange
      const lines = [HEADER, fields({ edificio: "#N/A" }), fields({ edificio: "" }), fields({ edificio: "  " }), fields()];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.rows).toHaveLength(4);
      expect(file.emptyEdificioRows).toBe(3);
    });

    it("should count distinct duplicate (edificio, cable, zona) keys once however often they repeat", () => {
      // Arrange
      const same = fields({ edificio: "AAA", cable: "01", zona: "01" });
      const other = fields({ edificio: "BBB", cable: "01", zona: "01" });
      const lines = [HEADER, same, same, same, other, other, fields({ edificio: "CCC" })];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.duplicateKeys).toBe(2);
    });

    it.each(["DO", "Primario", "PRIMARIO"])("should leave zona %s out of the duplicate keys", (zona) => {
      // Arrange
      const repeated = fields({ zona });

      // Act
      const file = parse([HEADER, repeated, repeated]);

      // Assert
      expect(file.duplicateKeys).toBe(0);
    });

    it("should count zona spelled primario in lower case as a duplicate key (only DO, Primario and PRIMARIO are excluded)", () => {
      // Arrange
      const repeated = fields({ zona: "primario" });

      // Act
      const file = parse([HEADER, repeated, repeated]);

      // Assert
      expect(file.duplicateKeys).toBe(1);
    });

    it("should tell keys apart by cable and by zona", () => {
      // Arrange
      const lines = [HEADER, fields({ cable: "01" }), fields({ cable: "02" }), fields({ zona: "02" })];

      // Act
      const file = parse(lines);

      // Assert
      expect(file.duplicateKeys).toBe(0);
    });

    it("should leave rows with a null key part out of the duplicate keys (implementation choice, pinned)", () => {
      // Arrange
      const noEdificio = fields({ edificio: "" });
      const noCable = fields({ cable: "" });
      const noZona = fields({ zona: "" });

      // Act
      const file = parse([HEADER, noEdificio, noEdificio, noCable, noCable, noZona, noZona]);

      // Assert
      expect(file.duplicateKeys).toBe(0);
    });
  });

  describe("tokenizer", () => {
    it("should give an empty file no records", () => {
      // Arrange & Act & Assert
      expect(tokenizeRecords("")).toEqual([]);
    });

    it("should keep the raw text and starting line of each record", () => {
      // Arrange & Act
      const records = tokenizeRecords("a;b\r\nc;d\ne;f");

      // Assert
      expect(records.map((record) => [record.line, record.raw, record.fields])).toEqual([
        [1, "a;b", ["a", "b"]],
        [2, "c;d", ["c", "d"]],
        [3, "e;f", ["e", "f"]],
      ]);
    });

    it("should end an unterminated quote at its own line and start the next record on the following line", () => {
      // Arrange & Act
      const records = tokenizeRecords('a;b\n"sin cerrar;x\nc;d\ne;f');

      // Assert
      expect(records.map((record) => [record.line, record.raw, record.unterminatedQuote])).toEqual([
        [1, "a;b", false],
        [2, '"sin cerrar;x', true],
        [3, "c;d", false],
        [4, "e;f", false],
      ]);
      expect(records[2].fields).toEqual(["c", "d"]);
      expect(records[3].fields).toEqual(["e", "f"]);
    });

    it.each([
      ["LF", "\n"],
      ["CRLF", "\r\n"],
      ["CR", "\r"],
    ])("should split a quote that spans lines into one record per physical line with %s", (_label, separator) => {
      // Arrange & Act
      const records = tokenizeRecords(['a;"uno', 'dos";b', "c;d"].join(separator));

      // Assert
      expect(records.map((record) => [record.line, record.raw, record.unterminatedQuote])).toEqual([
        [1, 'a;"uno', true],
        [2, 'dos";b', false],
        [3, "c;d", false],
      ]);
      expect(records[1].fields).toEqual(['dos"', "b"]);
      expect(records[2].fields).toEqual(["c", "d"]);
    });

    it("should never put a line break inside a field or a raw record", () => {
      // Arrange & Act
      const records = tokenizeRecords('a;"x\ny;"z\r\nw";"q""r"\n"s;t');

      // Assert
      for (const record of records) {
        expect(record.raw).not.toMatch(/[\r\n]/);
        for (const field of record.fields) expect(field).not.toMatch(/[\r\n]/);
      }
      expect(records.map((record) => record.line)).toEqual([1, 2, 3, 4]);
    });

    it("should treat a quote in the middle of a field as plain text", () => {
      // Arrange & Act
      const records = tokenizeRecords('ab"cd;ef');

      // Assert
      expect(records[0].fields).toEqual(['ab"cd', "ef"]);
      expect(records[0].unterminatedQuote).toBe(false);
    });
  });

  describe("the real sample slices (AC-2 .. AC-6, AC-8)", () => {
    it("should parse the Interior slice with the expected counts, nulls and untouched dates", () => {
      // Arrange
      const bytes = fixtureBytes(INT_NAME);

      // Act
      const outcome = parseAvanceFile(INT_NAME, bytes);

      // Assert
      expect(outcome.kind).toBe(ParseKind.FILE);
      if (outcome.kind !== ParseKind.FILE) return;
      const { file } = outcome;
      expect(file).toMatchObject({
        kind: AvanceFileKind.INT,
        fechaact: "21092026",
        rowsRead: 19,
        rejectedTotal: 0,
        junkRows: 4,
        emptyEdificioRows: 7,
        duplicateKeys: 1,
      });
      expect(file.rows).toHaveLength(19);
      expect(file.rows[6].ejecutor).toBeNull();
      expect(file.rows[7]).toMatchObject({ director: "Saldaña", empresa: "Gofinal", plano_al_com: null });
      expect(file.rows[8].plano_al_com).toBe("07/08/2020");
      expect(file.rows[9].plano_al_com).toBe("3/9/2020");
      expect(file.rows[1].conca).toBe("MERCEDESC02ZONA Primario");
    });

    it("should count the whitespace-padded CZONA row of the INT sample as junk (so the full sample yields 900, not the 899 of the spec text)", () => {
      // Arrange
      const bytes = fixtureBytes(INT_NAME);

      // Act
      const outcome = parseAvanceFile(INT_NAME, bytes);

      // Assert: 3 plain rows + the padded ' ;; ;;;;;0; CZONA  ;#N/A' row (899 plain + this one = 900 in the full sample)
      expect(outcome.kind === ParseKind.FILE && outcome.file.rows.filter((row) => row.conca === "CZONA")).toHaveLength(4);
      expect(outcome.kind === ParseKind.FILE && outcome.file.junkRows).toBe(4);
    });

    it("should parse the UDPEM slice keeping the -- markers and flagging its duplicate key", () => {
      // Arrange
      const bytes = fixtureBytes(UDPEM_NAME);

      // Act
      const outcome = parseAvanceFile(UDPEM_NAME, bytes);

      // Assert
      expect(outcome.kind).toBe(ParseKind.FILE);
      if (outcome.kind !== ParseKind.FILE) return;
      const { file } = outcome;
      expect(file).toMatchObject({
        kind: AvanceFileKind.UDPEM,
        rowsRead: 13,
        rejectedTotal: 0,
        junkRows: 3,
        emptyEdificioRows: 3,
        duplicateKeys: 1,
      });
      expect(file.rows[0].ejecutor).toBe("--");
      expect(file.rows[7].director).toBe("Piñeyro");
    });
  });
});
