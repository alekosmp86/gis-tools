import { describe, it, expect } from "vitest";
import { assemblePolygons } from "@/core/spatial/PolygonRingAssembler";

type Ring = number[][];

/** Clockwise square (ESRI outer ring) with its lower-left corner at (originX, originY). */
function buildOuterSquare(originX: number, originY: number, size: number): Ring {
  return [
    [originX, originY],
    [originX, originY + size],
    [originX + size, originY + size],
    [originX + size, originY],
    [originX, originY],
  ];
}

/** Counter-clockwise square (ESRI hole) with its lower-left corner at (originX, originY). */
function buildHoleSquare(originX: number, originY: number, size: number): Ring {
  return [
    [originX, originY],
    [originX + size, originY],
    [originX + size, originY + size],
    [originX, originY + size],
    [originX, originY],
  ];
}

/** Deterministic PRNG (mulberry32) returning values in [0, 1). */
function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), state | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clockwise closed star: alternating tip and valley vertices around the origin. */
function buildStarShell(vertexCount: number, tipRadius: number, valleyRadius: number): Ring {
  const star: Ring = [];
  for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
    const angle = -(2 * Math.PI * vertexIndex) / vertexCount;
    const radius = vertexIndex % 2 === 0 ? tipRadius : valleyRadius;
    star.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
  }
  star.push([...star[0]]);
  return star;
}

function referenceAbsoluteArea(ring: Ring): number {
  let doubledArea = 0;
  for (let index = 0; index < ring.length - 1; index++) {
    doubledArea += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return Math.abs(doubledArea / 2);
}

function referenceIsOnBoundary(pointX: number, pointY: number, ring: Ring): boolean {
  for (let index = 0; index < ring.length - 1; index++) {
    const [startX, startY] = ring[index];
    const [endX, endY] = ring[index + 1];
    const cross = (endX - startX) * (pointY - startY) - (endY - startY) * (pointX - startX);
    const withinX = pointX >= Math.min(startX, endX) && pointX <= Math.max(startX, endX);
    const withinY = pointY >= Math.min(startY, endY) && pointY <= Math.max(startY, endY);
    if (cross === 0 && withinX && withinY) return true;
  }
  return false;
}

function referenceIsInsideEvenOdd(pointX: number, pointY: number, ring: Ring): boolean {
  let inside = false;
  for (let index = 0; index < ring.length - 1; index++) {
    const [startX, startY] = ring[index];
    const [endX, endY] = ring[index + 1];
    if (startY > pointY !== endY > pointY) {
      const crossingX = startX + ((pointY - startY) * (endX - startX)) / (endY - startY);
      if (pointX < crossingX) inside = !inside;
    }
  }
  return inside;
}

/** First vertex not on the outer boundary decides; the hole box must fit in the outer box. */
function referenceIsHoleInside(hole: Ring, outer: Ring): boolean {
  const holeXs = hole.map(([pointX]) => pointX);
  const holeYs = hole.map(([, pointY]) => pointY);
  const outerXs = outer.map(([pointX]) => pointX);
  const outerYs = outer.map(([, pointY]) => pointY);
  const fitsInBox =
    Math.min(...holeXs) >= Math.min(...outerXs) &&
    Math.max(...holeXs) <= Math.max(...outerXs) &&
    Math.min(...holeYs) >= Math.min(...outerYs) &&
    Math.max(...holeYs) <= Math.max(...outerYs);
  if (!fitsInBox) return false;
  for (const [pointX, pointY] of hole) {
    if (referenceIsOnBoundary(pointX, pointY, outer)) continue;
    return referenceIsInsideEvenOdd(pointX, pointY, outer);
  }
  return false;
}

function referenceFindOwner(hole: Ring, outers: Ring[]): Ring | null {
  const outersByArea = [...outers].sort((first, second) => referenceAbsoluteArea(first) - referenceAbsoluteArea(second));
  return outersByArea.find((outer) => referenceIsHoleInside(hole, outer)) ?? null;
}

/** For every hole: the shell of the polygon it ended up in, or null when it is a polygon of its own. */
function mapHoleOwners(holes: Ring[], polygons: Ring[][]): (Ring | null)[] {
  return holes.map((hole) => {
    const polygon = polygons.find((candidate) => candidate.includes(hole));
    if (!polygon) throw new Error("hole missing from the output");
    return polygon[0] === hole ? null : polygon[0];
  });
}

function expectRingConservation(inputRings: Ring[], polygons: Ring[][]): void {
  const outputRings = polygons.flat();
  expect(outputRings).toHaveLength(inputRings.length);
  for (const inputRing of inputRings) {
    expect(outputRings.filter((outputRing) => outputRing === inputRing)).toHaveLength(1);
  }
}

describe("assemblePolygons", () => {
  describe("basic grouping", () => {
    it("should return an empty list when there are no rings", () => {
      expect(assemblePolygons([])).toEqual([]);
    });

    it("should return one polygon with only the shell when given a single outer ring", () => {
      const outer = buildOuterSquare(0, 0, 10);

      expect(assemblePolygons([outer])).toEqual([[outer]]);
    });

    it("should attach the hole to the shell when given an outer ring and one hole", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const hole = buildHoleSquare(2, 2, 3);

      expect(assemblePolygons([outer, hole])).toEqual([[outer, hole]]);
    });

    it("should attach both holes to the shell in file order when given an outer ring and two holes", () => {
      const outer = buildOuterSquare(0, 0, 20);
      const firstHole = buildHoleSquare(2, 2, 3);
      const secondHole = buildHoleSquare(10, 10, 3);

      expect(assemblePolygons([outer, firstHole, secondHole])).toEqual([[outer, firstHole, secondHole]]);
    });

    it("should return two separate polygons when given two disjoint outer rings", () => {
      const outerA = buildOuterSquare(0, 0, 10);
      const outerB = buildOuterSquare(100, 100, 10);

      const polygons = assemblePolygons([outerA, outerB]);

      expect(polygons).toEqual([[outerA], [outerB]]);
      expect(polygons).not.toEqual([[outerA, outerB]]);
    });

    it("should preserve the file order of the outer rings", () => {
      const small = buildOuterSquare(0, 0, 1);
      const large = buildOuterSquare(50, 50, 40);
      const medium = buildOuterSquare(200, 200, 10);

      const polygons = assemblePolygons([small, large, medium]);

      expect(polygons.map((polygon) => polygon[0])).toEqual([small, large, medium]);
    });
  });

  describe("hole assignment", () => {
    it("should assign the hole to the second outer ring when it lies inside it", () => {
      const outerA = buildOuterSquare(0, 0, 10);
      const outerB = buildOuterSquare(100, 100, 50);
      const hole = buildHoleSquare(110, 110, 5);

      expect(assemblePolygons([outerA, outerB, hole])).toEqual([[outerA], [outerB, hole]]);
    });

    it("should assign the hole to the smallest outer ring when a bigger outer ring also contains it", () => {
      const bigOuter = buildOuterSquare(0, 0, 100);
      const smallOuter = buildOuterSquare(10, 10, 20);
      const hole = buildHoleSquare(15, 15, 2);

      const polygons = assemblePolygons([bigOuter, smallOuter, hole]);

      expect(polygons).toEqual([[bigOuter], [smallOuter, hole]]);
    });

    it("should assign the hole to the smallest outer ring regardless of the ring order", () => {
      const bigOuter = buildOuterSquare(0, 0, 100);
      const smallOuter = buildOuterSquare(10, 10, 20);
      const hole = buildHoleSquare(15, 15, 2);

      const polygons = assemblePolygons([hole, smallOuter, bigOuter]);

      expect(polygons).toHaveLength(2);
      expect(polygons).toContainEqual([smallOuter, hole]);
      expect(polygons).toContainEqual([bigOuter]);
    });

    it("should treat an island inside a hole as its own polygon", () => {
      const outer = buildOuterSquare(0, 0, 100);
      const hole = buildHoleSquare(10, 10, 80);
      const island = buildOuterSquare(40, 40, 10);

      const polygons = assemblePolygons([outer, hole, island]);

      expect(polygons).toEqual([[outer, hole], [island]]);
    });

    it("should keep an orphan hole as a polygon of its own instead of dropping it", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const orphanHole = buildHoleSquare(500, 500, 5);

      const polygons = assemblePolygons([outer, orphanHole]);

      expect(polygons).toEqual([[outer], [orphanHole]]);
    });

    it("should return the orphan hole as a polygon when there are no outer rings at all", () => {
      const orphanHole = buildHoleSquare(0, 0, 5);

      expect(assemblePolygons([orphanHole])).toEqual([[orphanHole]]);
    });

    it("should assign a hole whose first vertex touches the shell boundary using a later interior vertex", () => {
      const outer = buildOuterSquare(0, 0, 10);
      // Counter-clockwise triangle whose first vertex lies on the left edge of the shell.
      const touchingHole: Ring = [
        [0, 5],
        [4, 3],
        [4, 7],
        [0, 5],
      ];

      expect(assemblePolygons([outer, touchingHole])).toEqual([[outer, touchingHole]]);
    });

    it("should not assign a hole touching the shell from the outside using only its boundary vertex", () => {
      const outer = buildOuterSquare(0, 0, 10);
      // Counter-clockwise triangle outside the shell, first vertex touching the right edge.
      const outsideHole: Ring = [
        [10, 5],
        [14, 7],
        [14, 3],
        [10, 5],
      ];

      expect(assemblePolygons([outer, outsideHole])).toEqual([[outer], [outsideHole]]);
    });
  });

  describe("orientation classification", () => {
    it("should keep a zero-area ring as an outer ring", () => {
      const degenerate: Ring = [
        [0, 0],
        [5, 5],
        [0, 0],
      ];

      expect(assemblePolygons([degenerate])).toEqual([[degenerate]]);
    });

    it("should keep a zero-area ring as its own polygon next to a regular outer ring", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const degenerate: Ring = [
        [50, 50],
        [60, 60],
        [50, 50],
      ];

      expect(assemblePolygons([outer, degenerate])).toEqual([[outer], [degenerate]]);
    });

    it("should classify rings correctly when all coordinates are negative", () => {
      const outer = buildOuterSquare(-100, -100, 50);
      const hole = buildHoleSquare(-90, -90, 10);

      expect(assemblePolygons([outer, hole])).toEqual([[outer, hole]]);
    });

    it("should classify rings correctly when coordinates are large UTM values", () => {
      const outer = buildOuterSquare(500000, 6100000, 1000);
      const hole = buildHoleSquare(500100, 6100100, 100);
      const otherOuter = buildOuterSquare(510000, 6110000, 1000);

      const polygons = assemblePolygons([outer, hole, otherOuter]);

      expect(polygons).toEqual([[outer, hole], [otherOuter]]);
    });

    it("should classify rings correctly when coordinates straddle the origin", () => {
      const outer = buildOuterSquare(-10, -10, 20);
      const hole = buildHoleSquare(-2, -2, 4);

      expect(assemblePolygons([outer, hole])).toEqual([[outer, hole]]);
    });
  });

  describe("known orientation limitation", () => {
    it("should document the ESRI-orientation limitation by giving each ring its own polygon when every ring is counter-clockwise", () => {
      const firstRing = buildHoleSquare(0, 0, 10);
      const secondRing = buildHoleSquare(100, 100, 10);
      const nestedRing = buildHoleSquare(2, 2, 3);

      const polygons = assemblePolygons([firstRing, secondRing, nestedRing]);

      expect(polygons).toEqual([[firstRing], [secondRing], [nestedRing]]);
    });
  });

  describe("index boundary rows", () => {
    it("should attach a hole whose first vertex lies on the top edge of the shell using a later vertex", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const topTouchingHole: Ring = [
        [5, 10],
        [3, 8],
        [7, 8],
        [5, 10],
      ];

      expect(assemblePolygons([outer, topTouchingHole])).toEqual([[outer, topTouchingHole]]);
    });

    it("should attach a hole whose first vertex lies on the bottom edge of the shell using a later vertex", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const bottomTouchingHole: Ring = [
        [5, 0],
        [7, 2],
        [3, 2],
        [5, 0],
      ];

      expect(assemblePolygons([outer, bottomTouchingHole])).toEqual([[outer, bottomTouchingHole]]);
    });

    it("should keep a hole entirely above the shell maximum Y as an orphan polygon", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const holeAbove = buildHoleSquare(2, 12, 2);

      expect(assemblePolygons([outer, holeAbove])).toEqual([[outer], [holeAbove]]);
    });

    it("should attach a hole whose first vertex is exactly the shell corner and whose other vertices are inside", () => {
      const outer = buildOuterSquare(0, 0, 10);
      const cornerHole: Ring = [
        [10, 10],
        [8, 9],
        [9, 8],
        [10, 10],
      ];

      expect(assemblePolygons([outer, cornerHole])).toEqual([[outer, cornerHole]]);
    });

    it("should not throw and should keep every ring once when the shell has zero height", () => {
      const flatShell: Ring = [
        [0, 0],
        [5, 0],
        [10, 0],
        [0, 0],
      ];
      const hole = buildHoleSquare(1, 0, 2);

      const polygons = assemblePolygons([flatShell, hole]);

      expectRingConservation([flatShell, hole], polygons);
    });

    it("should not throw and should keep every ring once when the shell contains a NaN vertex", () => {
      const brokenShell: Ring = [
        [0, 0],
        [0, 10],
        [Number.NaN, 10],
        [10, 0],
        [0, 0],
      ];
      const hole = buildHoleSquare(2, 2, 2);

      const polygons = assemblePolygons([brokenShell, hole]);

      expectRingConservation([brokenShell, hole], polygons);
    });
  });

  describe("equivalence with a reference implementation", () => {
    it("should assign every hole to the same outer ring as the reference when the shell is a concave star", () => {
      const nextRandom = createSeededRandom(20240607);
      const starShell = buildStarShell(500, 100, 40);
      const centreSquare = buildOuterSquare(-30, -30, 60);
      const holes: Ring[] = [];

      // Random holes over the whole bounding box: arms, concavities and outside the shell.
      for (let holeIndex = 0; holeIndex < 198; holeIndex++) {
        const originX = -100 + nextRandom() * 195;
        const originY = -100 + nextRandom() * 195;
        holes.push(buildHoleSquare(originX, originY, 0.5 + nextRandom() * 2));
      }
      // Holes inside the centre square, which must prefer the smaller outer ring.
      for (let holeIndex = 0; holeIndex < 30; holeIndex++) {
        holes.push(buildHoleSquare(-25 + nextRandom() * 45, -25 + nextRandom() * 45, 1));
      }
      // Holes whose first vertex is exactly on a star vertex.
      for (let holeIndex = 0; holeIndex < 30; holeIndex++) {
        const [vertexX, vertexY] = starShell[holeIndex * 7];
        holes.push(buildHoleSquare(vertexX, vertexY, 1.5));
      }
      // Holes whose first vertex is on a star edge midpoint.
      for (let holeIndex = 0; holeIndex < 20; holeIndex++) {
        const [startX, startY] = starShell[holeIndex * 11];
        const [endX, endY] = starShell[holeIndex * 11 + 1];
        holes.push(buildHoleSquare((startX + endX) / 2, (startY + endY) / 2, 1.5));
      }
      // Holes whose first vertex is exactly on an edge or corner of the centre square.
      for (let holeIndex = 0; holeIndex < 10; holeIndex++) {
        holes.push(buildHoleSquare(30, -20 + holeIndex * 4, 2));
        holes.push(buildHoleSquare(-30 + holeIndex * 6, -30, 2));
      }
      holes.push(buildHoleSquare(-30, 30, 3), buildHoleSquare(30, 30, 3));
      const outers = [starShell, centreSquare];
      const inputRings = [...outers, ...holes];

      const polygons = assemblePolygons(inputRings);

      expect(holes).toHaveLength(300);
      expectRingConservation(inputRings, polygons);
      const actualOwners = mapHoleOwners(holes, polygons);
      const expectedOwners = holes.map((hole) => referenceFindOwner(hole, outers));
      expect(actualOwners).toEqual(expectedOwners);
      expect(expectedOwners).toContain(starShell);
      expect(expectedOwners).toContain(centreSquare);
      expect(expectedOwners).toContain(null);
    });
  });

  describe("performance", () => {
    it("should assign 1000 holes inside a 200k-vertex shell in reasonable time", () => {
      const vertexCount = 200000;
      const radius = 1000;
      const bigOuter: Ring = [];
      for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
        const angle = -(2 * Math.PI * vertexIndex) / vertexCount;
        bigOuter.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
      }
      bigOuter.push([...bigOuter[0]]);
      const holes: Ring[] = [];
      for (let holeIndex = 0; holeIndex < 1000; holeIndex++) {
        const column = holeIndex % 32;
        const row = Math.floor(holeIndex / 32);
        holes.push(buildHoleSquare(-310 + column * 20, -310 + row * 20, 5));
      }

      const startedAt = performance.now();
      const polygons = assemblePolygons([bigOuter, ...holes]);
      const elapsedMilliseconds = performance.now() - startedAt;

      expect(polygons).toHaveLength(1);
      expect(polygons[0]).toHaveLength(1001);
      expect(polygons[0][0]).toBe(bigOuter);
      expect(elapsedMilliseconds).toBeLessThan(2000);
    });

    it("should assemble a ring of 200k vertices in reasonable time", () => {
      const vertexCount = 200000;
      const radius = 1000;
      const bigOuter: Ring = [];
      // Clockwise circle: decreasing angle.
      for (let vertexIndex = 0; vertexIndex < vertexCount; vertexIndex++) {
        const angle = -(2 * Math.PI * vertexIndex) / vertexCount;
        bigOuter.push([radius * Math.cos(angle), radius * Math.sin(angle)]);
      }
      bigOuter.push([...bigOuter[0]]);
      const hole = buildHoleSquare(-5, -5, 10);

      const startedAt = performance.now();
      const polygons = assemblePolygons([bigOuter, hole]);
      const elapsedMilliseconds = performance.now() - startedAt;

      expect(polygons).toHaveLength(1);
      expect(polygons[0]).toEqual([bigOuter, hole]);
      expect(elapsedMilliseconds).toBeLessThan(2000);
    });
  });
});
