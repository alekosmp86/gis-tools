import { describe, it, expect } from "vitest";
import {
  GeometryOptionsInvalidError,
  isProcessingActive,
  parseGeometryProcessingOptions,
} from "@/core/services/geometryProcessingOptions";
import {
  DEFAULT_GEOMETRY_PROCESSING,
  EMPTY_GEOMETRY_REPORT,
  OverlapPolicy,
  type GeometryProcessingOptions,
} from "@/core/types/geometryProcessing";

const FIELDS = ["DEPTO", "LOCALIDAD", "PADRON", "AREA"];

const ALL_ENABLED = {
  repair: { enabled: true },
  unify: { enabled: true, keyFields: ["DEPTO", "PADRON"] },
  overlaps: { enabled: true, policy: "report", minAreaM2: 0.5 },
};

const expectedAllEnabled: GeometryProcessingOptions = {
  repair: { enabled: true },
  unify: { enabled: true, keyFields: ["DEPTO", "PADRON"] },
  overlaps: { enabled: true, policy: OverlapPolicy.REPORT, minAreaM2: 0.5 },
};

const expectInvalid = (raw: unknown, fieldNames?: string[] | null): void => {
  expect(() => parseGeometryProcessingOptions(raw, fieldNames)).toThrow(GeometryOptionsInvalidError);
};

describe("geometryProcessingOptions", () => {
  describe("DEFAULT_GEOMETRY_PROCESSING", () => {
    it("should have every process disabled when the defaults are read", () => {
      expect(DEFAULT_GEOMETRY_PROCESSING.repair.enabled).toBe(false);
      expect(DEFAULT_GEOMETRY_PROCESSING.unify.enabled).toBe(false);
      expect(DEFAULT_GEOMETRY_PROCESSING.overlaps.enabled).toBe(false);
    });

    it("should have no key fields, block policy and a 1 m2 threshold when the defaults are read", () => {
      expect(DEFAULT_GEOMETRY_PROCESSING.unify.keyFields).toEqual([]);
      expect(DEFAULT_GEOMETRY_PROCESSING.overlaps.policy).toBe("block");
      expect(DEFAULT_GEOMETRY_PROCESSING.overlaps.minAreaM2).toBe(1);
    });
  });

  describe("EMPTY_GEOMETRY_REPORT", () => {
    it("should report zero for every counter when the report is empty", () => {
      expect(EMPTY_GEOMETRY_REPORT).toEqual({
        invalidBefore: 0,
        repaired: 0,
        emptyAfterRepair: 0,
        groups: 0,
        rowsMerged: 0,
        nullKeyRows: 0,
        largestGroups: [],
        attributeConflicts: 0,
        attributeConflictSamples: [],
        overlapCount: 0,
        overlapSamples: [],
        overlapSkippedInvalid: 0,
        insertedInvalid: 0,
        incompatibleGeometryRows: 0,
        incompatibleTargetType: null,
        wouldBlock: false,
        stepTimings: [],
        processingMs: 0,
      });
    });
  });

  describe("parseGeometryProcessingOptions", () => {
    describe("absent input", () => {
      it("should return the defaults when the raw value is undefined", () => {
        expect(parseGeometryProcessingOptions(undefined)).toEqual(DEFAULT_GEOMETRY_PROCESSING);
      });

      it("should return the defaults when the raw value is null", () => {
        expect(parseGeometryProcessingOptions(null)).toEqual(DEFAULT_GEOMETRY_PROCESSING);
      });

      it("should return the defaults when the raw value is undefined and field names are given", () => {
        expect(parseGeometryProcessingOptions(undefined, FIELDS)).toEqual(DEFAULT_GEOMETRY_PROCESSING);
      });
    });

    describe("missing sections", () => {
      it("should return all disabled defaults when the object is empty", () => {
        expect(parseGeometryProcessingOptions({})).toEqual(DEFAULT_GEOMETRY_PROCESSING);
      });

      it("should fill unify and overlaps with defaults when only repair is given", () => {
        const parsed = parseGeometryProcessingOptions({ repair: { enabled: true } });

        expect(parsed).toEqual({
          repair: { enabled: true },
          unify: { enabled: false, keyFields: [] },
          overlaps: { enabled: false, policy: "block", minAreaM2: 1 },
        });
      });

      it("should fill overlap policy and threshold with defaults when overlaps is enabled without them", () => {
        const parsed = parseGeometryProcessingOptions({ overlaps: { enabled: true } });

        expect(parsed.overlaps).toEqual({ enabled: true, policy: "block", minAreaM2: 1 });
      });

      it("should fill repair with a disabled default when repair is absent", () => {
        const parsed = parseGeometryProcessingOptions({ unify: { enabled: false, keyFields: [] } });

        expect(parsed.repair).toEqual({ enabled: false });
      });
    });

    describe("valid complete input", () => {
      it("should return the same options when every process is enabled with valid values", () => {
        expect(parseGeometryProcessingOptions(ALL_ENABLED, FIELDS)).toEqual(expectedAllEnabled);
      });

      it("should accept the block policy when it is given explicitly", () => {
        const parsed = parseGeometryProcessingOptions({
          overlaps: { enabled: true, policy: "block", minAreaM2: 2 },
        });

        expect(parsed.overlaps.policy).toBe(OverlapPolicy.BLOCK);
      });

      it("should accept the report policy when it is given explicitly", () => {
        const parsed = parseGeometryProcessingOptions({
          overlaps: { enabled: true, policy: "report", minAreaM2: 2 },
        });

        expect(parsed.overlaps.policy).toBe(OverlapPolicy.REPORT);
      });

      it("should not mutate the raw input when it is parsed", () => {
        const raw = { unify: { enabled: true, keyFields: ["DEPTO", "DEPTO"] } };
        const snapshot = structuredClone(raw);

        parseGeometryProcessingOptions(raw, FIELDS);

        expect(raw).toEqual(snapshot);
      });
    });

    describe("non-object input", () => {
      it.each([
        ["a string", "repair"],
        ["a number", 42],
        ["a boolean", true],
        ["an array", []],
      ])("should throw GeometryOptionsInvalidError when the raw value is %s", (_label, raw) => {
        expectInvalid(raw);
      });
    });

    describe("enabled flags", () => {
      it.each([
        ["repair.enabled is a string", { repair: { enabled: "yes" } }],
        ["repair.enabled is a number", { repair: { enabled: 1 } }],
        ["unify.enabled is null", { unify: { enabled: null, keyFields: [] } }],
        ["overlaps.enabled is a string", { overlaps: { enabled: "true" } }],
      ])("should throw GeometryOptionsInvalidError when %s", (_label, raw) => {
        expectInvalid(raw);
      });
    });

    describe("key fields", () => {
      it.each([
        ["a string instead of an array", "DEPTO"],
        ["null", null],
        ["an object", { DEPTO: true }],
      ])("should throw GeometryOptionsInvalidError when keyFields is %s", (_label, keyFields) => {
        expectInvalid({ unify: { enabled: true, keyFields } }, FIELDS);
      });

      it.each([
        ["an empty string", [""]],
        ["a whitespace-only string", ["   "]],
        ["a number", [1]],
        ["null", [null]],
      ])("should throw GeometryOptionsInvalidError when a key field is %s", (_label, keyFields) => {
        expectInvalid({ unify: { enabled: true, keyFields } }, FIELDS);
      });

      it("should dedupe repeated key fields silently while preserving their first-seen order", () => {
        const parsed = parseGeometryProcessingOptions(
          { unify: { enabled: true, keyFields: ["PADRON", "DEPTO", "PADRON", "AREA", "DEPTO"] } },
          FIELDS
        );

        expect(parsed.unify.keyFields).toEqual(["PADRON", "DEPTO", "AREA"]);
      });

      it("should accept exactly 20 distinct key fields when the boundary is reached", () => {
        const names = Array.from({ length: 20 }, (_entry, index) => `F${index}`);

        const parsed = parseGeometryProcessingOptions({ unify: { enabled: true, keyFields: names } }, names);

        expect(parsed.unify.keyFields).toHaveLength(20);
      });

      it("should throw GeometryOptionsInvalidError when more than 20 distinct key fields are given", () => {
        const names = Array.from({ length: 21 }, (_entry, index) => `F${index}`);

        expectInvalid({ unify: { enabled: true, keyFields: names } }, names);
      });

      it("should throw GeometryOptionsInvalidError when unify is enabled with zero key fields", () => {
        expectInvalid({ unify: { enabled: true, keyFields: [] } }, FIELDS);
      });

      it("should accept zero key fields when unify is disabled", () => {
        const parsed = parseGeometryProcessingOptions({ unify: { enabled: false, keyFields: [] } }, FIELDS);

        expect(parsed.unify).toEqual({ enabled: false, keyFields: [] });
      });

      it("should throw GeometryOptionsInvalidError when a key field is not among the DBF field names", () => {
        expectInvalid({ unify: { enabled: true, keyFields: ["DEPTO", "NO_EXISTE"] } }, FIELDS);
      });

      it("should include the offending key name in the error message when it is not a DBF field", () => {
        expect(() =>
          parseGeometryProcessingOptions({ unify: { enabled: true, keyFields: ["NO_EXISTE"] } }, FIELDS)
        ).toThrow(/NO_EXISTE/);
      });

      it("should skip the field-name membership check when field names are null", () => {
        const parsed = parseGeometryProcessingOptions(
          { unify: { enabled: true, keyFields: ["ANYTHING"] } },
          null
        );

        expect(parsed.unify.keyFields).toEqual(["ANYTHING"]);
      });

      it("should skip the field-name membership check when field names are undefined", () => {
        const parsed = parseGeometryProcessingOptions({ unify: { enabled: true, keyFields: ["ANYTHING"] } });

        expect(parsed.unify.keyFields).toEqual(["ANYTHING"]);
      });

      it("should keep key fields of a disabled unify even when they are not DBF field names", () => {
        const parsed = parseGeometryProcessingOptions(
          { unify: { enabled: false, keyFields: ["NO_EXISTE"] } },
          FIELDS
        );

        expect(parsed.unify).toEqual({ enabled: false, keyFields: ["NO_EXISTE"] });
      });
    });

    describe("overlap policy", () => {
      it.each([
        ["merge"],
        ["BLOCK"],
        ["Report"],
        [""],
        [null],
        [1],
      ])("should throw GeometryOptionsInvalidError when the policy is %j", (policy) => {
        expectInvalid({ overlaps: { enabled: true, policy, minAreaM2: 1 } });
      });
    });

    describe("overlap minimum area", () => {
      it("should accept zero when the minimum area is zero", () => {
        const parsed = parseGeometryProcessingOptions({ overlaps: { enabled: true, minAreaM2: 0 } });

        expect(parsed.overlaps.minAreaM2).toBe(0);
      });

      it("should accept 1e9 when the minimum area is at the upper boundary", () => {
        const parsed = parseGeometryProcessingOptions({ overlaps: { enabled: true, minAreaM2: 1e9 } });

        expect(parsed.overlaps.minAreaM2).toBe(1e9);
      });

      it.each([
        ["negative", -0.0001],
        ["just above the upper bound", 1e9 + 1],
        ["NaN", Number.NaN],
        ["positive infinity", Number.POSITIVE_INFINITY],
        ["negative infinity", Number.NEGATIVE_INFINITY],
      ])("should throw GeometryOptionsInvalidError when the minimum area is %s", (_label, minAreaM2) => {
        expectInvalid({ overlaps: { enabled: true, policy: "block", minAreaM2 } });
      });

      it.each([
        ["a numeric string", "1"],
        ["an injection string", "1 OR 1=1"],
        ["null", null],
        ["a boolean", true],
      ])("should throw GeometryOptionsInvalidError when the minimum area is %s", (_label, minAreaM2) => {
        expectInvalid({ overlaps: { enabled: true, policy: "block", minAreaM2 } });
      });
    });
  });

  describe("isProcessingActive", () => {
    it("should return false when the defaults are checked", () => {
      expect(isProcessingActive(DEFAULT_GEOMETRY_PROCESSING)).toBe(false);
    });

    it("should return true when only repair is enabled", () => {
      expect(
        isProcessingActive({ ...DEFAULT_GEOMETRY_PROCESSING, repair: { enabled: true } })
      ).toBe(true);
    });

    it("should return true when only unify is enabled", () => {
      expect(
        isProcessingActive({
          ...DEFAULT_GEOMETRY_PROCESSING,
          unify: { enabled: true, keyFields: ["DEPTO"] },
        })
      ).toBe(true);
    });

    it("should return true when only overlaps is enabled", () => {
      expect(
        isProcessingActive({
          ...DEFAULT_GEOMETRY_PROCESSING,
          overlaps: { enabled: true, policy: OverlapPolicy.BLOCK, minAreaM2: 1 },
        })
      ).toBe(true);
    });

    it("should return false when key fields are present but unify is disabled", () => {
      expect(
        isProcessingActive({
          ...DEFAULT_GEOMETRY_PROCESSING,
          unify: { enabled: false, keyFields: ["DEPTO"] },
        })
      ).toBe(false);
    });

    it("should return true when all three processes are enabled", () => {
      expect(isProcessingActive(expectedAllEnabled)).toBe(true);
    });
  });
});
