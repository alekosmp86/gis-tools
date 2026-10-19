import { describe, it, expect } from "vitest";
import {
  buildDefaultColumnMapping,
  findMissingRequiredColumns,
  getIgnoredSourceColumns,
  getMappedSourceColumns,
  hasTypeConflict,
  isNonTextType,
  resolveInsertColumns,
  type ReplaceColumnMapping,
} from "@/core/services/replaceColumnMapping";
import type { DbColumnMetadata } from "@/core/types/db";

const meta = (column_name: string, is_nullable: boolean, column_default: string | null = null) =>
  ({ column_name, is_nullable, column_default }) as unknown as DbColumnMetadata;

describe("replaceColumnMapping", () => {
  describe("buildDefaultColumnMapping", () => {
    it("should prefill same-named columns and leave others null", () => {
      const mapping = buildDefaultColumnMapping(["id", "name", "extra"], ["id", "name", "other"]);
      expect(mapping.sourceByTarget).toEqual({ id: "id", name: "name", other: null });
      expect(mapping.defaults).toEqual({});
    });

    it("should be case-sensitive when matching names", () => {
      expect(buildDefaultColumnMapping(["ID"], ["id"]).sourceByTarget).toEqual({ id: null });
    });

    it("should return empty mapping when there are no target columns", () => {
      expect(buildDefaultColumnMapping(["a"], []).sourceByTarget).toEqual({});
    });
  });

  describe("resolveInsertColumns", () => {
    it("should map different source and target names", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { dest: "src" }, defaults: {} };
      expect(resolveInsertColumns(mapping, ["dest"])).toEqual([
        { targetColumn: "dest", sourceColumn: "src", fixedDefault: null },
      ]);
    });

    it("should omit unmapped targets without defaults", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { a: null }, defaults: {} };
      expect(resolveInsertColumns(mapping, ["a"])).toEqual([]);
    });

    it("should omit targets whose default is blank", () => {
      const mapping: ReplaceColumnMapping = {
        sourceByTarget: { a: null },
        defaults: { a: { fieldName: "a", value: "   ", useRawExpression: false } },
      };
      expect(resolveInsertColumns(mapping, ["a"])).toEqual([]);
    });

    it("should use fixed default when target is unmapped and default is set", () => {
      const fixed = { fieldName: "a", value: "now()", useRawExpression: true };
      const mapping: ReplaceColumnMapping = { sourceByTarget: { a: null }, defaults: { a: fixed } };
      expect(resolveInsertColumns(mapping, ["a"])).toEqual([
        { targetColumn: "a", sourceColumn: null, fixedDefault: fixed },
      ]);
    });

    it("should prefer the source mapping over a default", () => {
      const mapping: ReplaceColumnMapping = {
        sourceByTarget: { a: "s" },
        defaults: { a: { fieldName: "a", value: "x", useRawExpression: false } },
      };
      expect(resolveInsertColumns(mapping, ["a"])[0]).toMatchObject({ sourceColumn: "s", fixedDefault: null });
    });

    it("should preserve target column order", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { b: "b", a: "a" }, defaults: {} };
      expect(resolveInsertColumns(mapping, ["a", "b"]).map((c) => c.targetColumn)).toEqual(["a", "b"]);
    });
  });

  describe("getMappedSourceColumns / getIgnoredSourceColumns", () => {
    const insertColumns = [
      { targetColumn: "a", sourceColumn: "s1", fixedDefault: null },
      { targetColumn: "b", sourceColumn: "s1", fixedDefault: null },
      { targetColumn: "c", sourceColumn: null, fixedDefault: { fieldName: "c", value: "1", useRawExpression: false } },
    ];

    it("should return distinct mapped source columns and skip defaults", () => {
      expect(getMappedSourceColumns(insertColumns)).toEqual(["s1"]);
    });

    it("should list source columns that are not mapped as ignored", () => {
      expect(getIgnoredSourceColumns(insertColumns, ["s1", "s2", "s3"])).toEqual(["s2", "s3"]);
    });

    it("should report all source columns ignored when nothing is mapped", () => {
      expect(getIgnoredSourceColumns([], ["x", "y"])).toEqual(["x", "y"]);
    });
  });

  describe("findMissingRequiredColumns", () => {
    it("should flag NOT NULL columns without default that are not covered", () => {
      const details = [meta("id", false), meta("opt", true), meta("withDef", false, "nextval('s')")];
      expect(findMissingRequiredColumns([], details)).toEqual(["id"]);
    });

    it("should not flag NOT NULL columns that are covered", () => {
      const details = [meta("id", false)];
      const insertColumns = [{ targetColumn: "id", sourceColumn: "x", fixedDefault: null }];
      expect(findMissingRequiredColumns(insertColumns, details)).toEqual([]);
    });

    it("should return empty for no target details", () => {
      expect(findMissingRequiredColumns([], [])).toEqual([]);
    });
  });

  describe("isNonTextType", () => {
    it.each([
      "integer",
      "bigint",
      "numeric(10,2)",
      "double precision",
      "date",
      "timestamp without time zone",
      "timestamp with time zone",
      "boolean",
      "geometry(MultiPolygon,4326)",
    ])("should return true for %s", (type) => {
      expect(isNonTextType(type)).toBe(true);
    });

    it.each(["text", "character varying(20)", "varchar", "char", "uuid", "jsonb", "bytea"])(
      "should return false for %s",
      (type) => {
        expect(isNonTextType(type)).toBe(false);
      }
    );

    it("should return false for undefined, empty and unknown types", () => {
      expect(isNonTextType(undefined)).toBe(false);
      expect(isNonTextType("")).toBe(false);
      expect(isNonTextType("somethingweird")).toBe(false);
    });
  });

  describe("hasTypeConflict", () => {
    it("should flag numeric to boolean", () => {
      expect(hasTypeConflict("integer", "boolean")).toBe(true);
    });

    it("should flag text to numeric", () => {
      expect(hasTypeConflict("character varying", "integer")).toBe(true);
    });

    it("should flag geometry to numeric", () => {
      expect(hasTypeConflict("geometry(Point,4326)", "integer")).toBe(true);
    });

    it("should not flag anything into a text target", () => {
      expect(hasTypeConflict("integer", "text")).toBe(false);
      expect(hasTypeConflict("timestamp without time zone", "character varying")).toBe(false);
    });

    it("should not flag same category", () => {
      expect(hasTypeConflict("bigint", "numeric")).toBe(false);
      expect(hasTypeConflict("date", "timestamp with time zone")).toBe(false);
    });

    it("should not flag when a type is unknown or missing", () => {
      expect(hasTypeConflict(undefined, "integer")).toBe(false);
      expect(hasTypeConflict("integer", undefined)).toBe(false);
      expect(hasTypeConflict("uuid", "integer")).toBe(false);
    });
  });
});
