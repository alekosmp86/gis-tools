import { describe, it, expect } from "vitest";
import { discoverTargetSequences, type SequenceRef } from "@/core/services/replaceSequences";
import type { ReplaceInsertColumn } from "@/core/services/replaceColumnMapping";
import type { DbColumnMetadata } from "@/core/types/db";

const col = (column_name: string, column_default: string | null): DbColumnMetadata => ({
  column_name,
  data_type: "integer",
  is_nullable: false,
  column_default,
});

const ref = (schema: string, name: string, columns: string[], mapped = false, qualifiedLabel = `${schema}.${name}`): SequenceRef => ({
  qualifiedLabel,
  schema,
  name,
  columns,
  mapped,
});

const sourced = (targetColumn: string): ReplaceInsertColumn => ({ targetColumn, sourceColumn: `src_${targetColumn}`, fixedDefault: null });

const unmapped: ReplaceInsertColumn[] = [];

describe("discoverTargetSequences", () => {
  describe("nextval parsing", () => {
    it("should resolve a schema-qualified regclass default", () => {
      const result = discoverTargetSequences([col("id", "nextval('s.q'::regclass)")], unmapped, "geo");
      expect(result.sequences).toEqual([ref("s", "q", ["id"])]);
      expect(result.unparsedDefaults).toEqual([]);
    });

    it("should qualify an unqualified name with the target schema", () => {
      const result = discoverTargetSequences([col("id", "nextval('q_seq'::regclass)")], unmapped, "geo");
      expect(result.sequences).toEqual([ref("geo", "q_seq", ["id"])]);
    });

    it.each([undefined, null, "", "  "])("should qualify with public when the target schema is %j", (schema) => {
      const result = discoverTargetSequences(
        [col("id", "nextval('q_seq'::regclass)")],
        unmapped,
        schema as string | undefined | null
      );
      expect(result.sequences).toEqual([ref("public", "q_seq", ["id"])]);
    });

    it("should unquote quoted identifiers preserving case, spaces and doubled quotes", () => {
      const result = discoverTargetSequences([col("id", `nextval('"My Schema"."Q""x"'::regclass)`)], unmapped, "geo");
      expect(result.sequences).toEqual([ref("My Schema", 'Q"x', ["id"])]);
    });

    it("should keep case of a quoted unqualified name and use the target schema", () => {
      const result = discoverTargetSequences([col("id", `nextval('"MySeq"'::regclass)`)], unmapped, "geo");
      expect(result.sequences).toEqual([ref("geo", "MySeq", ["id"])]);
    });

    it("should fold mixed-case unquoted identifiers to lowercase", () => {
      const result = discoverTargetSequences([col("id", "nextval('Geo.MySeq'::regclass)")], unmapped, "x");
      expect(result.sequences).toEqual([ref("geo", "myseq", ["id"])]);
    });

    it("should accept the ::text cast variant", () => {
      const result = discoverTargetSequences([col("id", "nextval('s.q'::text)")], unmapped, "geo");
      expect(result.sequences).toEqual([ref("s", "q", ["id"])]);
    });

    it("should accept a literal without any cast", () => {
      const result = discoverTargetSequences([col("id", "nextval('s.q')")], unmapped, "geo");
      expect(result.sequences).toEqual([ref("s", "q", ["id"])]);
    });

    it("should tolerate extra whitespace and uppercase NEXTVAL", () => {
      const result = discoverTargetSequences([col("id", "  NEXTVAL (  's.q'  ::  regclass  )  ")], unmapped, "geo");
      expect(result.sequences).toEqual([ref("s", "q", ["id"])]);
    });

    it("should unescape doubled single quotes inside the literal", () => {
      const result = discoverTargetSequences([col("id", `nextval('"it''s"'::regclass)`)], unmapped, "geo");
      expect(result.sequences).toEqual([ref("geo", "it's", ["id"])]);
    });
  });

  describe("columns and mapped flag", () => {
    it("should report the column name and mapped=false for a column that receives no source value", () => {
      const result = discoverTargetSequences([col("id", "nextval('s.q'::regclass)")], unmapped, "geo");
      expect(result.sequences).toEqual([ref("s", "q", ["id"], false)]);
    });

    it("should still return the sequence of a column mapped from a source column, flagged mapped=true", () => {
      const result = discoverTargetSequences([col("id", "nextval('s.q'::regclass)")], [sourced("id")], "geo");
      expect(result.sequences).toEqual([ref("s", "q", ["id"], true)]);
      expect(result.unparsedDefaults).toEqual([]);
    });

    it("should flag a column that only has a fixed default (no source column) as mapped=false", () => {
      const insertColumns: ReplaceInsertColumn[] = [
        { targetColumn: "id", sourceColumn: null, fixedDefault: { fieldName: "id", value: "5", useRawExpression: false } },
      ];
      const result = discoverTargetSequences([col("id", "nextval('s.q'::regclass)")], insertColumns, "geo");
      expect(result.sequences).toEqual([ref("s", "q", ["id"], false)]);
    });

    it("should flag a column absent from the insert columns as mapped=false", () => {
      const result = discoverTargetSequences([col("id", "nextval('s.q'::regclass)")], [sourced("other")], "geo");
      expect(result.sequences).toEqual([ref("s", "q", ["id"], false)]);
    });

    it("should return mapped and unmapped sequences together in column order", () => {
      const result = discoverTargetSequences(
        [col("a", "nextval('s.q1'::regclass)"), col("b", "nextval('s.q2'::regclass)")],
        [sourced("b")],
        "geo"
      );
      expect(result.sequences).toEqual([ref("s", "q1", ["a"], false), ref("s", "q2", ["b"], true)]);
    });
  });

  describe("de-duplication of shared sequences", () => {
    it("should return a single entry listing both columns when two columns share the sequence", () => {
      const result = discoverTargetSequences(
        [col("a", "nextval('s.q'::regclass)"), col("b", "nextval('s.q'::regclass)")],
        unmapped,
        "geo"
      );
      expect(result.sequences).toEqual([ref("s", "q", ["a", "b"], false)]);
    });

    it("should flag the shared entry mapped=true when only one of its columns is mapped", () => {
      const result = discoverTargetSequences(
        [col("a", "nextval('s.q'::regclass)"), col("b", "nextval('s.q'::regclass)")],
        [sourced("b")],
        "geo"
      );
      expect(result.sequences).toEqual([ref("s", "q", ["a", "b"], true)]);
    });

    it("should flag the shared entry mapped=true when both columns are mapped", () => {
      const result = discoverTargetSequences(
        [col("a", "nextval('s.q'::regclass)"), col("b", "nextval('s.q'::regclass)")],
        [sourced("a"), sourced("b")],
        "geo"
      );
      expect(result.sequences).toEqual([ref("s", "q", ["a", "b"], true)]);
    });

    it("should treat qualified and implicitly-qualified spellings of the same sequence as one", () => {
      const result = discoverTargetSequences(
        [col("a", "nextval('geo.q'::regclass)"), col("b", "nextval('q'::regclass)")],
        unmapped,
        "geo"
      );
      expect(result.sequences).toEqual([ref("geo", "q", ["a", "b"], false)]);
    });

    it("should keep distinct sequences in column order", () => {
      const result = discoverTargetSequences(
        [col("a", "nextval('s.q1'::regclass)"), col("b", "nextval('s.q2'::regclass)")],
        unmapped,
        "geo"
      );
      expect(result.sequences.map((sequence) => sequence.qualifiedLabel)).toEqual(["s.q1", "s.q2"]);
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

    it("should report an unparsable default of a mapped column too because its sequence cannot be repaired", () => {
      const result = discoverTargetSequences([col("id", "nextval(foo)")], [sourced("id")], "geo");
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
      expect(result.sequences).toEqual([ref("s", "q", ["a"], false)]);
      expect(result.unparsedDefaults).toEqual(["b: nextval(foo)"]);
    });
  });
});

describe("discoverTargetSequences identifier splitting", () => {
  const parse = (literal: string, schema = "geo") =>
    discoverTargetSequences([col("id", `nextval('${literal}'::regclass)`)], [], schema);

  it("should split a quoted schema and a quoted name", () => {
    expect(parse('"S"."Q"').sequences).toEqual([ref("S", "Q", ["id"])]);
  });

  it("should mix a quoted schema with an unquoted name and fold only the unquoted part", () => {
    expect(parse('"Mixed".SeqName').sequences).toEqual([ref("Mixed", "seqname", ["id"])]);
  });

  it("should mix an unquoted schema with a quoted name and fold only the unquoted part", () => {
    expect(parse('SchemA."Seq"').sequences).toEqual([ref("schema", "Seq", ["id"])]);
  });

  it("should keep a dot that sits inside quotes as part of the identifier", () => {
    expect(parse('"a.b"').sequences).toEqual([ref("geo", "a.b", ["id"])]);
  });

  it("should keep a dot inside a quoted schema when a second part follows", () => {
    expect(parse('"a.b".q').sequences).toEqual([ref("a.b", "q", ["id"])]);
  });

  it("should trim whitespace around unquoted parts", () => {
    expect(parse(" s . q ").sequences).toEqual([ref("s", "q", ["id"])]);
  });

  it("should unescape a doubled double-quote at the end of a quoted identifier", () => {
    expect(parse('"a"""').sequences).toEqual([ref("geo", 'a"', ["id"])]);
  });

  it.each([
    ["a trailing dot", "s.q."],
    ["a leading dot", ".q"],
    ["two consecutive dots", "s..q"],
    ["a quote in the middle of an unquoted part", 'ab"c"'],
    ["text glued after a closing quote", '"a"b'],
    ["a quoted part followed by a trailing dot", '"a".'],
    ["only a dot", "."],
    ["only whitespace", "   "],
    ["a lone opening quote", '"'],
    ["four parts", "a.b.c.d"],
  ])("should report %s as unparsed", (_label, literal) => {
    const result = parse(literal);

    expect(result.sequences).toEqual([]);
    expect(result.unparsedDefaults).toHaveLength(1);
  });

  it("should accept an empty quoted part as a zero-length identifier (documented quirk, PostgreSQL itself rejects it)", () => {
    expect(parse('""').sequences).toEqual([ref("geo", "", ["id"], false, "geo.")]);
    expect(parse('"".q').sequences).toEqual([ref("", "q", ["id"], false, "public.q")]);
  });
});
