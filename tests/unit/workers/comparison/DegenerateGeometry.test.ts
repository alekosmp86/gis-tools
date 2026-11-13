import { describe, expect, it } from "vitest";
import {
  DEGENERATE_EXAMPLE_LIMIT,
  DEGENERATE_RELATIVE_EXTENT,
  DegenerateRowCollector,
  isDegenerateGeometry,
} from "@/core/workers/comparison/DegenerateGeometry";

const DEV_X = 6.6e5;
const DEV_Y = 6.15e6;
const DEV_LINE = [
  [DEV_X, DEV_Y],
  [DEV_X + 3.5e-10, DEV_Y],
];

describe("isDegenerateGeometry (DG-1)", () => {
  it("should expose the relative extent 1e-12 and the example limit 20", () => {
    expect(DEGENERATE_RELATIVE_EXTENT).toBe(1e-12);
    expect(DEGENERATE_EXAMPLE_LIMIT).toBe(20);
  });

  describe("LineString", () => {
    it("should be degenerate for the dev case: two points 3.5e-10 apart at coordinates near 6.6e5", () => {
      expect(isDegenerateGeometry({ type: "LineString", coordinates: DEV_LINE })).toBe(true);
    });

    it("should be degenerate for two identical points", () => {
      expect(isDegenerateGeometry({ type: "LineString", coordinates: [[1, 2], [1, 2]] })).toBe(true);
    });

    it("should not be degenerate for a 1 mm line at the same coordinates", () => {
      expect(isDegenerateGeometry({ type: "LineString", coordinates: [[DEV_X, DEV_Y], [DEV_X + 0.001, DEV_Y]] })).toBe(false);
    });

    it("should not be degenerate for an ordinary line", () => {
      expect(isDegenerateGeometry({ type: "LineString", coordinates: [[0, 0], [10, 10]] })).toBe(false);
    });

    it("should be degenerate when every vertex is within the tolerance, not only the first two", () => {
      const coordinates = [[DEV_X, DEV_Y], [DEV_X + 1e-10, DEV_Y], [DEV_X + 2e-10, DEV_Y + 1e-10], [DEV_X, DEV_Y]];

      expect(isDegenerateGeometry({ type: "LineString", coordinates })).toBe(true);
    });

    it("should not be degenerate when one vertex is far away", () => {
      expect(isDegenerateGeometry({ type: "LineString", coordinates: [[0, 0], [0, 0], [5, 0]] })).toBe(false);
    });

    it("should judge the extent in y as well as in x", () => {
      expect(isDegenerateGeometry({ type: "LineString", coordinates: [[0, 0], [0, 1]] })).toBe(false);
    });

    it("should use an absolute tolerance of 1e-12 near the origin, where the largest coordinate is below 1", () => {
      expect(isDegenerateGeometry({ type: "LineString", coordinates: [[0, 0], [5e-13, 0]] })).toBe(true);
      expect(isDegenerateGeometry({ type: "LineString", coordinates: [[0, 0], [5e-12, 0]] })).toBe(false);
    });

    it("should scale the tolerance with the largest absolute coordinate of the part", () => {
      expect(isDegenerateGeometry({ type: "LineString", coordinates: [[1e6, 0], [1e6 + 5e-7, 0]] })).toBe(true);
      expect(isDegenerateGeometry({ type: "LineString", coordinates: [[1e6, 0], [1e6 + 5e-5, 0]] })).toBe(false);
    });

    it("should not be degenerate when the coordinates are empty", () => {
      expect(isDegenerateGeometry({ type: "LineString", coordinates: [] })).toBe(false);
    });
  });

  describe("MultiLineString", () => {
    it("should be degenerate only when every part is degenerate (the dev EWKB case: one two-point part)", () => {
      expect(isDegenerateGeometry({ type: "MultiLineString", coordinates: [DEV_LINE] })).toBe(true);
      expect(isDegenerateGeometry({ type: "MultiLineString", coordinates: [DEV_LINE, DEV_LINE] })).toBe(true);
    });

    it("should not be degenerate when one part is a real line", () => {
      expect(isDegenerateGeometry({ type: "MultiLineString", coordinates: [DEV_LINE, [[0, 0], [10, 0]]] })).toBe(false);
    });

    it("should not be degenerate when it has no parts", () => {
      expect(isDegenerateGeometry({ type: "MultiLineString", coordinates: [] })).toBe(false);
    });
  });

  describe("Polygon", () => {
    it("should be degenerate when the outer ring has no extent in x", () => {
      const ring = [[5, 0], [5, 10], [5, 5], [5, 0]];

      expect(isDegenerateGeometry({ type: "Polygon", coordinates: [ring] })).toBe(true);
    });

    it("should be degenerate when the outer ring has no extent in y", () => {
      const ring = [[0, 7], [10, 7], [5, 7], [0, 7]];

      expect(isDegenerateGeometry({ type: "Polygon", coordinates: [ring] })).toBe(true);
    });

    it("should be degenerate when every vertex is the same point", () => {
      expect(isDegenerateGeometry({ type: "Polygon", coordinates: [[[1, 1], [1, 1], [1, 1], [1, 1]]] })).toBe(true);
    });

    it("should not be degenerate for a real polygon", () => {
      const ring = [[0, 0], [10, 0], [10, 10], [0, 0]];

      expect(isDegenerateGeometry({ type: "Polygon", coordinates: [ring] })).toBe(false);
    });

    it("should judge only the outer ring: a collapsed hole does not make a polygon degenerate", () => {
      const outer = [[0, 0], [10, 0], [10, 10], [0, 0]];
      const hole = [[2, 2], [2, 2], [2, 2], [2, 2]];

      expect(isDegenerateGeometry({ type: "Polygon", coordinates: [outer, hole] })).toBe(false);
    });

    it("should not be degenerate when it has no rings or an empty ring", () => {
      expect(isDegenerateGeometry({ type: "Polygon", coordinates: [] })).toBe(false);
      expect(isDegenerateGeometry({ type: "Polygon", coordinates: [[]] })).toBe(false);
    });
  });

  describe("MultiPolygon", () => {
    const real = [[[0, 0], [10, 0], [10, 10], [0, 0]]];
    const flat = [[[5, 0], [5, 10], [5, 5], [5, 0]]];

    it("should be degenerate only when every part is", () => {
      expect(isDegenerateGeometry({ type: "MultiPolygon", coordinates: [flat, flat] })).toBe(true);
      expect(isDegenerateGeometry({ type: "MultiPolygon", coordinates: [flat, real] })).toBe(false);
    });

    it("should not be degenerate when it has no parts", () => {
      expect(isDegenerateGeometry({ type: "MultiPolygon", coordinates: [] })).toBe(false);
    });
  });

  describe("never degenerate", () => {
    it("should never call a Point or a MultiPoint degenerate, even when all points coincide", () => {
      expect(isDegenerateGeometry({ type: "Point", coordinates: [1, 2] })).toBe(false);
      expect(isDegenerateGeometry({ type: "MultiPoint", coordinates: [[1, 2], [1, 2]] })).toBe(false);
    });

    it("should never call a GeometryCollection degenerate", () => {
      const collection = { type: "GeometryCollection", geometries: [{ type: "LineString", coordinates: DEV_LINE }] };

      expect(isDegenerateGeometry(collection)).toBe(false);
    });

    it.each([[null], [undefined], [{}], ["LineString"], [5], [{ type: "LineString" }], [{ type: "Unknown", coordinates: [[1, 1]] }]])(
      "should not be degenerate for %j",
      (geometry) => {
        expect(isDegenerateGeometry(geometry)).toBe(false);
      }
    );
  });
});

describe("DegenerateRowCollector (DG-2, DG-3)", () => {
  it("should start empty", () => {
    const collector = new DegenerateRowCollector();

    expect(collector.count).toBe(0);
    expect(collector.sample).toEqual([]);
  });

  it("should count every row and keep the examples in the order they were added", () => {
    const collector = new DegenerateRowCollector();

    collector.add(3, () => "A");
    collector.add(1, () => "B");
    collector.add(9, () => "C");

    expect(collector.count).toBe(3);
    expect(collector.sample).toEqual([
      { rowNumber: 3, suid: "A" },
      { rowNumber: 1, suid: "B" },
      { rowNumber: 9, suid: "C" },
    ]);
  });

  it("should keep only the first 20 examples while counting all rows", () => {
    const collector = new DegenerateRowCollector();

    for (let row = 1; row <= 25; row++) collector.add(row, () => `K${row}`);

    expect(collector.count).toBe(25);
    expect(collector.sample).toHaveLength(DEGENERATE_EXAMPLE_LIMIT);
    expect(collector.sample[0]).toEqual({ rowNumber: 1, suid: "K1" });
    expect(collector.sample[19]).toEqual({ rowNumber: 20, suid: "K20" });
  });

  it("should build the key of a row only for the examples it keeps", () => {
    const collector = new DegenerateRowCollector();
    let built = 0;

    for (let row = 1; row <= 30; row++) {
      collector.add(row, () => {
        built++;
        return "K";
      });
    }

    expect(built).toBe(DEGENERATE_EXAMPLE_LIMIT);
    expect(collector.count).toBe(30);
  });
});
