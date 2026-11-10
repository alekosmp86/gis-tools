import { describe, it, expect } from "vitest";
import { readCsvRecords, type CsvRecord } from "@/core/services/server/csvReplace/csvRecordReader";

const read = (text: string, delimiter = ","): CsvRecord[] => Array.from(readCsvRecords([text], delimiter));

const readChunked = (chunks: string[], delimiter = ","): CsvRecord[] => Array.from(readCsvRecords(chunks, delimiter));

const fieldsOf = (records: CsvRecord[]): string[][] => records.map((record) => record.fields);

describe("csvRecordReader", () => {
  describe("CR-7: plain records", () => {
    it("should split fields on the delimiter and records on line feeds when the input is plain", () => {
      const records = read("a,b,c\n1,2,3\n");

      expect(fieldsOf(records)).toEqual([
        ["a", "b", "c"],
        ["1", "2", "3"],
      ]);
    });

    it("should yield the last record when the file has no final line break", () => {
      expect(fieldsOf(read("a,b\n1,2"))).toEqual([
        ["a", "b"],
        ["1", "2"],
      ]);
    });

    it("should yield nothing when the input is empty", () => {
      expect(read("")).toEqual([]);
    });

    it("should yield nothing when there are no chunks at all", () => {
      expect(Array.from(readCsvRecords([], ","))).toEqual([]);
    });

    it.each([
      [";", "a;b;c\n1;2;3"],
      ["\t", "a\tb\tc\n1\t2\t3"],
    ])("should honour the %j delimiter when it is given", (delimiter, text) => {
      expect(fieldsOf(read(text, delimiter))).toEqual([
        ["a", "b", "c"],
        ["1", "2", "3"],
      ]);
    });

    it("should keep commas as data when the delimiter is a semicolon", () => {
      expect(fieldsOf(read("a;1,5;c", ";"))).toEqual([["a", "1,5", "c"]]);
    });

    it("should yield empty strings for empty fields including a trailing delimiter", () => {
      expect(fieldsOf(read("a,,c,\n"))).toEqual([["a", "", "c", ""]]);
    });

    it("should yield two empty fields when the line holds only the delimiter", () => {
      expect(fieldsOf(read(",\n"))).toEqual([["", ""]]);
    });

    it("should keep a quote in the middle of an unquoted field as a literal character", () => {
      expect(fieldsOf(read('ab"c,d\n'))).toEqual([['ab"c', "d"]]);
    });

    it("should keep spaces around fields untouched", () => {
      expect(fieldsOf(read(" a , b \n"))).toEqual([[" a ", " b "]]);
    });
  });

  describe("CR-7: quotes", () => {
    it("should unwrap a quoted field and keep the delimiter inside it", () => {
      expect(fieldsOf(read('"a,b",c\n'))).toEqual([["a,b", "c"]]);
    });

    it("should turn a doubled quote inside a quoted field into one quote", () => {
      expect(fieldsOf(read('"say ""hi""",x\n'))).toEqual([['say "hi"', "x"]]);
    });

    it("should yield a single quote when the quoted field holds only a doubled quote", () => {
      expect(fieldsOf(read('""""\n'))).toEqual([['"']]);
    });

    it("should yield an empty field when the quoted field is empty", () => {
      expect(fieldsOf(read('"",x\n'))).toEqual([["", "x"]]);
    });

    it("should treat a line holding only an empty quoted field as a record", () => {
      expect(fieldsOf(read('""\n'))).toEqual([[""]]);
    });

    it("should keep line breaks embedded in a quoted field", () => {
      expect(fieldsOf(read('"l1\nl2\r\nl3",x\n'))).toEqual([["l1\nl2\r\nl3", "x"]]);
    });

    it("should accept a quoted field that closes right at the end of the file", () => {
      expect(fieldsOf(read('a,"b"'))).toEqual([["a", "b"]]);
    });

    it("should keep the delimiter inside quotes when the delimiter is a tab", () => {
      expect(fieldsOf(read('"a\tb"\tc', "\t"))).toEqual([["a\tb", "c"]]);
    });

    it("should throw a Spanish error naming the line where the quote opened when the quote is never closed", () => {
      expect(() => read('a,b\n1,"abierta\nmas texto\n')).toThrowError(/comilla abierta en la línea 2/);
    });

    it("should throw when the file ends right after an opening quote", () => {
      expect(() => read('"')).toThrowError(/línea 1/);
    });

    it("should throw only after yielding the records that precede the unclosed quote", () => {
      const iterator = readCsvRecords(['ok,1\nbad,"x'], ",");

      expect(iterator.next().value).toEqual({ line: 1, fields: ["ok", "1"] });
      expect(() => iterator.next()).toThrowError(/línea 2/);
    });
  });

  describe("CR-7: line breaks and blank lines", () => {
    it("should treat CRLF as one record separator", () => {
      expect(fieldsOf(read("a,b\r\n1,2\r\n"))).toEqual([
        ["a", "b"],
        ["1", "2"],
      ]);
    });

    it("should treat a lone CR as a record separator", () => {
      expect(fieldsOf(read("a,b\r1,2\r3,4"))).toEqual([
        ["a", "b"],
        ["1", "2"],
        ["3", "4"],
      ]);
    });

    it("should skip blank lines of every kind without yielding records", () => {
      expect(fieldsOf(read("a\n\n\r\n\ra2\n"))).toEqual([["a"], ["a2"]]);
    });

    it("should skip leading and trailing blank lines", () => {
      expect(fieldsOf(read("\n\na,b\n\n\n"))).toEqual([["a", "b"]]);
    });

    it("should yield nothing when the input is made only of line breaks", () => {
      expect(read("\n\r\n\r")).toEqual([]);
    });
  });

  describe("CR-7: line numbers", () => {
    it("should number records by physical line starting at 1", () => {
      expect(read("a\nb\nc\n").map((record) => record.line)).toEqual([1, 2, 3]);
    });

    it("should count blank lines when numbering the following records", () => {
      expect(read("a\n\n\nb\n").map((record) => record.line)).toEqual([1, 4]);
    });

    it("should count line breaks embedded in a quoted field when numbering the following records", () => {
      const records = read('"x\ny\nz",1\nnext\n');

      expect(records.map((record) => record.line)).toEqual([1, 4]);
    });

    it("should number lines the same for CRLF, LF and lone CR files", () => {
      const lf = read("a\nb\nc").map((record) => record.line);

      expect(read("a\r\nb\r\nc").map((record) => record.line)).toEqual(lf);
      expect(read("a\rb\rc").map((record) => record.line)).toEqual(lf);
    });
  });

  describe("CR-7: chunk boundaries", () => {
    const sample = 'id,nombre,nota\r\n1,"Ana, ""la"" mayor","l1\nl2"\r\n\r\n2,Beto,\r3,"",x';

    it("should yield the same records when the input is delivered one character at a time", () => {
      const expected = read(sample);

      const chunked = readChunked(Array.from(sample));

      expect(chunked).toEqual(expected);
    });

    it("should yield the same records for every possible two-way split of the input", () => {
      const expected = read(sample);

      for (let cut = 0; cut <= sample.length; cut += 1) {
        expect(readChunked([sample.slice(0, cut), sample.slice(cut)]), `cut ${cut}`).toEqual(expected);
      }
    });

    it("should not produce an extra record when a CRLF is split between two chunks", () => {
      expect(fieldsOf(readChunked(["a,b\r", "\n1,2"]))).toEqual([
        ["a", "b"],
        ["1", "2"],
      ]);
    });

    it("should keep a doubled quote split between two chunks as one quote", () => {
      expect(fieldsOf(readChunked(['"a"', '"b"\n']))).toEqual([['a"b']]);
    });

    it("should close a quoted field whose closing quote is the last character of a chunk", () => {
      expect(fieldsOf(readChunked(['"a"', ",b\n"]))).toEqual([["a", "b"]]);
    });

    it("should tolerate empty chunks between real chunks", () => {
      expect(fieldsOf(readChunked(["", "a,", "", "b\n", ""]))).toEqual([["a", "b"]]);
    });
  });
});
