import { describe, it, expect } from "vitest";
import { discoverTargetSequences } from "@/core/services/replaceSequences";
import type { ReplaceInsertColumn } from "@/core/services/replaceColumnMapping";
import type { DbColumnMetadata } from "@/core/types/db";

const col = (column_name: string, column_default: string | null): DbColumnMetadata => ({
  column_name,
  data_type: "integer",
  is_nullable: false,
  column_default,
});

const unmapped: ReplaceInsertColumn[] = [];

describe("discoverTargetSequences", () => {
  describe("nextval parsing", () => {
    it("should resolve a schema-qualified regclass default", () => {
      const result = discoverTargetSequences([col("id", "nextval('s.q'::regclass)")], unmapped, "geo");
      expect(result.sequences).toEqual([{ qualifiedLabel: "s.q", schema: "s", name: "q" }]);
      expect(result.unparsedDefaults).toEqual([]);
    });

    it("should qualify an unqualified name with the target schema", () => {
      const result = discoverTargetSequences([col("id", "nextval('q_seq'::regclass)")], unmapped, "geo");
      expect(result.sequences).toEqual([{ qualifiedLabel: "geo.q_seq", schema: "geo", name: "q_seq" }]);
    });

    it.each([undefined, null, "", "  "])("should qualify with public when the target schema is %j", (schema) => {
      const result = discoverTargetSequences(
        [col("id", "nextval('q_seq'::regclass)")],
        unmapped,
        schema as string | undefined | null
      );
      expect(result.sequences).toEqual([{ qualifiedLabel: "public.q_seq", schema: "public", name: "q_seq" }]);
    });

    it("should unquote quoted identifiers preserving case, spaces and doubled quotes", () => {
      const result = discoverTargetSequences([col("id", `nextval('"My Schema"."Q""x"'::regclass)`)], unmapped, "geo");
      expect(result.sequences).toEqual([{ qualifiedLabel: 'My Schema.Q"x', schema: "My Schema", name: 'Q"x' }]);
    });

    it("should keep case of a quoted unqualified name and use the target schema", () => {
      const result = discoverTargetSequences([col("id", `nextval('"MySeq"'::regclass)`)], unmapped, "geo");
      expect(result.sequences).toEqual([{ qualifiedLabel: "geo.MySeq", schema: "geo", name: "MySeq" }]);
    });

    it("should fold mixed-case unquoted identifiers to lowercase", () => {
      const result = discoverTargetSequences([col("id", "nextval('Geo.MySeq'::regclass)")], unmapped, "x");
      expect(result.sequences).toEqual([{ qualifiedLabel: "geo.myseq", schema: "geo", name: "myseq" }]);
    });

    it("should accept the ::text cast variant", () => {
      const result = discoverTargetSequences([col("id", "nextval('s.q'::text)")], unmapped, "geo");
      expect(result.sequences).toEqual([{ qualifiedLabel: "s.q", schema: "s", name: "q" }]);
    });

    it("should accept a literal without any cast", () => {
      const result = discoverTargetSequences([col("id", "nextval('s.q')")], unmapped, "geo");
      expect(result.sequences).toEqual([{ qualifiedLabel: "s.q", schema: "s", name: "q" }]);
    });

    it("should tolerate extra whitespace and uppercase NEXTVAL", () => {
      const result = discoverTargetSequences([col("id", "  NEXTVAL (  's.q'  ::  regclass  )  ")], unmapped, "geo");
      expect(result.sequences).toEqual([{ qualifiedLabel: "s.q", schema: "s", name: "q" }]);
    });

    it("should unescape doubled single quotes inside the literal", () => {
      const result = discoverTargetSequences([col("id", `nextval('"it''s"'::regclass)`)], unmapped, "geo");
      expect(result.sequences).toEqual([{ qualifiedLabel: "geo.it's", schema: "geo", name: "it's" }]);
    });
  });

  describe("de-duplication", () => {
    it("should return a single sequence when two columns share it", () => {
      const result = discoverTargetSequences(
        [col("a", "nextval('s.q'::regclass)"), col("b", "nextval('s.q'::regclass)")],
        unmapped,
        "geo"
      );
      expect(result.sequences).toHaveLength(1);
    });

    it("should treat qualified and implicitly-qualified spellings of the same sequence as one", () => {
      const result = discoverTargetSequences(
        [col("a", "nextval('geo.q'::regclass)"), col("b", "nextval('q'::regclass)")],
        unmapped,
        "geo"
      );
      expect(result.sequences).toEqual([{ qualifiedLabel: "geo.q", schema: "geo", name: "q" }]);
    });

    it("should keep distinct sequences in column order", () => {
      const result = discoverTargetSequences(
        [col("a", "nextval('s.q1'::regclass)"), col("b", "nextval('s.q2'::regclass)")],
        unmapped,
        "geo"
      );
      expect(result.sequences.map((s) => s.qualifiedLabel)).toEqual(["s.q1", "s.q2"]);
    });
  });

  describe("mapped columns", () => {
    it("should exclude a column mapped from a source column", () => {
      const insertColumns: ReplaceInsertColumn[] = [{ targetColumn: "id", sourceColumn: "src_id", fixedDefault: null }];
      const result = discoverTargetSequences([col("id", "nextval('s.q'::regclass)")], insertColumns, "geo");
      expect(result).toEqual({ sequences: [], unparsedDefaults: [] });
    });

    it("should not exclude a column that only has a fixed default (no source column)", () => {
      const insertColumns: ReplaceInsertColumn[] = [
        { targetColumn: "id", sourceColumn: null, fixedDefault: { fieldName: "id", value: "5", useRawExpression: false } },
      ];
      const result = discoverTargetSequences([col("id", "nextval('s.q'::regclass)")], insertColumns, "geo");
      expect(result.sequences).toHaveLength(1);
    });

    it("should include a column absent from the insert columns", () => {
      const insertColumns: ReplaceInsertColumn[] = [{ targetColumn: "other", sourceColumn: "o", fixedDefault: null }];
      const result = discoverTargetSequences([col("id", "nextval('s.q'::regclass)")], insertColumns, "geo");
      expect(result.sequences).toHaveLength(1);
    });

    it("should exclude unparsable defaults of mapped columns from the warning too", () => {
      const insertColumns: ReplaceInsertColumn[] = [{ targetColumn: "id", sourceColumn: "id", fixedDefault: null }];
      const result = discoverTargetSequences([col("id", "nextval(foo)")], insertColumns, "geo");
      expect(result.unparsedDefaults).toEqual([]);
    });
  });

  describe("ignored defaults", () => {
    it("should silently ignore non-nextval defaults", () => {
      const result = discoverTargetSequences(
        [col("a", "now()"), col("b", "0"), col("c", "'x'::text"), col("d", "gen_random_uuid()")],
        unmapped,
        "geo"
      );
      expect(result).toEqual({ sequences: [], unparsedDefaults: [] });
    });

    it("should silently ignore null and empty defaults", () => {
      const result = discoverTargetSequences([col("a", null), col("b", "")], unmapped, "geo");
      expect(result).toEqual({ sequences: [], unparsedDefaults: [] });
    });

    it("should return empty results for no target details", () => {
      expect(discoverTargetSequences([], unmapped, "geo")).toEqual({ sequences: [], unparsedDefaults: [] });
    });
  });

  describe("unparsable nextval defaults", () => {
    it("should report an unparsable nextval( default as 'column: default'", () => {
      const result = discoverTargetSequences([col("id", "nextval(foo)")], unmapped, "geo");
      expect(result.sequences).toEqual([]);
      expect(result.unparsedDefaults).toEqual(["id: nextval(foo)"]);
    });

    it("should treat expression forms as unparsed", () => {
      const def = "nextval(('a'||'b')::regclass)";
      const result = discoverTargetSequences([col("id", def)], unmapped, "geo");
      expect(result.sequences).toEqual([]);
      expect(result.unparsedDefaults).toEqual([`id: ${def}`]);
    });

    it("should treat a three-part name as unparsed", () => {
      const result = discoverTargetSequences([col("id", "nextval('a.b.c'::regclass)")], unmapped, "geo");
      expect(result.unparsedDefaults).toEqual(["id: nextval('a.b.c'::regclass)"]);
    });

    it("should treat an unterminated quoted identifier as unparsed", () => {
      const result = discoverTargetSequences([col("id", `nextval('"abc'::regclass)`)], unmapped, "geo");
      expect(result.unparsedDefaults).toHaveLength(1);
    });

    it("should treat an empty name as unparsed", () => {
      const result = discoverTargetSequences([col("id", "nextval(''::regclass)")], unmapped, "geo");
      expect(result.unparsedDefaults).toEqual(["id: nextval(''::regclass)"]);
    });

    it("should still return parsable sequences alongside unparsed ones", () => {
      const result = discoverTargetSequences(
        [col("a", "nextval('s.q'::regclass)"), col("b", "nextval(foo)")],
        unmapped,
        "geo"
      );
      expect(result.sequences).toHaveLength(1);
      expect(result.unparsedDefaults).toEqual(["b: nextval(foo)"]);
    });
  });
});
