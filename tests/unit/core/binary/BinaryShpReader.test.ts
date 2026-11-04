import { describe, it, expect } from "vitest";
import type { LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon } from "geojson";
import { BinaryShpReader } from "@/core/binary/BinaryShpReader";
import {
  buildShpBuffer,
  multiPointRecord,
  nullRecord,
  pointRecord,
  polylineRecord,
  polygonRecord,
  type ShpRing,
} from "./support/shpBuilder";

/** Clockwise square (ESRI outer ring). */
function buildOuterSquare(originX: number, originY: number, size: number): ShpRing {
  return [
    [originX, originY],
    [originX, originY + size],
    [originX + size, originY + size],
    [originX + size, originY],
    [originX, originY],
  ];
}

/** Counter-clockwise square (ESRI hole). */
function buildHoleSquare(originX: number, originY: number, size: number): ShpRing {
  return [
    [originX, originY],
    [originX + size, originY],
    [originX + size, originY + size],
    [originX, originY + size],
    [originX, originY],
  ];
}

function swapAxes(coordinate: [number, number]): [number, number] {
  return [coordinate[1], coordinate[0]];
}

function transformRing(ring: ShpRing, transform: (coordinate: [number, number]) => [number, number]): ShpRing {
  return ring.map(([coordinateX, coordinateY]) => transform([coordinateX, coordinateY]));
}

describe("BinaryShpReader", () => {
  describe("readGeometry for polygon records", () => {
    it("should return a Polygon when the record has a single part", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([outer])]));

      const geometry = reader.readGeometry(0) as Polygon;

      expect(geometry.type).toBe("Polygon");
      expect(geometry.coordinates).toEqual([outer]);
    });

    it("should return a MultiPolygon with two polygons when the record has two separate outer rings", () => {
      const outerA = buildOuterSquare(0, 0, 10);
      const outerB = buildOuterSquare(100, 100, 10);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([outerA, outerB])]));

      const geometry = reader.readGeometry(0) as MultiPolygon;

      expect(geometry.type).toBe("MultiPolygon");
      expect(geometry.coordinates).toEqual([[outerA], [outerB]]);
    });

    it("should not reproduce the old output that treated the second outer ring as a hole", () => {
      const outerA = buildOuterSquare(0, 0, 10);
      const outerB = buildOuterSquare(100, 100, 10);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([outerA, outerB])]));

      const geometry = reader.readGeometry(0) as MultiPolygon;

      expect(geometry.coordinates).not.toEqual([[outerA, outerB]]);
      expect(geometry.coordinates).toHaveLength(2);
    });

    it("should return a MultiPolygon of one polygon with its hole when the record has an outer ring and a hole", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const hole = buildHoleSquare(2, 2, 3);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([outer, hole])]));

      const geometry = reader.readGeometry(0) as MultiPolygon;

      expect(geometry.type).toBe("MultiPolygon");
      expect(geometry.coordinates).toEqual([[outer, hole]]);
    });

    it("should assign the hole to the second outer ring when it lies inside it", () => {
      const outerA = buildOuterSquare(0, 0, 10);
      const outerB = buildOuterSquare(100, 100, 50);
      const hole = buildHoleSquare(110, 110, 5);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([outerA, outerB, hole])]));

      const geometry = reader.readGeometry(0) as MultiPolygon;

      expect(geometry.coordinates).toEqual([[outerA], [outerB, hole]]);
    });

    it.each([
      { label: "PolygonZ", shapeType: 15 as const },
      { label: "PolygonM", shapeType: 25 as const },
    ])("should return the same single-part Polygon as plain Polygon when the record is $label", ({ shapeType }) => {
      const outer = buildOuterSquare(0, 0, 10);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([outer], shapeType)]));

      const geometry = reader.readGeometry(0) as Polygon;

      expect(geometry.type).toBe("Polygon");
      expect(geometry.coordinates).toEqual([outer]);
    });

    it.each([
      { label: "PolygonZ", shapeType: 15 as const },
      { label: "PolygonM", shapeType: 25 as const },
    ])("should assemble multi-part rings like plain Polygon when the record is $label", ({ shapeType }) => {
      const outerA = buildOuterSquare(0, 0, 20);
      const hole = buildHoleSquare(2, 2, 3);
      const outerB = buildOuterSquare(100, 100, 10);
      const plainReader = new BinaryShpReader(buildShpBuffer([polygonRecord([outerA, hole, outerB], 5)]));
      const typedReader = new BinaryShpReader(buildShpBuffer([polygonRecord([outerA, hole, outerB], shapeType)]));

      const plainGeometry = plainReader.readGeometry(0);
      const typedGeometry = typedReader.readGeometry(0);

      expect(typedGeometry).toEqual(plainGeometry);
      expect((typedGeometry as MultiPolygon).coordinates).toEqual([[outerA, hole], [outerB]]);
    });

    it("should return null when the polygon record has zero parts", () => {
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([])]));

      expect(reader.readGeometry(0)).toBeNull();
    });

    it("should document the ESRI-orientation limitation by returning one polygon per ring when every ring is counter-clockwise", () => {
      const firstRing = buildHoleSquare(0, 0, 10);
      const secondRing = buildHoleSquare(100, 100, 10);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([firstRing, secondRing])]));

      const geometry = reader.readGeometry(0) as MultiPolygon;

      expect(geometry.type).toBe("MultiPolygon");
      expect(geometry.coordinates).toEqual([[firstRing], [secondRing]]);
    });

    it("should read each record independently when the file holds several polygons", () => {
      const first = buildOuterSquare(0, 0, 10);
      const secondA = buildOuterSquare(50, 50, 5);
      const secondB = buildOuterSquare(70, 70, 5);
      const reader = new BinaryShpReader(
        buildShpBuffer([polygonRecord([first]), polygonRecord([secondA, secondB])])
      );

      expect((reader.readGeometry(0) as Polygon).coordinates).toEqual([first]);
      expect((reader.readGeometry(1) as MultiPolygon).coordinates).toEqual([[secondA], [secondB]]);
    });
  });

  describe("transformCoordinate", () => {
    it("should apply the transform to every output coordinate of a Polygon", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([outer])]));
      const shift = ([coordinateX, coordinateY]: [number, number]): [number, number] => [
        coordinateX + 1,
        coordinateY + 2,
      ];

      const geometry = reader.readGeometry(0, shift) as Polygon;

      expect(geometry.coordinates).toEqual([transformRing(outer, shift)]);
    });

    it("should apply the transform to every output coordinate of a MultiPolygon including holes", () => {
      const outerA = buildOuterSquare(0, 0, 20);
      const hole = buildHoleSquare(2, 2, 3);
      const outerB = buildOuterSquare(100, 100, 10);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([outerA, hole, outerB])]));
      const shift = ([coordinateX, coordinateY]: [number, number]): [number, number] => [
        coordinateX + 1000,
        coordinateY - 1000,
      ];

      const geometry = reader.readGeometry(0, shift) as MultiPolygon;

      expect(geometry.coordinates).toEqual([
        [transformRing(outerA, shift), transformRing(hole, shift)],
        [transformRing(outerB, shift)],
      ]);
    });

    it("should judge orientation on raw coordinates when the transform swaps the axes", () => {
      const outerA = buildOuterSquare(0, 0, 20);
      const hole = buildHoleSquare(2, 2, 3);
      const outerB = buildOuterSquare(100, 100, 10);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([outerA, hole, outerB])]));

      const geometry = reader.readGeometry(0, swapAxes) as MultiPolygon;

      expect(geometry.coordinates).toEqual([
        [transformRing(outerA, swapAxes), transformRing(hole, swapAxes)],
        [transformRing(outerB, swapAxes)],
      ]);
    });

    it("should keep a hole attached to its shell when the swapped axes make the output orientation reversed", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const hole = buildHoleSquare(2, 2, 3);
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([outer, hole])]));

      const geometry = reader.readGeometry(0, swapAxes) as MultiPolygon;

      expect(geometry.coordinates).toEqual([[transformRing(outer, swapAxes), transformRing(hole, swapAxes)]]);
    });

    it("should apply the transform to point shapes", () => {
      const reader = new BinaryShpReader(buildShpBuffer([pointRecord([3, 4])]));

      const geometry = reader.readGeometry(0, swapAxes) as Point;

      expect(geometry.coordinates).toEqual([4, 3]);
    });
  });

  describe("non-polygon and invalid records", () => {
    it("should return null when the record is a null shape", () => {
      const reader = new BinaryShpReader(buildShpBuffer([nullRecord()]));

      expect(reader.readGeometry(0)).toBeNull();
    });

    it("should return a Point unchanged when the record is a point shape", () => {
      const reader = new BinaryShpReader(buildShpBuffer([pointRecord([3.5, -4.25])]));

      expect(reader.readGeometry(0)).toEqual({ type: "Point", coordinates: [3.5, -4.25] });
    });

    it("should return null when the record index is past the last record", () => {
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([buildOuterSquare(0, 0, 1)])]));

      expect(reader.readGeometry(1)).toBeNull();
    });

    it("should return null when the record index is negative", () => {
      const reader = new BinaryShpReader(buildShpBuffer([polygonRecord([buildOuterSquare(0, 0, 1)])]));

      expect(reader.readGeometry(-1)).toBeNull();
    });

    it("should expose one record per built shape", () => {
      const reader = new BinaryShpReader(
        buildShpBuffer([nullRecord(), pointRecord([1, 2]), polygonRecord([buildOuterSquare(0, 0, 1)])])
      );

      expect(reader.recordCount).toBe(3);
    });
  });

  describe("multipoint records", () => {
    it("should return a MultiPoint with every point in order", () => {
      const points = [[1, 2], [3, 4], [-5.5, 6.25]];
      const reader = new BinaryShpReader(buildShpBuffer([multiPointRecord(points)]));

      const geometry = reader.readGeometry(0) as MultiPoint;

      expect(geometry).toEqual({ type: "MultiPoint", coordinates: points });
    });

    it("should return an empty MultiPoint when the record has zero points", () => {
      const reader = new BinaryShpReader(buildShpBuffer([multiPointRecord([])]));

      expect(reader.readGeometry(0)).toEqual({ type: "MultiPoint", coordinates: [] });
    });

    it("should apply the transform to every point of a MultiPoint", () => {
      const reader = new BinaryShpReader(buildShpBuffer([multiPointRecord([[1, 2], [3, 4]])]));

      const geometry = reader.readGeometry(0, swapAxes) as MultiPoint;

      expect(geometry.coordinates).toEqual([[2, 1], [4, 3]]);
    });
  });

  describe("polyline records", () => {
    it("should return a LineString when the record has a single part", () => {
      const line = [[0, 0], [1, 1], [2, 0]];
      const reader = new BinaryShpReader(buildShpBuffer([polylineRecord([line])]));

      const geometry = reader.readGeometry(0) as LineString;

      expect(geometry).toEqual({ type: "LineString", coordinates: line });
    });

    it("should return a MultiLineString when the record has several parts", () => {
      const lineA = [[0, 0], [1, 1]];
      const lineB = [[10, 10], [11, 11], [12, 10]];
      const reader = new BinaryShpReader(buildShpBuffer([polylineRecord([lineA, lineB])]));

      const geometry = reader.readGeometry(0) as MultiLineString;

      expect(geometry).toEqual({ type: "MultiLineString", coordinates: [lineA, lineB] });
    });

    it("should apply the transform to every vertex of a LineString", () => {
      const reader = new BinaryShpReader(buildShpBuffer([polylineRecord([[[1, 2], [3, 4]]])]));

      const geometry = reader.readGeometry(0, swapAxes) as LineString;

      expect(geometry.coordinates).toEqual([[2, 1], [4, 3]]);
    });

    it("should apply the transform to every part of a MultiLineString", () => {
      const reader = new BinaryShpReader(
        buildShpBuffer([polylineRecord([[[1, 2], [3, 4]], [[5, 6], [7, 8]]])])
      );

      const geometry = reader.readGeometry(0, swapAxes) as MultiLineString;

      expect(geometry.coordinates).toEqual([[[2, 1], [4, 3]], [[6, 5], [8, 7]]]);
    });
  });

  describe("record mix", () => {
    it("should return null for a null shape and keep reading neighbouring records", () => {
      const reader = new BinaryShpReader(
        buildShpBuffer([nullRecord(), multiPointRecord([[1, 1]]), polylineRecord([[[0, 0], [1, 1]]])])
      );

      expect(reader.readGeometry(0)).toBeNull();
      expect(reader.readGeometry(1)).toEqual({ type: "MultiPoint", coordinates: [[1, 1]] });
      expect(reader.readGeometry(2)).toEqual({ type: "LineString", coordinates: [[0, 0], [1, 1]] });
    });

    it("should return null when the record shape type is unsupported", () => {
      const buffer = buildShpBuffer([pointRecord([1, 2])]);
      new DataView(buffer).setInt32(108, 31, true);
      const reader = new BinaryShpReader(buffer);

      expect(reader.readGeometry(0)).toBeNull();
    });
  });
});
