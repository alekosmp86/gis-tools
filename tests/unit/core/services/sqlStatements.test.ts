import { describe, it, expect } from "vitest";
import {
  buildAnalyzeStatement,
  buildQualifiedTableLabel,
  buildRepairSequenceStatement,
  buildResetSequenceStatement,
  buildDeleteStatement,
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

  describe("buildDeleteStatement", () => {
    it("should build a quoted DELETE FROM for schema and table", () => {
      expect(buildDeleteStatement("geo", "parcels")).toBe('DELETE FROM "geo"."parcels";');
    });

    it.each([undefined, null, "", "  "])("should use public when schema is %j", (schema) => {
      expect(buildDeleteStatement(schema as string | undefined | null, "t")).toBe('DELETE FROM "public"."t";');
    });

    it("should double double-quotes in schema and table", () => {
      expect(buildDeleteStatement('s"x', 't"y')).toBe('DELETE FROM "s""x"."t""y";');
    });

    it("should never contain CASCADE, WHERE or TRUNCATE", () => {
      const statement = buildDeleteStatement("geo", "parcels").toUpperCase();
      expect(statement).not.toContain("CASCADE");
      expect(statement).not.toContain("WHERE");
      expect(statement).not.toContain("TRUNCATE");
    });
  });
  describe("buildResetSequenceStatement", () => {
    it("should build a setval to 1 with is_called false on the regclass literal", () => {
      expect(buildResetSequenceStatement("s", "q")).toBe(`SELECT setval('"s"."q"'::regclass, 1, false);`);
    });

    it("should double double-quotes in schema and sequence names", () => {
      expect(buildResetSequenceStatement('My"Schema', 'Q"x')).toBe(
        `SELECT setval('"My""Schema"."Q""x"'::regclass, 1, false);`
      );
    });

    it("should double single quotes inside names so the text literal cannot be broken out of", () => {
      expect(buildResetSequenceStatement("s'1", "q'; DROP TABLE x; --")).toBe(
        `SELECT setval('"s''1"."q''; DROP TABLE x; --"'::regclass, 1, false);`
      );
    });

    it("should handle both a double quote and a single quote in the same name", () => {
      expect(buildResetSequenceStatement('a"b', `c"d'e`)).toBe(`SELECT setval('"a""b"."c""d''e"'::regclass, 1, false);`);
    });

    it("should preserve case and spaces inside quotes", () => {
      expect(buildResetSequenceStatement("My Schema", "Seq")).toBe(`SELECT setval('"My Schema"."Seq"'::regclass, 1, false);`);
    });

    it("should not use ALTER SEQUENCE, which needs sequence ownership", () => {
      expect(buildResetSequenceStatement("s", "q").toUpperCase()).not.toContain("ALTER");
    });
  });

  describe("buildRepairSequenceStatement", () => {
    it("should raise the sequence above the highest column value without lowering it below its current position", () => {
      const statement = buildRepairSequenceStatement("s", "q", "geo", "parcels", ["id"]);
      expect(statement.startsWith(`SELECT setval('"s"."q"'::regclass,`)).toBe(true);
      expect(statement).toContain("GREATEST(");
      expect(statement).toContain('max("id")');
      expect(statement).toContain('FROM "geo"."parcels"');
      expect(statement).toContain(`pg_sequence_last_value('"s"."q"'::regclass)`);
      expect(statement.endsWith(", false);")).toBe(true);
    });

    it("should be a single line so the line-based executor sends it as one statement", () => {
      expect(buildRepairSequenceStatement("s", "q", "geo", "t", ["a", "b"])).not.toMatch(/[\n\r]/);
    });

    it("should take the maximum over every column that shares the sequence", () => {
      const statement = buildRepairSequenceStatement("s", "q", "geo", "t", ["a", "b"]);
      expect(statement).toContain('max("a")');
      expect(statement).toContain('max("b")');
    });

    it.each([undefined, null, "", "  "])("should read the table from public when its schema is %j", (schema) => {
      const statement = buildRepairSequenceStatement("s", "q", schema as string | undefined | null, "t", ["id"]);
      expect(statement).toContain('FROM "public"."t"');
    });

    it("should quote adversarial sequence, table and column names without breaking out of the literals", () => {
      const statement = buildRepairSequenceStatement("s'1", `q"x`, 'g"s', `t'; DROP TABLE x; --`, [`c"1`]);
      expect(statement).toContain(`setval('"s''1"."q""x"'::regclass,`);
      expect(statement).toContain(`pg_sequence_last_value('"s''1"."q""x"'::regclass)`);
      expect(statement).toContain('max("c""1")');
      expect(statement).toContain(`FROM "g""s"."t'; DROP TABLE x; --"`);
    });

    it("should neither use ALTER SEQUENCE, TRUNCATE nor read the sequence relation with SELECT", () => {
      const statement = buildRepairSequenceStatement("s", "q", "geo", "t", ["id"]).toUpperCase();
      expect(statement).not.toContain("ALTER");
      expect(statement).not.toContain("TRUNCATE");
      expect(statement).not.toMatch(/FROM\s+"S"\."Q"/);
      expect(statement).not.toContain("LAST_VALUE FROM");
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
