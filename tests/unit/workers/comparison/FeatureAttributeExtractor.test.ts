import { describe, it, expect, vi } from "vitest";
import {
  FeatureAttributeExtractor,
  type ExtractFeatureParams,
} from "@/core/workers/comparison/FeatureAttributeExtractor";
import type { SuidKeyResolver } from "@/core/workers/comparison/SuidKeyResolver";
import type { BinaryDbfReader, DbfFieldDescriptor } from "@/core/binary/BinaryDbfReader";
import type { BinaryShpReader } from "@/core/binary/BinaryShpReader";

function makeResolver(equal: (a: unknown, b: unknown) => boolean = (a, b) => a === b) {
  const areValuesEquivalent = vi.fn(
    (...args: [unknown, unknown, { ignoreEncodingArtifacts?: boolean }?]) => equal(args[0], args[1])
  );
  return { resolver: { areValuesEquivalent } as unknown as SuidKeyResolver, areValuesEquivalent };
}

const descriptor = (name: string) => ({ name }) as unknown as DbfFieldDescriptor;

function baseParams(overrides: Partial<ExtractFeatureParams> = {}): ExtractFeatureParams {
  return {
    dbRecord: {},
    dbIndex: 0,
    fieldsToCompare: [],
    fieldToFileKey: new Map(),
    binaryFileIndices: [],
    objectFileRecList: [],
    objectFileGeoms: [],
    dbfReader: null,
    shpReader: null,
    transformCoordinate: null,
    dbfCompareFields: new Map(),
    ...overrides,
  };
}

describe("FeatureAttributeExtractor", () => {
  describe("binary DBF branch", () => {
    it("should use binaryFileIndices[dbIndex] and report it as fileRecordIndex", () => {
      const { resolver } = makeResolver();
      const readFieldValue = vi.fn(() => "a");
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          dbRecord: { F: "a" },
          dbIndex: 1,
          fieldsToCompare: ["F"],
          binaryFileIndices: [10, 20],
          dbfReader: { readFieldValue } as unknown as BinaryDbfReader,
          dbfCompareFields: new Map([["F", descriptor("F")]]),
        })
      );

      expect(result.fileRecordIndex).toBe(20);
      expect(readFieldValue).toHaveBeenCalledWith(20, expect.anything());
      expect(result.fileFeatureRecord).toBeNull();
      expect(result.differences).toEqual([]);
    });

    it("should fall back to binaryFileIndices[0] when dbIndex is out of range", () => {
      const { resolver } = makeResolver();
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          dbIndex: 5,
          binaryFileIndices: [7, 8],
          dbfReader: { readFieldValue: vi.fn() } as unknown as BinaryDbfReader,
        })
      );

      expect(result.fileRecordIndex).toBe(7);
    });

    it("should push a difference with fieldName, dbValue and shpValue when values differ", () => {
      const { resolver } = makeResolver();
      const d = descriptor("NAME");
      const readFieldValue = vi.fn(() => "file");
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          dbRecord: { NAME: "db" },
          fieldsToCompare: ["NAME"],
          binaryFileIndices: [3],
          dbfReader: { readFieldValue } as unknown as BinaryDbfReader,
          dbfCompareFields: new Map([["NAME", d]]),
        })
      );

      expect(readFieldValue).toHaveBeenCalledWith(3, d);
      expect(result.differences).toEqual([{ fieldName: "NAME", dbValue: "db", shpValue: "file" }]);
    });

    it("should skip fields that have no descriptor without reading or comparing", () => {
      const { resolver, areValuesEquivalent } = makeResolver();
      const readFieldValue = vi.fn(() => "x");
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          dbRecord: { A: "1", B: "2" },
          fieldsToCompare: ["A", "B"],
          binaryFileIndices: [0],
          dbfReader: { readFieldValue } as unknown as BinaryDbfReader,
          dbfCompareFields: new Map([["B", descriptor("B")]]),
        })
      );

      expect(readFieldValue).toHaveBeenCalledTimes(1);
      expect(areValuesEquivalent).toHaveBeenCalledTimes(1);
      expect(result.differences.map((x) => x.fieldName)).toEqual(["B"]);
    });

    it("should treat an undefined db value as null but keep an explicit null/falsy value", () => {
      const { resolver, areValuesEquivalent } = makeResolver(() => false);
      const readFieldValue = vi.fn(() => "f");
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          dbRecord: { Z: 0 },
          fieldsToCompare: ["MISSING", "Z"],
          binaryFileIndices: [0],
          dbfReader: { readFieldValue } as unknown as BinaryDbfReader,
          dbfCompareFields: new Map([
            ["MISSING", descriptor("MISSING")],
            ["Z", descriptor("Z")],
          ]),
        })
      );

      expect(areValuesEquivalent.mock.calls[0][0]).toBeNull();
      expect(areValuesEquivalent.mock.calls[1][0]).toBe(0);
      expect(result.differences).toEqual([
        { fieldName: "MISSING", dbValue: null, shpValue: "f" },
        { fieldName: "Z", dbValue: 0, shpValue: "f" },
      ]);
    });

    it("should forward ignoreEncodingArtifacts (default true, explicit false honoured)", () => {
      const run = (extra: Partial<ExtractFeatureParams>) => {
        const { resolver, areValuesEquivalent } = makeResolver();
        new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
          baseParams({
            fieldsToCompare: ["F"],
            binaryFileIndices: [0],
            dbfReader: { readFieldValue: vi.fn(() => null) } as unknown as BinaryDbfReader,
            dbfCompareFields: new Map([["F", descriptor("F")]]),
            ...extra,
          })
        );
        return areValuesEquivalent.mock.calls[0][2];
      };

      expect(run({})).toEqual({ ignoreEncodingArtifacts: true });
      expect(run({ ignoreEncodingArtifacts: false })).toEqual({ ignoreEncodingArtifacts: false });
    });

    it("should read geometry via shpReader with the transform only when shpReader is present", () => {
      const { resolver } = makeResolver();
      const geom = { type: "Point", coordinates: [1, 2] };
      const readGeometry = vi.fn(() => geom);
      const transform = (c: [number, number]) => c;
      const dbfReader = { readFieldValue: vi.fn() } as unknown as BinaryDbfReader;
      const extractor = new FeatureAttributeExtractor(resolver);

      const withShp = extractor.extractFeatureAttributesAndGeometry(
        baseParams({
          binaryFileIndices: [4],
          dbfReader,
          shpReader: { readGeometry } as unknown as BinaryShpReader,
          transformCoordinate: transform,
        })
      );
      const withoutShp = extractor.extractFeatureAttributesAndGeometry(
        baseParams({ binaryFileIndices: [4], dbfReader })
      );

      expect(readGeometry).toHaveBeenCalledWith(4, transform);
      expect(withShp.fileGeometry).toBe(geom);
      expect(withoutShp.fileGeometry).toBeNull();
    });
  });

  describe("object branch", () => {
    it("should use the record and geometry at dbIndex, set fileFeatureRecord, leave fileRecordIndex undefined", () => {
      const { resolver } = makeResolver();
      const recs = [{ A: "x" }, { A: "y" }];
      const geoms = ["g0", "g1"];
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          dbRecord: { A: "y" },
          dbIndex: 1,
          fieldsToCompare: ["A"],
          objectFileRecList: recs,
          objectFileGeoms: geoms,
        })
      );

      expect(result.fileFeatureRecord).toBe(recs[1]);
      expect(result.fileGeometry).toBe("g1");
      expect(result.fileRecordIndex).toBeUndefined();
      expect(result.differences).toEqual([]);
    });

    it("should fall back to index 0 for record and geometry when dbIndex is out of range", () => {
      const { resolver } = makeResolver();
      const recs = [{ A: "x" }];
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({ dbIndex: 9, objectFileRecList: recs, objectFileGeoms: ["g0"] })
      );

      expect(result.fileFeatureRecord).toBe(recs[0]);
      expect(result.fileGeometry).toBe("g0");
    });

    it("should resolve the file key through fieldToFileKey and push a difference on mismatch", () => {
      const { resolver } = makeResolver();
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          dbRecord: { name: "db" },
          fieldsToCompare: ["name"],
          fieldToFileKey: new Map([["name", "NOMBRE"]]),
          objectFileRecList: [{ NOMBRE: "file", name: "ignored" }],
          objectFileGeoms: [null],
        })
      );

      expect(result.differences).toEqual([{ fieldName: "name", dbValue: "db", shpValue: "file" }]);
    });

    it("should use the field name itself when the mapped key is absent or empty", () => {
      const { resolver } = makeResolver();
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          dbRecord: { a: "1", b: "1" },
          fieldsToCompare: ["a", "b"],
          fieldToFileKey: new Map([["b", ""]]),
          objectFileRecList: [{ a: "2", b: "3" }],
          objectFileGeoms: [null],
        })
      );

      expect(result.differences).toEqual([
        { fieldName: "a", dbValue: "1", shpValue: "2" },
        { fieldName: "b", dbValue: "1", shpValue: "3" },
      ]);
    });

    it("should prefer the exact key over a case-insensitive match", () => {
      const { resolver, areValuesEquivalent } = makeResolver();
      new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          fieldsToCompare: ["Id"],
          objectFileRecList: [{ ID: "upper", Id: "exact" }],
          objectFileGeoms: [null],
        })
      );

      expect(areValuesEquivalent.mock.calls[0][1]).toBe("exact");
    });

    it("should fall back to a case-insensitive key lookup when the exact key is missing", () => {
      const { resolver } = makeResolver();
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          dbRecord: { id: "1" },
          fieldsToCompare: ["id"],
          objectFileRecList: [{ ID: "2" }],
          objectFileGeoms: [null],
        })
      );

      expect(result.differences).toEqual([{ fieldName: "id", dbValue: "1", shpValue: "2" }]);
    });

    it("should use null for a file value when no key matches, and for undefined db values", () => {
      const { resolver, areValuesEquivalent } = makeResolver(() => false);
      const result = new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          dbRecord: {},
          fieldsToCompare: ["nope"],
          objectFileRecList: [{ other: "v" }],
          objectFileGeoms: [null],
        })
      );

      expect(areValuesEquivalent.mock.calls[0][0]).toBeNull();
      expect(areValuesEquivalent.mock.calls[0][1]).toBeNull();
      expect(result.differences).toEqual([{ fieldName: "nope", dbValue: null, shpValue: null }]);
    });

    it("should treat an explicit-null exact key as present (value null) without case-insensitive scan", () => {
      const { resolver, areValuesEquivalent } = makeResolver();
      new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          fieldsToCompare: ["Id"],
          objectFileRecList: [{ Id: null, ID: "other" }],
          objectFileGeoms: [null],
        })
      );

      expect(areValuesEquivalent.mock.calls[0][1]).toBeNull();
    });

    it("should forward ignoreEncodingArtifacts (default true, explicit false honoured)", () => {
      const run = (extra: Partial<ExtractFeatureParams>) => {
        const { resolver, areValuesEquivalent } = makeResolver();
        new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
          baseParams({
            fieldsToCompare: ["F"],
            objectFileRecList: [{ F: 1 }],
            objectFileGeoms: [null],
            ...extra,
          })
        );
        return areValuesEquivalent.mock.calls[0][2];
      };

      expect(run({})).toEqual({ ignoreEncodingArtifacts: true });
      expect(run({ ignoreEncodingArtifacts: false })).toEqual({ ignoreEncodingArtifacts: false });
    });

    it("should never touch shpReader in the object branch", () => {
      const { resolver } = makeResolver();
      const readGeometry = vi.fn();
      new FeatureAttributeExtractor(resolver).extractFeatureAttributesAndGeometry(
        baseParams({
          objectFileRecList: [{}],
          objectFileGeoms: ["g"],
          shpReader: { readGeometry } as unknown as BinaryShpReader,
        })
      );

      expect(readGeometry).not.toHaveBeenCalled();
    });
  });
});
