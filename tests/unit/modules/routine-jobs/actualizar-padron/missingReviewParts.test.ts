import { describe, expect, it } from "vitest";
import { toPadronClassification, type ReportRow } from "@/modules/routine-jobs/jobs/actualizar-padron/domain/reportMapping";

const replacedRowOf = (overrides: ReportRow = {}): ReportRow => ({
  oldId: 5,
  typePadron: "URBANO",
  provinceId: 2,
  department: "CORDOBA",
  locality: "Villa Maria",
  number: "300",
  oldAreaM2: 120.5,
  centroidLat: -31.4,
  centroidLon: -64.1,
  class: "SUBDIVIDED",
  coveredPct: 93.2,
  parts: ["URBANO 301 (60.0 %)", "RURAL 12 (33.2 %)"],
  partKeys: [
    { typePadron: "URBANO", number: "301", locality: "Centro" },
    { typePadron: "RURAL", number: "12", locality: null },
  ],
  ...overrides,
});

const reviewOf = (...rows: ReportRow[]): ReportRow => ({ missing_review: rows });

describe("reportMapping missing padron replacement parts (AP-96, AP-98)", () => {
  describe("partKeys alignment with parts", () => {
    it("should keep each part key at the index of its part label", () => {
      const [entry] = toPadronClassification(reviewOf(replacedRowOf())).missingReview;

      expect(entry.parts).toEqual(["URBANO 301 (60.0 %)", "RURAL 12 (33.2 %)"]);
      expect(entry.partKeys).toEqual([
        { typePadron: "URBANO", number: "301", locality: "Centro" },
        { typePadron: "RURAL", number: "12", locality: null },
      ]);
    });

    it("should map a rural part key with a null locality, not a text placeholder", () => {
      const [entry] = toPadronClassification(reviewOf(replacedRowOf())).missingReview;

      expect(entry.partKeys?.[1]?.locality).toBeNull();
    });

    it("should keep the same count of part keys and part labels for every listed row", () => {
      const rows = toPadronClassification(
        reviewOf(replacedRowOf({ oldId: 5 }), replacedRowOf({ oldId: 6, parts: ["URBANO 9 (50.0 %)"], partKeys: [{ typePadron: "URBANO", number: "9", locality: "Centro" }] })),
      ).missingReview;

      expect(rows.map((entry) => entry.partKeys?.length)).toEqual(rows.map((entry) => entry.parts.length));
    });
  });

  describe("missing parts", () => {
    it("should give empty parts and empty part keys for a row with no parts field", () => {
      const row = replacedRowOf({ class: "ORPHAN", coveredPct: 0 });
      delete row.parts;
      delete row.partKeys;

      const [entry] = toPadronClassification(reviewOf(row)).missingReview;

      expect(entry.parts).toEqual([]);
      expect(entry.partKeys).toEqual([]);
    });

    it("should give empty part keys when a row carries parts but no partKeys, as older results do", () => {
      const row = replacedRowOf();
      delete row.partKeys;

      const [entry] = toPadronClassification(reviewOf(row)).missingReview;

      expect(entry.parts).toEqual(["URBANO 301 (60.0 %)", "RURAL 12 (33.2 %)"]);
      expect(entry.partKeys).toEqual([]);
    });

    it("should give empty part keys when partKeys is null", () => {
      const [entry] = toPadronClassification(reviewOf(replacedRowOf({ partKeys: null }))).missingReview;

      expect(entry.partKeys).toEqual([]);
    });

    it("should give an empty missing review when the report has no missing_review field", () => {
      expect(toPadronClassification({}).missingReview).toEqual([]);
    });
  });
});
