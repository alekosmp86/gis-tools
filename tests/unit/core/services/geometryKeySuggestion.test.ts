import { describe, it, expect } from "vitest";
import {
  KeyOrigin,
  pruneKeyFields,
  shouldApplySuggestion,
  suggestKeyFields,
  type KeySuggestion,
} from "@/core/services/geometryKeySuggestion";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";

const DBF_FIELDS = ["DEPTO", "LOCALIDAD", "PADRON", "AREA", "ID_LOC"];

const mappingOf = (sourceByTarget: Record<string, string | null>): ReplaceColumnMapping => ({
  sourceByTarget,
  defaults: {},
});

const STANDARD_MAPPING = mappingOf({
  depto: "DEPTO",
  localidad: "LOCALIDAD",
  padron: "PADRON",
  area: "AREA",
  id: null,
});

describe("geometryKeySuggestion", () => {
  describe("suggestKeyFields", () => {
    describe("remembered key", () => {
      it("should return the remembered key with origin REMEMBERED when every field exists in the DBF", () => {
        const result = suggestKeyFields({
          remembered: ["PADRON", "DEPTO"],
          uniqueKeys: [["depto"]],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["PADRON", "DEPTO"], origin: KeyOrigin.REMEMBERED });
      });

      it("should keep the remembered field order when it is returned", () => {
        const result = suggestKeyFields({
          remembered: ["LOCALIDAD", "DEPTO", "PADRON"],
          uniqueKeys: [],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result.fields).toEqual(["LOCALIDAD", "DEPTO", "PADRON"]);
      });

      it("should return the remembered key when a remembered field is not mapped to any target column", () => {
        const result = suggestKeyFields({
          remembered: ["ID_LOC", "DEPTO"],
          uniqueKeys: [],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["ID_LOC", "DEPTO"], origin: KeyOrigin.REMEMBERED });
      });

      it("should fall through to the unique key when a remembered field no longer exists in the DBF", () => {
        const result = suggestKeyFields({
          remembered: ["DEPTO", "NO_EXISTE"],
          uniqueKeys: [["depto", "padron"]],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["DEPTO", "PADRON"], origin: KeyOrigin.UNIQUE_KEY });
      });

      it("should fall through to NONE when a remembered field no longer exists and there is no unique key", () => {
        const result = suggestKeyFields({
          remembered: ["NO_EXISTE"],
          uniqueKeys: [],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: [], origin: KeyOrigin.NONE });
      });

      it("should fall through to the unique key when the remembered key is null", () => {
        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [["padron"]],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["PADRON"], origin: KeyOrigin.UNIQUE_KEY });
      });

      it("should fall through to the unique key when the remembered key is an empty array", () => {
        const result = suggestKeyFields({
          remembered: [],
          uniqueKeys: [["padron"]],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["PADRON"], origin: KeyOrigin.UNIQUE_KEY });
      });

      it("should dedupe a repeated remembered field while keeping its first position", () => {
        const result = suggestKeyFields({
          remembered: ["PADRON", "DEPTO", "PADRON"],
          uniqueKeys: [],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["PADRON", "DEPTO"], origin: KeyOrigin.REMEMBERED });
      });
    });

    describe("unique key", () => {
      it("should return the first unique key whose columns are all mapped when several are valid", () => {
        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [
            ["depto", "padron"],
            ["localidad", "padron"],
          ],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["DEPTO", "PADRON"], origin: KeyOrigin.UNIQUE_KEY });
      });

      it("should skip a unique key with an unmapped column and return the next fully mapped key", () => {
        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [
            ["id", "padron"],
            ["depto", "localidad"],
          ],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["DEPTO", "LOCALIDAD"], origin: KeyOrigin.UNIQUE_KEY });
      });

      it("should keep the unique key column order instead of the DBF order", () => {
        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [["padron", "depto", "localidad"]],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result.fields).toEqual(["PADRON", "DEPTO", "LOCALIDAD"]);
      });

      it("should return the DBF field name rather than the target column name", () => {
        const mapping = mappingOf({ dpto: "DEPTO" });

        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [["dpto"]],
          mapping,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["DEPTO"], origin: KeyOrigin.UNIQUE_KEY });
      });

      it("should skip a unique key whose mapped DBF field is absent from the DBF field list", () => {
        const mapping = mappingOf({ gone: "GONE", padron: "PADRON" });

        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [["gone"], ["padron"]],
          mapping,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["PADRON"], origin: KeyOrigin.UNIQUE_KEY });
      });

      it("should skip a unique key whose column is missing from the mapping entirely", () => {
        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [["not_a_target", "padron"]],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: [], origin: KeyOrigin.NONE });
      });

      it("should never use the geometry sentinel as a key field even when a unique key maps to it", () => {
        const mapping = mappingOf({ geom: SHP_GEOMETRY_SOURCE, depto: "DEPTO" });

        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [["geom"], ["depto"]],
          mapping,
          dbfFields: [SHP_GEOMETRY_SOURCE, ...DBF_FIELDS],
        });

        expect(result).toEqual({ fields: ["DEPTO"], origin: KeyOrigin.UNIQUE_KEY });
      });

      it("should dedupe DBF fields when two key columns map to the same DBF field", () => {
        const mapping = mappingOf({ a: "DEPTO", b: "DEPTO" });

        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [["a", "b"]],
          mapping,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["DEPTO"], origin: KeyOrigin.UNIQUE_KEY });
      });

      it("should dedupe a repeated DBF field inside a composite key while keeping the first occurrence", () => {
        const mapping = mappingOf({ a: "DEPTO", p: "PADRON", b: "DEPTO" });

        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [["a", "p", "b"]],
          mapping,
          dbfFields: DBF_FIELDS,
        });

        expect(result.fields).toEqual(["DEPTO", "PADRON"]);
      });

      it("should skip an empty unique key without a column and use the next key", () => {
        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [[], ["depto"]],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: ["DEPTO"], origin: KeyOrigin.UNIQUE_KEY });
      });

      it("should return NONE when the only unique key has no columns", () => {
        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [[]],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: [], origin: KeyOrigin.NONE });
      });
    });

    describe("no suggestion", () => {
      it("should return NONE with no fields when there are no unique keys and no remembered key", () => {
        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: [], origin: KeyOrigin.NONE });
      });

      it("should return NONE when every unique key has at least one unmapped column", () => {
        const result = suggestKeyFields({
          remembered: null,
          uniqueKeys: [["id"], ["padron", "id"]],
          mapping: STANDARD_MAPPING,
          dbfFields: DBF_FIELDS,
        });

        expect(result).toEqual({ fields: [], origin: KeyOrigin.NONE });
      });

      it("should return NONE when the DBF field list is empty", () => {
        const result = suggestKeyFields({
          remembered: ["DEPTO"],
          uniqueKeys: [["depto"]],
          mapping: STANDARD_MAPPING,
          dbfFields: [],
        });

        expect(result).toEqual({ fields: [], origin: KeyOrigin.NONE });
      });

      it("should not mutate the unique keys or remembered key it receives", () => {
        const remembered = ["PADRON", "DEPTO", "PADRON"];
        const uniqueKeys = [["depto", "padron"]];
        const rememberedSnapshot = [...remembered];
        const uniqueKeysSnapshot = uniqueKeys.map((key) => [...key]);

        suggestKeyFields({ remembered, uniqueKeys, mapping: STANDARD_MAPPING, dbfFields: DBF_FIELDS });

        expect(remembered).toEqual(rememberedSnapshot);
        expect(uniqueKeys).toEqual(uniqueKeysSnapshot);
      });
    });
  });

  describe("pruneKeyFields", () => {
    it("should keep only the key fields that exist in the DBF field list", () => {
      expect(pruneKeyFields(["PADRON", "NO_EXISTE", "DEPTO"], DBF_FIELDS)).toEqual(["PADRON", "DEPTO"]);
    });

    it("should keep the key field order when every field exists", () => {
      expect(pruneKeyFields(["LOCALIDAD", "DEPTO", "PADRON"], DBF_FIELDS)).toEqual(["LOCALIDAD", "DEPTO", "PADRON"]);
    });

    it("should dedupe a repeated key field while keeping its first position", () => {
      expect(pruneKeyFields(["PADRON", "DEPTO", "PADRON"], DBF_FIELDS)).toEqual(["PADRON", "DEPTO"]);
    });

    it("should return an empty list when no key field exists in the DBF field list", () => {
      expect(pruneKeyFields(["NO_EXISTE", "GONE"], DBF_FIELDS)).toEqual([]);
    });

    it("should return an empty list when the key fields are empty", () => {
      expect(pruneKeyFields([], DBF_FIELDS)).toEqual([]);
    });

    it("should return an empty list when the DBF field list is empty", () => {
      expect(pruneKeyFields(["DEPTO"], [])).toEqual([]);
    });

    it("should match field names exactly and drop a key field that differs only by case", () => {
      expect(pruneKeyFields(["depto", "DEPTO"], DBF_FIELDS)).toEqual(["DEPTO"]);
    });

    it("should not mutate the key fields or the DBF field list it receives", () => {
      const keyFields = ["PADRON", "NO_EXISTE", "PADRON"];
      const dbfFields = [...DBF_FIELDS];
      const keyFieldsSnapshot = [...keyFields];
      const dbfFieldsSnapshot = [...dbfFields];

      pruneKeyFields(keyFields, dbfFields);

      expect(keyFields).toEqual(keyFieldsSnapshot);
      expect(dbfFields).toEqual(dbfFieldsSnapshot);
    });
  });

  describe("shouldApplySuggestion", () => {
    const REMEMBERED_SUGGESTION: KeySuggestion = { fields: ["PADRON", "DEPTO"], origin: KeyOrigin.REMEMBERED };
    const UNIQUE_SUGGESTION: KeySuggestion = { fields: ["DEPTO"], origin: KeyOrigin.UNIQUE_KEY };
    const NONE_SUGGESTION: KeySuggestion = { fields: [], origin: KeyOrigin.NONE };

    const input = (changes: Partial<Parameters<typeof shouldApplySuggestion>[0]> = {}) => ({
      consumed: false,
      unifyEnabled: true,
      keyFields: [] as string[],
      suggestion: REMEMBERED_SUGGESTION,
      ...changes,
    });

    it("should return true when unify is on, no key is chosen yet and a remembered suggestion is pending", () => {
      expect(shouldApplySuggestion(input())).toBe(true);
    });

    it("should return true when the suggestion comes from a unique key of the target", () => {
      expect(shouldApplySuggestion(input({ suggestion: UNIQUE_SUGGESTION }))).toBe(true);
    });

    it("should return false when the suggestion was already consumed for this file", () => {
      expect(shouldApplySuggestion(input({ consumed: true }))).toBe(false);
    });

    it("should return false when unify is disabled", () => {
      expect(shouldApplySuggestion(input({ unifyEnabled: false }))).toBe(false);
    });

    it("should return false when the user already chose at least one key field", () => {
      expect(shouldApplySuggestion(input({ keyFields: ["LOCALIDAD"] }))).toBe(false);
    });

    it("should return false when the suggestion origin is none even if it carries fields", () => {
      expect(shouldApplySuggestion(input({ suggestion: { fields: ["DEPTO"], origin: KeyOrigin.NONE } }))).toBe(false);
    });

    it("should return false when the suggestion has no fields", () => {
      expect(shouldApplySuggestion(input({ suggestion: NONE_SUGGESTION }))).toBe(false);
    });

    it("should return false when the suggestion has an origin but an empty field list", () => {
      expect(shouldApplySuggestion(input({ suggestion: { fields: [], origin: KeyOrigin.UNIQUE_KEY } }))).toBe(false);
    });
  });
});
