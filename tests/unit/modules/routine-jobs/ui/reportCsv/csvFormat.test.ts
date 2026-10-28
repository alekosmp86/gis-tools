import { describe, expect, it } from "vitest";
import { toCsv } from "@/modules/routine-jobs/ui/reportCsv/csvFormat";
import { BOM, parseCsv } from "./reportCsvFixtures";

const bodyOf = (csv: string): string => csv.slice(BOM.length);

describe("toCsv", () => {
  describe("envelope", () => {
    it("should prefix the output with the UTF-8 BOM when rows are given", () => {
      const csv = toCsv([["a", "b"]]);

      expect(csv.startsWith(BOM)).toBe(true);
    });

    it("should return only the BOM when no rows are given", () => {
      expect(bodyOf(toCsv([]))).toBe("");
    });

    it("should separate rows with CRLF so that splitting on CRLF yields one line per row", () => {
      const csv = toCsv([
        ["a", "b"],
        ["c", "d"],
      ]);

      expect(bodyOf(csv).replace(/\r\n$/, "").split("\r\n")).toEqual(["a,b", "c,d"]);
    });

    it("should leave no bare LF in the output when no cell contains a line break", () => {
      const csv = toCsv([
        ["Sección", "Concepto"],
        ["Informe", "Modo"],
      ]);

      expect(bodyOf(csv).replace(/\r\n/g, "")).not.toContain("\n");
    });
  });

  describe("cell rendering", () => {
    it("should render a null cell as an empty field", () => {
      expect(bodyOf(toCsv([["a", null, "b"]]))).toBe("a,,b");
    });

    it("should render numbers as their string form without any prefix", () => {
      expect(bodyOf(toCsv([[0, 2.5, -5, 1234567]]))).toBe("0,2.5,-5,1234567");
    });

    it("should render an empty string as an empty field", () => {
      expect(bodyOf(toCsv([["", "x"]]))).toBe(",x");
    });

    it("should keep accented Spanish text unchanged", () => {
      expect(bodyOf(toCsv([["Simulación", "Sí"]]))).toBe("Simulación,Sí");
    });

    it("should not prefix text whose first character is a space before a trigger character", () => {
      expect(bodyOf(toCsv([[" =x"]]))).toBe(" =x");
    });

    it("should not prefix text in which a trigger character appears after the first character", () => {
      expect(bodyOf(toCsv([["a=b"]]))).toBe("a=b");
    });
  });

  describe("quoting", () => {
    it("should wrap a cell containing a comma in double quotes", () => {
      expect(bodyOf(toCsv([["Norte, sur"]]))).toBe('"Norte, sur"');
    });

    it("should wrap a cell containing a double quote in quotes and double the inner quote", () => {
      expect(bodyOf(toCsv([['say "hi"']]))).toBe('"say ""hi"""');
    });

    it("should wrap a cell containing a line feed in quotes and keep the line feed", () => {
      const csv = toCsv([["línea 1\nlínea 2", "x"]]);

      expect(bodyOf(csv)).toBe('"línea 1\nlínea 2",x');
      expect(parseCsv(csv)).toEqual([["línea 1\nlínea 2", "x"]]);
    });

    it("should wrap a cell containing a carriage return in quotes", () => {
      expect(bodyOf(toCsv([["a\rb"]]))).toBe('"a\rb"');
    });

    it("should escape a cell containing both a comma and a quote", () => {
      expect(bodyOf(toCsv([['Villa "Los Pinos", norte']]))).toBe('"Villa ""Los Pinos"", norte"');
    });
  });

  describe("formula injection guard", () => {
    it.each([
      ["=SUM(A1:A2)", "'=SUM(A1:A2)"],
      ["+1", "'+1"],
      ["-2", "'-2"],
      ["@cmd", "'@cmd"],
      ["\tcmd", "'\tcmd"],
    ])("should prefix text %j with an apostrophe", (input, expected) => {
      expect(parseCsv(toCsv([[input]]))).toEqual([[expected]]);
    });

    it("should prefix text starting with a carriage return with an apostrophe", () => {
      expect(parseCsv(toCsv([["\rcmd"]]))).toEqual([["'\rcmd"]]);
    });

    it("should prefix a text cell that holds a negative number as text", () => {
      expect(parseCsv(toCsv([["-5"]]))).toEqual([["'-5"]]);
    });

    it("should leave a numeric negative cell unprefixed", () => {
      expect(parseCsv(toCsv([[-5]]))).toEqual([["-5"]]);
    });

    it("should prefix and quote a trigger text that also contains a comma", () => {
      expect(bodyOf(toCsv([["=A(1,2)"]]))).toBe('"\'=A(1,2)"');
    });
  });

  describe("round trip", () => {
    it("should parse back to the same cells for mixed plain, quoted, multi-line and null cells", () => {
      const rows = [
        ["Sección", "Concepto", "Valor", "Detalle"],
        ["Informe", "Etapa", "Cargar padrones", null],
        ["Advertencias", "Advertencia", null, 'Revisar "A", B\nlínea dos'],
        ["Muestras", "Localidad, sin código", 12, "Sin geometría"],
      ];

      expect(parseCsv(toCsv(rows))).toEqual([
        ["Sección", "Concepto", "Valor", "Detalle"],
        ["Informe", "Etapa", "Cargar padrones", ""],
        ["Advertencias", "Advertencia", "", 'Revisar "A", B\nlínea dos'],
        ["Muestras", "Localidad, sin código", "12", "Sin geometría"],
      ]);
    });
  });
});
