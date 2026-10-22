import { describe, it, expect } from "vitest";
import { encodeCopyRow } from "@/core/services/server/shpReplace/copyText";

/** Test-only inverse of PostgreSQL COPY text format, used to prove round trips. */
function decodeCopyRow(line: string): Array<string | null> {
  if (!line.endsWith("\n")) throw new Error("COPY row must end with a newline");
  const body = line.slice(0, -1);
  return body.split("\t").map((cell) => {
    if (cell === "\\N") return null;
    return cell.replace(/\\(.)/g, (_match, escaped: string) => {
      if (escaped === "t") return "\t";
      if (escaped === "n") return "\n";
      if (escaped === "r") return "\r";
      return escaped;
    });
  });
}

describe("copyText", () => {
  describe("encodeCopyRow", () => {
    it("should join plain cells with tabs and end the line with a newline", () => {
      expect(encodeCopyRow(["a", "b", "c"])).toBe("a\tb\tc\n");
    });

    it("should encode a single plain cell as the text followed by a newline", () => {
      expect(encodeCopyRow(["parcela"])).toBe("parcela\n");
    });

    it("should encode null cells as the COPY NULL marker \\N", () => {
      expect(encodeCopyRow([null, "x"])).toBe("\\N\tx\n");
    });

    it("should encode a row made only of nulls as repeated \\N markers", () => {
      expect(encodeCopyRow([null, null])).toBe("\\N\t\\N\n");
    });

    it("should encode an empty string as an empty cell and not as the NULL marker", () => {
      expect(encodeCopyRow(["", "x"])).toBe("\tx\n");
      expect(encodeCopyRow([""])).toBe("\n");
    });

    it("should escape a backslash as two backslashes", () => {
      expect(encodeCopyRow(["C:\\temp"])).toBe("C:\\\\temp\n");
    });

    it("should escape an embedded tab as the two characters backslash and t", () => {
      expect(encodeCopyRow(["a\tb"])).toBe("a\\tb\n");
    });

    it("should escape an embedded line feed as the two characters backslash and n", () => {
      expect(encodeCopyRow(["a\nb"])).toBe("a\\nb\n");
    });

    it("should escape an embedded carriage return as the two characters backslash and r", () => {
      expect(encodeCopyRow(["a\rb"])).toBe("a\\rb\n");
    });

    it("should keep the line count at one when a cell holds CRLF", () => {
      const encoded = encodeCopyRow(["linea1\r\nlinea2"]);

      expect(encoded).toBe("linea1\\r\\nlinea2\n");
      expect(encoded.split("\n")).toHaveLength(2);
    });

    it("should keep unicode characters unchanged", () => {
      expect(encodeCopyRow(["Peña Blanca ☃ 東京"])).toBe("Peña Blanca ☃ 東京\n");
    });

    it("should keep quotes and other punctuation unchanged", () => {
      expect(encodeCopyRow(["O'Neil \"x\" a,b;c"])).toBe("O'Neil \"x\" a,b;c\n");
    });

    it("should escape the literal text backslash N so it is not read as NULL", () => {
      expect(encodeCopyRow(["\\N"])).toBe("\\\\N\n");
    });

    it("should escape a backslash that precedes a tab without merging the two escapes", () => {
      expect(encodeCopyRow(["a\\\tb"])).toBe("a\\\\\\tb\n");
    });

    it("should encode an empty cell list as a bare newline", () => {
      expect(encodeCopyRow([])).toBe("\n");
    });

    it("should strip NUL characters from a cell because PostgreSQL text cannot hold NUL", () => {
      expect(encodeCopyRow(["a\u0000b"])).toBe("ab\n");
    });

    it("should encode a cell made only of NUL characters as an empty cell and not as the NULL marker", () => {
      expect(encodeCopyRow(["\u0000"])).toBe("\n");
      expect(encodeCopyRow(["\u0000\u0000", "x"])).toBe("\tx\n");
    });

    it("should strip NUL characters and keep the NULL marker for null cells in the same row", () => {
      expect(encodeCopyRow([null, "\u0000x\u0000", "c"])).toBe("\\N\tx\tc\n");
    });
  });

  describe("round trip through COPY text decoding", () => {
    it.each([
      ["backslash", ["C:\\temp\\new"]],
      ["tab", ["col\tvalue"]],
      ["line feed", ["line1\nline2"]],
      ["carriage return", ["line1\rline2"]],
      ["CRLF", ["a\r\nb"]],
      ["unicode", ["Peña ☃ 東京"]],
      ["empty string", [""]],
      ["literal \\N text", ["\\N"]],
      ["null mixed with text", [null, "x", null]],
      ["backslash directly before tab", ["a\\\tb"]],
      ["every special character together", ["\\\t\n\r\\N", null, ""]],
    ])("should decode back to the original cells when the row contains %s", (_label, cells) => {
      const encoded = encodeCopyRow(cells as Array<string | null>);

      expect(decodeCopyRow(encoded)).toEqual(cells);
    });
  });
});
