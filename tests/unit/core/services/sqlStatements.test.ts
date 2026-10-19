import { describe, it, expect } from "vitest";
import {
  buildAnalyzeStatement,
  buildQualifiedTableLabel,
  buildResetSequenceStatement,
  buildTruncateStatement,
  formatReplaceLiteral,
  quoteIdentifier,
  resolveSchemaName,
} from "@/core/services/sqlStatements";

describe("sqlStatements", () => {
  describe("quoteIdentifier", () => {
    it("should wrap a plain identifier in double quotes", () => {
      expect(quoteIdentifier("parcels")).toBe('"parcels"');
    });

    it("should double embedded double quotes when identifier contains them", () => {
      expect(quoteIdentifier('we"ird')).toBe('"we""ird"');
    });

    it("should quote an empty identifier", () => {
      expect(quoteIdentifier("")).toBe('""');
    });
  });

  describe("resolveSchemaName", () => {
    it.each([undefined, null, "", "   "])("should default to public when schema is %j", (schema) => {
      expect(resolveSchemaName(schema as string | undefined | null)).toBe("public");
    });

    it("should keep a provided schema untouched and case-sensitive", () => {
      expect(resolveSchemaName("Cartografia")).toBe("Cartografia");
    });
  });

  describe("buildQualifiedTableLabel", () => {
    it("should join schema and table with a dot", () => {
      expect(buildQualifiedTableLabel("geo", "parcels")).toBe("geo.parcels");
    });

    it("should use public when schema is empty", () => {
      expect(buildQualifiedTableLabel("", "parcels")).toBe("public.parcels");
    });
  });

  describe("formatReplaceLiteral", () => {
    it.each([null, undefined])("should return NULL for %s", (value) => {
      expect(formatReplaceLiteral(value)).toBe("NULL");
    });

    it("should quote a plain string", () => {
      expect(formatReplaceLiteral("abc")).toBe("'abc'");
    });

    it("should double single quotes", () => {
      expect(formatReplaceLiteral("O'Brien ''x'")).toBe("'O''Brien ''''x'''");
    });

    it("should keep an empty string as an empty literal, not NULL", () => {
      expect(formatReplaceLiteral("")).toBe("''");
    });

    it("should use E-string with escaped backslash", () => {
      expect(formatReplaceLiteral("a\\b")).toBe("E'a\\\\b'");
    });

    it("should escape newline and carriage return and emit no raw line break", () => {
      const out = formatReplaceLiteral("l1\nl2\r\nl3");
      expect(out).toBe("E'l1\\nl2\\r\\nl3'");
      expect(out).not.toMatch(/[\n\r]/);
    });

    it("should double quotes and escape backslashes together in an E-string", () => {
      expect(formatReplaceLiteral("it's\\\n")).toBe("E'it''s\\\\\\n'");
    });

    it("should not use an E-string when there is no backslash or line break", () => {
      expect(formatReplaceLiteral("tab\there")).toBe("'tab\there'");
    });

    it.each([
      [" lead", "' lead'"],
      ["trail ", "'trail '"],
      ["   ", "'   '"],
      ["Version 2.0", "'Version 2.0'"],
      ["1.0", "'1.0'"],
      ["007", "'007'"],
      ["123", "'123'"],
      ["true", "'true'"],
      ['"quoted"', "'\"quoted\"'"],
      ["a\tb", "'a\tb'"],
    ])("should keep %j byte-for-byte as %s", (input, expected) => {
      expect(formatReplaceLiteral(input)).toBe(expected);
    });

    it("should render booleans as true and false", () => {
      expect(formatReplaceLiteral(true)).toBe("true");
      expect(formatReplaceLiteral(false)).toBe("false");
    });

    it.each([
      [0, "0"],
      [-5, "-5"],
      [3.14, "3.14"],
      [1e21, "1e+21"],
    ])("should render finite number %d as text", (value, expected) => {
      expect(formatReplaceLiteral(value)).toBe(expected);
    });

    it.each([NaN, Infinity, -Infinity])("should return NULL for non-finite number %d", (value) => {
      expect(formatReplaceLiteral(value)).toBe("NULL");
    });

    it("should JSON-stringify and quote objects", () => {
      expect(formatReplaceLiteral({ a: "it's" })).toBe(`'{"a":"it''s"}'`);
    });

    it("should JSON-stringify and quote arrays", () => {
      expect(formatReplaceLiteral([1, "x"])).toBe(`'[1,"x"]'`);
    });

    it("should escape line breaks inside a stringified object value", () => {
      const out = formatReplaceLiteral({ a: "l1\nl2" });
      expect(out.startsWith("E'")).toBe(true);
      expect(out).not.toMatch(/[\n\r]/);
    });
  });

  describe("buildTruncateStatement", () => {
    it("should build a quoted TRUNCATE for schema and table", () => {
      expect(buildTruncateStatement("geo", "parcels")).toBe('TRUNCATE TABLE "geo"."parcels";');
    });

    it.each([undefined, null, "", "  "])("should use public when schema is %j", (schema) => {
      expect(buildTruncateStatement(schema as string | undefined | null, "t")).toBe('TRUNCATE TABLE "public"."t";');
    });

    it("should double double-quotes in schema and table", () => {
      expect(buildTruncateStatement('s"x', 't"y')).toBe('TRUNCATE TABLE "s""x"."t""y";');
    });

    it("should never contain CASCADE", () => {
      expect(buildTruncateStatement("geo", "parcels").toUpperCase()).not.toContain("CASCADE");
    });
  });
  describe("buildResetSequenceStatement", () => {
    it("should build a quoted ALTER SEQUENCE RESTART WITH 1", () => {
      expect(buildResetSequenceStatement("s", "q")).toBe('ALTER SEQUENCE "s"."q" RESTART WITH 1;');
    });

    it("should double double-quotes in schema and sequence names", () => {
      expect(buildResetSequenceStatement('My"Schema', 'Q"x')).toBe('ALTER SEQUENCE "My""Schema"."Q""x" RESTART WITH 1;');
    });

    it("should preserve case and spaces inside quotes", () => {
      expect(buildResetSequenceStatement("My Schema", "Seq")).toBe('ALTER SEQUENCE "My Schema"."Seq" RESTART WITH 1;');
    });
  });

  describe("buildAnalyzeStatement", () => {
    it("should build a quoted ANALYZE for schema and table", () => {
      expect(buildAnalyzeStatement("s", "t")).toBe('ANALYZE "s"."t";');
    });

    it.each([undefined, null, "", "  "])("should use public when schema is %j", (schema) => {
      expect(buildAnalyzeStatement(schema as string | undefined | null, "t")).toBe('ANALYZE "public"."t";');
    });

    it("should double double-quotes in schema and table", () => {
      expect(buildAnalyzeStatement('s"x', 't"y')).toBe('ANALYZE "s""x"."t""y";');
    });
  });
});
