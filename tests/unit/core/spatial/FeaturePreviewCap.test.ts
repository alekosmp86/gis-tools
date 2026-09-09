import { describe, it, expect } from "vitest";
import type { Feature } from "geojson";
import { capFeaturesWithoutSplittingGroups } from "@/core/spatial/FeaturePreviewCap";

function buildFeature(pairId?: string, name = "f"): Feature {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [0, 0] },
    properties: pairId === undefined ? { name } : { name, _pairId: pairId },
  };
}

/** Two features per discrepancy: the database geometry and the file geometry. */
function buildPair(pairId: string): Feature[] {
  return [buildFeature(pairId, `${pairId}-db`), buildFeature(pairId, `${pairId}-file`)];
}

describe("capFeaturesWithoutSplittingGroups", () => {
  it("should return the collection untouched when it fits within the limit", () => {
    const features = [...buildPair("a"), ...buildPair("b")];

    expect(capFeaturesWithoutSplittingGroups(features, 10)).toHaveLength(4);
  });

  it("should cut back to a group boundary rather than splitting a pair", () => {
    // Arrange: a limit of 3 would take pair "b"'s database half and drop its file half,
    // which would read on the map as "only in the database".
    const features = [...buildPair("a"), ...buildPair("b")];

    // Act
    const capped = capFeaturesWithoutSplittingGroups(features, 3);

    // Assert
    expect(capped).toHaveLength(2);
    expect(capped.map((feature) => feature.properties?.name)).toEqual(["a-db", "a-file"]);
  });

  it("should keep a whole group when the limit lands exactly on its boundary", () => {
    const features = [...buildPair("a"), ...buildPair("b")];

    const capped = capFeaturesWithoutSplittingGroups(features, 2);

    expect(capped.map((feature) => feature.properties?.name)).toEqual(["a-db", "a-file"]);
  });

  it("should behave as a plain prefix slice when features carry no group id", () => {
    const features = [buildFeature(), buildFeature(), buildFeature(), buildFeature()];

    expect(capFeaturesWithoutSplittingGroups(features, 3)).toHaveLength(3);
  });

  it("should return nothing when the first group alone exceeds the limit", () => {
    // Arrange: a group larger than the limit cannot be shown without splitting it.
    const features = [
      buildFeature("wide", "one"),
      buildFeature("wide", "two"),
      buildFeature("wide", "three"),
    ];

    // Assert: better to draw nothing than half a group.
    expect(capFeaturesWithoutSplittingGroups(features, 2)).toHaveLength(0);
  });

  it("should return nothing for a non-positive limit", () => {
    expect(capFeaturesWithoutSplittingGroups([...buildPair("a")], 0)).toHaveLength(0);
    expect(capFeaturesWithoutSplittingGroups([...buildPair("a")], -5)).toHaveLength(0);
  });

  it("should not treat a null group id as joining features together", () => {
    // Arrange: absent grouping must not accidentally merge unrelated features.
    const features = [
      { ...buildFeature(), properties: { _pairId: null } },
      { ...buildFeature(), properties: { _pairId: null } },
      { ...buildFeature(), properties: { _pairId: null } },
    ] as Feature[];

    expect(capFeaturesWithoutSplittingGroups(features, 2)).toHaveLength(2);
  });
});
