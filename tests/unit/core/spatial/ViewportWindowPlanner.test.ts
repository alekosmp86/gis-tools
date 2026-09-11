import { describe, it, expect } from "vitest";
import type { Feature } from "geojson";
import type { BBox } from "@/core/types/map";
import { ViewportFeatureIndex } from "@/core/spatial/ViewportFeatureIndex";
import {
  planViewportWindow,
  isBBoxContained,
  expandBBox,
} from "@/core/spatial/ViewportWindowPlanner";

function buildFeature(coordinateX: number, coordinateY: number, pairId?: string, name = "feature"): Feature {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [coordinateX, coordinateY],
    },
    properties: pairId === undefined ? { name } : { name, _pairId: pairId },
  };
}

function buildPair(coordinateX: number, coordinateY: number, pairId: string): Feature[] {
  return [
    buildFeature(coordinateX, coordinateY, pairId, `${pairId}-db`),
    buildFeature(coordinateX, coordinateY, pairId, `${pairId}-file`),
  ];
}

describe("isBBoxContained & expandBBox", () => {
  it("should return true when inner bbox is completely contained inside outer bbox", () => {
    const innerBBox: BBox = [10, 10, 20, 20];
    const outerBBox: BBox = [5, 5, 25, 25];
    expect(isBBoxContained(innerBBox, outerBBox)).toBe(true);
  });

  it("should return false when inner bbox extends outside outer bbox", () => {
    const innerBBox: BBox = [0, 10, 20, 20];
    const outerBBox: BBox = [5, 5, 25, 25];
    expect(isBBoxContained(innerBBox, outerBBox)).toBe(false);
  });

  it("should expand bbox symmetrically by the specified padding ratio", () => {
    const baseBBox: BBox = [10, 10, 20, 20]; // width=10, height=10
    const expanded = expandBBox(baseBBox, 1.0); // 100% on every side
    expect(expanded).toEqual([0, 0, 30, 30]);
  });
});

describe("planViewportWindow", () => {
  it("should return shouldRebuild: false and reference-stable collection when viewport is fully inside previous window bbox", () => {
    // Arrange: previous window covers [0, 0, 50, 50], current viewport is well within [10, 10, 20, 20]
    const features = [buildFeature(15, 15, undefined, "f1")];
    const index = new ViewportFeatureIndex(features);
    const previousWindowBBox: BBox = [0, 0, 50, 50];
    const currentViewportBBox: BBox = [10, 10, 20, 20];
    const existingFeatures: Feature[] = [features[0]];

    // Act
    const plan = planViewportWindow(
      index,
      features,
      currentViewportBBox,
      previousWindowBBox,
      {
        paddingRatio: 1.0,
        maxRenderFeatures: 50_000,
        previousWindowFeatures: existingFeatures,
      }
    );

    // Assert
    expect(plan.shouldRebuild).toBe(false);
    expect(plan.windowedFeatures).toBe(existingFeatures);
    expect(plan.newWindowBBox).toBe(previousWindowBBox);
  });

  it("should return shouldRebuild: true when viewport partially extends outside previous window bbox", () => {
    // Arrange: previous window covers [0, 0, 50, 50], viewport reaches x: 55
    const features = [buildFeature(15, 15, undefined, "f1")];
    const index = new ViewportFeatureIndex(features);
    const previousWindowBBox: BBox = [0, 0, 50, 50];
    const currentViewportBBox: BBox = [10, 10, 55, 20];

    // Act
    const plan = planViewportWindow(
      index,
      features,
      currentViewportBBox,
      previousWindowBBox,
      {
        paddingRatio: 1.0,
        maxRenderFeatures: 50_000,
      }
    );

    // Assert
    expect(plan.shouldRebuild).toBe(true);
    expect(plan.newWindowBBox).toEqual([-35, 0, 100, 30]);
  });

  it("should always rebuild when previousWindowBBox is null on first run", () => {
    // Arrange
    const features = [buildFeature(10, 10, undefined, "initial")];
    const index = new ViewportFeatureIndex(features);
    const currentViewportBBox: BBox = [0, 0, 20, 20];

    // Act
    const plan = planViewportWindow(
      index,
      features,
      currentViewportBBox,
      null,
      {
        paddingRatio: 1.0,
        maxRenderFeatures: 50_000,
      }
    );

    // Assert
    expect(plan.shouldRebuild).toBe(true);
    expect(plan.windowedFeatures).toHaveLength(1);
    expect(plan.windowedFeatures[0]).toBe(features[0]);
  });

  it("should not apply capping when candidate count is under maxRenderFeatures", () => {
    // Arrange: 4 features, limit 10
    const features = [
      buildFeature(1, 1),
      buildFeature(2, 2),
      buildFeature(3, 3),
      buildFeature(4, 4),
    ];
    const index = new ViewportFeatureIndex(features);
    const wideViewport: BBox = [0, 0, 10, 10];

    // Act
    const plan = planViewportWindow(
      index,
      features,
      wideViewport,
      null,
      {
        paddingRatio: 0.5,
        maxRenderFeatures: 10,
      }
    );

    // Assert
    expect(plan.windowedFeatures).toHaveLength(4);
  });

  it("should apply capFeaturesWithoutSplittingGroups when candidates exceed maxRenderFeatures without splitting a _pairId group", () => {
    // Arrange: 2 pairs (4 features total). If limit is 3, pair "b" must not be split
    const features = [
      ...buildPair(1, 1, "pair-a"),
      ...buildPair(2, 2, "pair-b"),
    ];
    const index = new ViewportFeatureIndex(features);
    const wideViewport: BBox = [0, 0, 10, 10];

    // Act: maxRenderFeatures set to 3
    const plan = planViewportWindow(
      index,
      features,
      wideViewport,
      null,
      {
        paddingRatio: 0.5,
        maxRenderFeatures: 3,
      }
    );

    // Assert: only pair-a should be retained (length 2)
    expect(plan.windowedFeatures).toHaveLength(2);
    expect(plan.windowedFeatures[0].properties?._pairId).toBe("pair-a");
    expect(plan.windowedFeatures[1].properties?._pairId).toBe("pair-a");
  });

  it("should preserve exact source feature object references using toBe identity assertions", () => {
    // Arrange
    const firstFeature = buildFeature(5, 5, undefined, "first");
    const secondFeature = buildFeature(6, 6, undefined, "second");
    const features = [firstFeature, secondFeature];
    const index = new ViewportFeatureIndex(features);
    const viewport: BBox = [0, 0, 10, 10];

    // Act
    const plan = planViewportWindow(
      index,
      features,
      viewport,
      null,
      {
        paddingRatio: 1.0,
        maxRenderFeatures: 100,
      }
    );

    // Assert: must be the exact same object references in memory
    expect(plan.windowedFeatures[0]).toBe(firstFeature);
    expect(plan.windowedFeatures[1]).toBe(secondFeature);
  });

  it("should return all candidate features without capping when maxRenderFeatures is null", () => {
    // Arrange: 4 pairs (8 features total)
    const features = [
      ...buildPair(1, 1, "pair-a"),
      ...buildPair(2, 2, "pair-b"),
      ...buildPair(3, 3, "pair-c"),
      ...buildPair(4, 4, "pair-d"),
    ];
    const index = new ViewportFeatureIndex(features);
    const wideViewport: BBox = [0, 0, 10, 10];

    // Act: maxRenderFeatures set to null (neverCapViewportRender contract)
    const plan = planViewportWindow(
      index,
      features,
      wideViewport,
      null,
      {
        paddingRatio: 0.5,
        maxRenderFeatures: null,
      }
    );

    // Assert: all 8 features must be retained, unrouted through capping
    expect(plan.windowedFeatures).toHaveLength(8);
    for (let featureIndex = 0; featureIndex < features.length; featureIndex++) {
      expect(plan.windowedFeatures[featureIndex]).toBe(features[featureIndex]);
    }
  });
});
