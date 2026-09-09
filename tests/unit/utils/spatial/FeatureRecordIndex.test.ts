import { describe, it, expect } from "vitest";
import type { Feature } from "geojson";
import { buildFeatureRecordIndex } from "@/core/spatial/FeatureRecordIndex";

function buildFeature(id?: number): Feature {
  return {
    ...(id === undefined ? {} : { id }),
    type: "Feature",
    geometry: { type: "Point", coordinates: [-56.1, -34.9] },
    properties: {},
  } as Feature;
}

describe("buildFeatureRecordIndex", () => {
  it("should translate a feature position to the record position stamped on its id", () => {
    // Arrange: records 1 and 3 produced no geometry, so features are 0, 2, 4.
    const features = [buildFeature(0), buildFeature(2), buildFeature(4)];

    // Act
    const featureRecordIndex = buildFeatureRecordIndex(features);

    // Assert
    expect(featureRecordIndex.toRecordIndex(0)).toBe(0);
    expect(featureRecordIndex.toRecordIndex(1)).toBe(2);
    expect(featureRecordIndex.toRecordIndex(2)).toBe(4);
  });

  it("should translate a record position back to the feature position", () => {
    // Arrange
    const features = [buildFeature(0), buildFeature(2), buildFeature(4)];

    // Act
    const featureRecordIndex = buildFeatureRecordIndex(features);

    // Assert
    expect(featureRecordIndex.toFeatureIndex(0)).toBe(0);
    expect(featureRecordIndex.toFeatureIndex(2)).toBe(1);
    expect(featureRecordIndex.toFeatureIndex(4)).toBe(2);
  });

  it("should return null for a record that produced no geometry", () => {
    // Arrange: record 1 has no corresponding feature.
    const features = [buildFeature(0), buildFeature(2)];

    // Act
    const featureRecordIndex = buildFeatureRecordIndex(features);

    // Assert
    expect(featureRecordIndex.toFeatureIndex(1)).toBeNull();
  });

  it("should return null for a feature position outside the collection", () => {
    // Arrange
    const featureRecordIndex = buildFeatureRecordIndex([buildFeature(0)]);

    // Act & Assert
    expect(featureRecordIndex.toRecordIndex(5)).toBeNull();
    expect(featureRecordIndex.toRecordIndex(-1)).toBeNull();
  });

  it("should fall back to positional identity when features carry no numeric id", () => {
    // Arrange: collections built by the comparison engines stamp no id.
    const features = [buildFeature(), buildFeature(), buildFeature()];

    // Act
    const featureRecordIndex = buildFeatureRecordIndex(features);

    // Assert
    expect(featureRecordIndex.toRecordIndex(2)).toBe(2);
    expect(featureRecordIndex.toFeatureIndex(2)).toBe(2);
  });

  it("should keep the first feature when two features claim the same record", () => {
    // Arrange
    const features = [buildFeature(7), buildFeature(7)];

    // Act
    const featureRecordIndex = buildFeatureRecordIndex(features);

    // Assert
    expect(featureRecordIndex.toFeatureIndex(7)).toBe(0);
  });

  it("should treat an undefined collection as empty rather than throwing", () => {
    // Arrange & Act
    const featureRecordIndex = buildFeatureRecordIndex(undefined);

    // Assert
    expect(featureRecordIndex.toRecordIndex(0)).toBeNull();
    expect(featureRecordIndex.toFeatureIndex(0)).toBeNull();
  });
});
