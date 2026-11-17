import type { FeatureCollection } from "geojson";
import { describe, expect, it } from "vitest";
import { getDiscrepancyLabel } from "@/core/constants/mapConstants";
import { legendEntriesOf } from "@/ui-kit/components/spatialPreviewLogic";

const featureOf = (type: string | undefined, properties: Record<string, unknown> = {}) => ({
  type: "Feature" as const,
  geometry: { type: "Point" as const, coordinates: [0, 0] },
  properties: { ...(type === undefined ? {} : { _discrepancyType: type }), ...properties },
});

const collectionOf = (features: ReturnType<typeof featureOf>[]): FeatureCollection =>
  ({ type: "FeatureCollection", features }) as unknown as FeatureCollection;

describe("legendEntriesOf: one entry per discrepancy type (EJS-19)", () => {
  it("should list the distinct types in first-seen order", () => {
    const entries = legendEntriesOf(
      collectionOf([featureOf("TRAMO_CANDIDATO_2"), featureOf("PUNTO_ACCESO"), featureOf("TRAMO_CANDIDATO_2"), featureOf("TRAMO_CANDIDATO_1")])
    );

    expect(entries.map((entry) => entry.type)).toEqual(["TRAMO_CANDIDATO_2", "PUNTO_ACCESO", "TRAMO_CANDIDATO_1"]);
  });

  it("should label each type by its discrepancy label when no label property is asked for", () => {
    const entries = legendEntriesOf(collectionOf([featureOf("TRAMO_CANDIDATO_1", { label: "Tramo nuevo 6002" })]));

    expect(entries).toEqual([{ type: "TRAMO_CANDIDATO_1", label: getDiscrepancyLabel("TRAMO_CANDIDATO_1") }]);
  });

  it("should label each type by the first feature's label property when asked for it", () => {
    const entries = legendEntriesOf(
      collectionOf([featureOf("TRAMO_CANDIDATO_1", { label: "Tramo nuevo 6002" }), featureOf("TRAMO_CANDIDATO_1", { label: "Otro" })]),
      "label"
    );

    expect(entries).toEqual([{ type: "TRAMO_CANDIDATO_1", label: "Tramo nuevo 6002" }]);
  });

  it.each([
    ["an empty label", ""],
    ["a missing label", undefined],
    ["a non-text label", 42],
  ])("should fall back to the type's discrepancy label for %s (empty-label fallback)", (_label, label) => {
    const entries = legendEntriesOf(collectionOf([featureOf("PUNTO_ACCESO", { label })]), "label");

    expect(entries).toEqual([{ type: "PUNTO_ACCESO", label: getDiscrepancyLabel("PUNTO_ACCESO") }]);
  });

  it("should skip features without a discrepancy type, an empty type, or no features at all (empty)", () => {
    expect(legendEntriesOf(collectionOf([featureOf(undefined), featureOf("")]))).toEqual([]);
    expect(legendEntriesOf(collectionOf([]))).toEqual([]);
  });
});
