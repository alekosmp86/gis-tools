import { describe, it, expect } from "vitest";
import { geometryDistance, prepareGeometry } from "@/core/workers/comparison/GeometryDistance";

const point = (x: number, y: number) => ({ type: "Point", coordinates: [x, y] });
const line = (...vertices: number[][]) => ({ type: "LineString", coordinates: vertices });
const square = (x: number, y: number, size: number) => ({
  type: "Polygon",
  coordinates: [
    [
      [x, y],
      [x + size, y],
      [x + size, y + size],
      [x, y + size],
      [x, y],
    ],
  ],
});

function distance(first: unknown, second: unknown): number {
  return geometryDistance(prepareGeometry(first), prepareGeometry(second));
}

describe("GeometryDistance", () => {
  describe("prepareGeometry", () => {
    it.each([
      ["null", null],
      ["undefined", undefined],
      ["a string", "POINT(0 0)"],
      ["a number", 42],
      ["an object without type", { coordinates: [0, 0] }],
      ["an unsupported type", { type: "GeometryCollection", geometries: [] }],
      ["a point with non-finite coordinates", point(Number.NaN, 1)],
      ["a point with too few coordinates", { type: "Point", coordinates: [1] }],
      ["an empty line", line()],
      ["a multipolygon without parts", { type: "MultiPolygon", coordinates: [] }],
    ])("should return null for %s", (_label, geometry) => {
      // Act
      const prepared = prepareGeometry(geometry);

      // Assert
      expect(prepared).toBeNull();
    });

    it("should use the coordinate itself as the centroid of a point", () => {
      // Act
      const prepared = prepareGeometry(point(3, -4));

      // Assert
      expect(prepared?.centroid).toEqual([3, -4]);
      expect(prepared?.isLine).toBe(false);
    });

    it("should ignore the closing vertex when computing a polygon centroid", () => {
      // Act
      const prepared = prepareGeometry(square(0, 0, 2));

      // Assert
      expect(prepared?.centroid).toEqual([1, 1]);
    });

    it("should average part centroids for multi geometries", () => {
      // Arrange
      const multiPoint = { type: "MultiPoint", coordinates: [[0, 0], [4, 0]] };
      const multiPolygon = {
        type: "MultiPolygon",
        coordinates: [square(0, 0, 2).coordinates, square(4, 0, 2).coordinates],
      };

      // Act
      const pointCentroid = prepareGeometry(multiPoint)?.centroid;
      const polygonCentroid = prepareGeometry(multiPolygon)?.centroid;

      // Assert
      expect(pointCentroid).toEqual([2, 0]);
      expect(polygonCentroid).toEqual([3, 1]);
    });

    it("should flag line geometries and cap sampled vertices at 16", () => {
      // Arrange
      const vertices = Array.from({ length: 100 }, (_unused, index) => [index, 0]);

      // Act
      const prepared = prepareGeometry(line(...vertices));

      // Assert
      expect(prepared?.isLine).toBe(true);
      expect(prepared?.samples).toHaveLength(16);
      expect(prepared?.samples[0]).toEqual([0, 0]);
      expect(prepared?.samples[15]).toEqual([99, 0]);
    });

    it("should flag MultiLineString as a line", () => {
      // Act
      const prepared = prepareGeometry({
        type: "MultiLineString",
        coordinates: [[[0, 0], [1, 0]], [[5, 0], [6, 0]]],
      });

      // Assert
      expect(prepared?.isLine).toBe(true);
      expect(prepared?.centroid).toEqual([3, 0]);
    });
  });

  describe("geometryDistance", () => {
    it("should return the Euclidean distance between two points", () => {
      // Act
      const result = distance(point(0, 0), point(3, 4));

      // Assert
      expect(result).toBe(5);
    });

    it("should return zero for identical geometries", () => {
      // Act / Assert
      expect(distance(point(1, 1), point(1, 1))).toBe(0);
      expect(distance(square(0, 0, 2), square(0, 0, 2))).toBe(0);
      expect(distance(line([0, 0], [5, 5]), line([0, 0], [5, 5]))).toBe(0);
    });

    it("should be symmetric", () => {
      // Arrange
      const first = line([0, 0], [10, 0]);
      const second = line([0, 0], [2, 0]);

      // Act / Assert
      expect(distance(first, second)).toBe(distance(second, first));
    });

    it("should return Infinity when either geometry is missing", () => {
      // Act / Assert
      expect(geometryDistance(null, prepareGeometry(point(0, 0)))).toBe(Infinity);
      expect(geometryDistance(prepareGeometry(point(0, 0)), null)).toBe(Infinity);
      expect(geometryDistance(null, null)).toBe(Infinity);
    });

    it("should use the polygon centroid distance for polygons", () => {
      // Act
      const result = distance(square(0, 0, 2), square(3, 4, 2));

      // Assert
      expect(result).toBe(5);
    });

    it("should use the centroid distance when only one geometry is a line", () => {
      // Act
      const result = distance(line([0, 0], [10, 0]), point(5, 3));

      // Assert
      expect(result).toBe(3);
    });

    it("should use the sampled Hausdorff distance for lines when it exceeds the centroid distance", () => {
      // Arrange: centroids (5,0) and (1,0) are 4 apart, but vertex (10,0) is 8 from the short line.
      const long = line([0, 0], [10, 0]);
      const short = line([0, 0], [2, 0]);

      // Act
      const result = distance(long, short);

      // Assert
      expect(result).toBe(8);
    });

    it("should use the centroid distance for lines when it exceeds the Hausdorff distance", () => {
      // Arrange: a line translated by (3,4): centroid distance 5, Hausdorff also 5 -> use max.
      const first = line([0, 0], [10, 0]);
      const second = line([3, 4], [13, 4]);

      // Act
      const result = distance(first, second);

      // Assert
      expect(result).toBe(5);
    });

    it("should keep working for long lines above the sample cap", () => {
      // Arrange
      const vertices = Array.from({ length: 200 }, (_unused, index) => [index, 0]);
      const shifted = vertices.map(([x, y]) => [x, y + 2]);

      // Act
      const result = distance(line(...vertices), line(...shifted));

      // Assert
      expect(result).toBeCloseTo(2, 10);
    });
  });
});
