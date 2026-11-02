import { describe, expect, it } from "vitest";
import { geometryAcceptsValuesSql } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/geometryAcceptsSql";
import { typedValuesSql, type TypedColumn } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/typedValuesSql";

const COLUMNS: readonly TypedColumn[] = [
  ["number", "text"],
  ["id_province", "integer"],
];

describe("typedValuesSql", () => {
  describe("empty rows", () => {
    it("should return a typed empty set of the same shape when there are no rows", () => {
      const sql = typedValuesSql(COLUMNS, [], "keys");

      expect(sql).toBe('SELECT CAST(NULL AS text) AS "number", CAST(NULL AS integer) AS "id_province" WHERE false');
    });
  });

  describe("typed rows", () => {
    it("should render each row as typed literals under the alias and the column names", () => {
      const sql = typedValuesSql(COLUMNS, [["501", 1]], "keys");

      expect(sql).toBe(`SELECT * FROM (VALUES (CAST('501' AS text), CAST(1 AS integer))) AS "keys"("number", "id_province")`);
    });

    it("should render a NULL cell as a typed NULL", () => {
      const sql = typedValuesSql(COLUMNS, [[null, null]], "keys");

      expect(sql).toBe(`SELECT * FROM (VALUES (CAST(NULL AS text), CAST(NULL AS integer))) AS "keys"("number", "id_province")`);
    });

    it("should keep numeric-looking text as text, never as an integer", () => {
      const sql = typedValuesSql(COLUMNS, [["1", 2]], "keys");

      expect(sql).toContain("CAST('1' AS text)");
    });

    it("should double every single quote in text so that a quote cannot end the literal", () => {
      const sql = typedValuesSql(COLUMNS, [["O'Brien", 1]], "keys");

      expect(sql).toContain("CAST('O''Brien' AS text)");
    });

    it("should escape a hostile statement as inert text, with every quote doubled", () => {
      const hostile = "1'; DROP TABLE x; --";

      const sql = typedValuesSql(COLUMNS, [[hostile, 1]], "keys");

      expect(sql).toContain("CAST('1''; DROP TABLE x; --' AS text)");
    });

    it("should render one row per cell list, separated by commas, in input order", () => {
      const sql = typedValuesSql(COLUMNS, [["A", 1], ["B", 2]], "keys");

      expect(sql).toContain("(CAST('A' AS text), CAST(1 AS integer)), (CAST('B' AS text), CAST(2 AS integer))");
    });
  });

  describe("integer validation", () => {
    it.each([
      ["a fractional integer", 1.5],
      ["NaN", Number.NaN],
      ["an infinite value", Number.POSITIVE_INFINITY],
      ["an integer above the safe range", Number.MAX_SAFE_INTEGER + 1],
    ])("should refuse %s in an integer column with a message naming the list value", (_label, value) => {
      expect(() => typedValuesSql(COLUMNS, [["X", value]], "keys")).toThrow("Un valor de la lista no es un entero");
    });

    it("should render the edges of the safe integer range exactly", () => {
      const sql = typedValuesSql(COLUMNS, [["X", Number.MIN_SAFE_INTEGER]], "keys");

      expect(sql).toContain(`CAST(${Number.MIN_SAFE_INTEGER} AS integer)`);
    });
  });
});

describe("geometryAcceptsValuesSql", () => {
  it("should return a typed empty set of the four key columns when no geometry is accepted", () => {
    const sql = geometryAcceptsValuesSql([]);

    expect(sql).toBe(
      'SELECT CAST(NULL AS text) AS "type_padron", CAST(NULL AS integer) AS "id_province", CAST(NULL AS integer) AS "id_cadastral_locality", CAST(NULL AS text) AS "number" WHERE false',
    );
  });

  it("should render an accepted key with its locality id and its number as typed literals", () => {
    const sql = geometryAcceptsValuesSql([{ typePadron: "URBANO", provinceId: 1, localityId: 10, number: "200" }]);

    expect(sql).toBe(
      `SELECT * FROM (VALUES (CAST('URBANO' AS text), CAST(1 AS integer), CAST(10 AS integer), CAST('200' AS text))) AS "accepts"("type_padron", "id_province", "id_cadastral_locality", "number")`,
    );
  });

  it("should render a RURAL key with a NULL locality as a typed NULL", () => {
    const sql = geometryAcceptsValuesSql([{ typePadron: "RURAL", provinceId: 1, localityId: null, number: "501" }]);

    expect(sql).toContain("CAST(NULL AS integer)");
  });
});
