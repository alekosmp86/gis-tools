import { describe, it, expect } from "vitest";
import type { Feature } from "geojson";
import type { BBox } from "@/core/types/map";
import {
  ViewportFeatureIndex,
  computeFeatureBBox,
  computeGeometryBBox,
  calculateGridDimension,
  doBBoxesIntersect,
} from "@/core/spatial/ViewportFeatureIndex";

function createPointFeature(coordinateX: number, coordinateY: number, name = "point"): Feature {
  return {
    type: "Feature",
    geometry: {
      type: "Point",
      coordinates: [coordinateX, coordinateY],
    },
    properties: { name },
  };
}

function createPolygonFeature(
  minCoordinateX: number,
  minCoordinateY: number,
  maxCoordinateX: number,
  maxCoordinateY: number,
  name = "poly"
): Feature {
  return {
    type: "Feature",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [minCoordinateX, minCoordinateY],
          [maxCoordinateX, minCoordinateY],
          [maxCoordinateX, maxCoordinateY],
          [minCoordinateX, maxCoordinateY],
          [minCoordinateX, minCoordinateY],
        ],
      ],
    },
    properties: { name },
  };
}

describe("computeFeatureBBox & computeGeometryBBox", () => {
  it("should return null for features without geometry or with empty geometries", () => {
    const featureWithoutGeometry: Feature = {
      type: "Feature",
      geometry: null as unknown as import("geojson").Geometry,
      properties: {},
    };
    expect(computeFeatureBBox(featureWithoutGeometry)).toBeNull();

    const emptyLineString: Feature = {
      type: "Feature",
      geometry: { type: "LineString", coordinates: [] },
      properties: {},
    };
    expect(computeFeatureBBox(emptyLineString)).toBeNull();
  });

  it("should compute correct bounding box for standalone Geometry objects", () => {
    const pointGeometry: import("geojson").Point = {
      type: "Point",
      coordinates: [12, -34],
    };
    expect(computeGeometryBBox(pointGeometry)).toEqual([12, -34, 12, -34]);
    expect(computeGeometryBBox(null)).toBeNull();
  });

  it("should compute correct bounding box for GeometryCollection", () => {
    const geometryCollection: Feature = {
      type: "Feature",
      geometry: {
        type: "GeometryCollection",
        geometries: [
          { type: "Point", coordinates: [-10, 5] },
          { type: "Point", coordinates: [25, 40] },
        ],
      },
      properties: {},
    };
    expect(computeFeatureBBox(geometryCollection)).toEqual([-10, 5, 25, 40]);
  });
});

describe("doBBoxesIntersect", () => {
  it("should return true when bounding boxes overlap", () => {
    const firstBBox: BBox = [0, 0, 10, 10];
    const secondBBox: BBox = [5, 5, 15, 15];
    expect(doBBoxesIntersect(firstBBox, secondBBox)).toBe(true);
  });

  it("should return false when bounding boxes are completely disjoint", () => {
    const firstBBox: BBox = [0, 0, 5, 5];
    const secondBBox: BBox = [10, 10, 20, 20];
    expect(doBBoxesIntersect(firstBBox, secondBBox)).toBe(false);
  });
});

describe("calculateGridDimension", () => {
  it("should handle featureCount = 1 and clamp to minimum dimension 4", () => {
    // Arrange & Act
    const dimensionForOne = calculateGridDimension(1);
    const dimensionForZero = calculateGridDimension(0);
    const dimensionForTen = calculateGridDimension(10);

    // Assert
    expect(dimensionForOne).toBe(4);
    expect(dimensionForZero).toBe(4);
    expect(dimensionForTen).toBe(4);
  });

  it("should clamp very large feature counts to maximum dimension 512", () => {
    // Arrange & Act: 100M features would otherwise require thousands of cells
    const dimensionForHundredMillion = calculateGridDimension(100_000_000);

    // Assert
    expect(dimensionForHundredMillion).toBe(512);
  });
});

describe("ViewportFeatureIndex", () => {
  it("should return no candidates for any query when collection is empty", () => {
    // Arrange
    const index = new ViewportFeatureIndex([]);
    const queryBBox: BBox = [-180, -90, 180, 90];

    // Act
    const candidates = index.queryBBox(queryBBox);

    // Assert
    expect(candidates).toEqual([]);
    expect(index.getCollectionBBox()).toBeNull();
  });

  it("should return every feature index when query bbox fully contains collection extent", () => {
    // Arrange
    const features = [
      createPointFeature(10, 10, "point-1"),
      createPointFeature(20, 20, "point-2"),
      createPolygonFeature(5, 5, 15, 15, "poly-1"),
    ];
    const index = new ViewportFeatureIndex(features);
    const wideQueryBBox: BBox = [0, 0, 50, 50];

    // Act
    const candidates = index.queryBBox(wideQueryBBox);

    // Assert: all 3 features included in ascending index order
    expect(candidates).toEqual([0, 1, 2]);
    expect(index.getCollectionBBox()).toEqual([5, 5, 20, 20]);
  });

  it("should include features whose bounding boxes only partially overlap the query bbox", () => {
    // Arrange: polygon spans x:[10..30], y:[10..30]; query spans x:[25..50], y:[25..50]
    const features = [
      createPolygonFeature(10, 10, 30, 30, "overlapping-poly"),
    ];
    const index = new ViewportFeatureIndex(features);
    const partialQueryBBox: BBox = [25, 25, 50, 50];

    // Act
    const candidates = index.queryBBox(partialQueryBBox);

    // Assert
    expect(candidates).toEqual([0]);
  });

  it("should exclude features entirely outside the query bbox", () => {
    // Arrange
    const features = [
      createPointFeature(10, 10, "inside"),
      createPointFeature(100, 100, "outside"),
    ];
    const index = new ViewportFeatureIndex(features);
    const localizedQueryBBox: BBox = [5, 5, 15, 15];

    // Act
    const candidates = index.queryBBox(localizedQueryBBox);

    // Assert
    expect(candidates).toEqual([0]);
  });

  it("should include point features at the exact edge of a query bbox", () => {
    // Arrange: point located exactly on the minimum boundary [10, 10]
    const features = [
      createPointFeature(10, 10, "on-edge-point"),
      createPointFeature(20, 20, "far-point"),
    ];
    const index = new ViewportFeatureIndex(features);
    const edgeQueryBBox: BBox = [10, 10, 15, 15];

    // Act
    const candidates = index.queryBBox(edgeQueryBBox);

    // Assert
    expect(candidates).toEqual([0]);
  });

  it("should retain all features when degenerate density places every feature in the same cell", () => {
    // Arrange: 50 features located at identical or near-identical coordinates
    const features: Feature[] = [];
    for (let featureIndex = 0; featureIndex < 50; featureIndex++) {
      features.push(createPointFeature(15.0001, -34.0001, `dense-${featureIndex}`));
    }
    const index = new ViewportFeatureIndex(features);
    const containingQueryBBox: BBox = [14, -35, 16, -33];

    // Act
    const candidates = index.queryBBox(containingQueryBBox);

    // Assert: none may be lost
    expect(candidates).toHaveLength(50);
    expect(candidates[0]).toBe(0);
    expect(candidates[49]).toBe(49);
  });
});
