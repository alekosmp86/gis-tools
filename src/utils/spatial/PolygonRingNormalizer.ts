import type { Geometry } from "geojson";

export interface RingMatchResult {
  isMatch: boolean;
  mismatchDetail?: string;
}

/**
 * PolygonRingNormalizer.ts
 * Normalizes polygon rings: collapses consecutive duplicate vertices, eliminates duplicate closing
 * endpoints, establishes canonical starting vertex rotation and direction, and evaluates cyclic shift
 * topological matching with numerical epsilon tolerance.
 */
export class PolygonRingNormalizer {
  private readonly roundFactor: number;

  constructor(roundFactor: number) {
    this.roundFactor = roundFactor;
  }

  public normalizeRing(ring: Array<[number, number]>): Array<[number, number]> {
    if (!ring || ring.length === 0) return [];

    // 1. Round coordinates to specified decimal places
    let pts: Array<[number, number]> = ring.map(([xCoordinate, yCoordinate]) => [
      Math.round(xCoordinate * this.roundFactor) / this.roundFactor,
      Math.round(yCoordinate * this.roundFactor) / this.roundFactor,
    ]);

    // 2. Trim duplicate closing endpoint
    if (
      pts.length > 1 &&
      pts[0][0] === pts[pts.length - 1][0] &&
      pts[0][1] === pts[pts.length - 1][1]
    ) {
      pts = pts.slice(0, pts.length - 1);
    }

    // Collapse consecutive duplicate points caused by rounding
    const collapsed: Array<[number, number]> = [];
    for (let index = 0; index < pts.length; index++) {
      if (
        index === 0 ||
        pts[index][0] !== pts[index - 1][0] ||
        pts[index][1] !== pts[index - 1][1]
      ) {
        collapsed.push(pts[index]);
      }
    }
    pts = collapsed;

    if (pts.length === 0) return [];

    // 3. Find lexicographically smallest point index to start ring deterministically
    let minIdx = 0;
    for (let index = 1; index < pts.length; index++) {
      if (
        pts[index][0] < pts[minIdx][0] ||
        (pts[index][0] === pts[minIdx][0] && pts[index][1] < pts[minIdx][1])
      ) {
        minIdx = index;
      }
    }

    const rotated = [...pts.slice(minIdx), ...pts.slice(0, minIdx)];

    // 4. Canonicalize direction (clockwise vs counter-clockwise)
    if (rotated.length >= 3) {
      const point1 = rotated[1];
      const pointLast = rotated[rotated.length - 1];
      if (pointLast[0] < point1[0] || (pointLast[0] === point1[0] && pointLast[1] < point1[1])) {
        const restReversed = rotated.slice(1).reverse();
        return [rotated[0], ...restReversed];
      }
    }

    return rotated;
  }

  public getRingKey(ring: Array<[number, number]>): string {
    if (ring.length === 0) return "";
    let sumX = 0;
    let sumY = 0;
    ring.forEach(([xCoordinate, yCoordinate]) => {
      sumX += xCoordinate;
      sumY += yCoordinate;
    });
    const count = ring.length;
    const avgX = Math.round((sumX / count) * this.roundFactor) / this.roundFactor;
    const avgY = Math.round((sumY / count) * this.roundFactor) / this.roundFactor;
    return `${avgX}_${avgY}_${ring.length}`;
  }

  public extractRings(geom: Geometry): Array<Array<[number, number]>> {
    const allRings: Array<Array<[number, number]>> = [];

    if (geom.type === "Polygon") {
      (geom.coordinates as Array<Array<[number, number]>>).forEach((ring) => {
        const norm = this.normalizeRing(ring);
        if (norm.length > 0) allRings.push(norm);
      });
    } else if (geom.type === "MultiPolygon") {
      const multiCoords = geom.coordinates as Array<Array<Array<[number, number]>>>;
      multiCoords.forEach((poly) => {
        poly.forEach((ring) => {
          const norm = this.normalizeRing(ring);
          if (norm.length > 0) allRings.push(norm);
        });
      });
    }

    allRings.sort((ringA, ringB) => this.getRingKey(ringA).localeCompare(this.getRingKey(ringB)));
    return allRings;
  }

  public areRingsCyclicallyMatching(
    ringA: Array<[number, number]>,
    ringB: Array<[number, number]>,
    epsilonDegrees: number = 0.0003
  ): RingMatchResult {
    if (ringA.length === 0 && ringB.length === 0) return { isMatch: true };
    if (ringA.length !== ringB.length) {
      return {
        isMatch: false,
        mismatchDetail: `Vértices no coinciden: DB (${ringA.length}) vs Archivo (${ringB.length})`,
      };
    }

    const ringLength = ringA.length;

    // Search for any cyclic alignment (and direction reversal) that satisfies epsilon tolerance
    for (let shift = 0; shift < ringLength; shift++) {
      const diffX = Math.abs(ringA[0][0] - ringB[shift][0]);
      const diffY = Math.abs(ringA[0][1] - ringB[shift][1]);

      if (diffX <= epsilonDegrees && diffY <= epsilonDegrees) {
        // 1. Check forward alignment
        let forwardMatch = true;
        for (let index = 1; index < ringLength; index++) {
          const bIndex = (index + shift) % ringLength;
          if (
            Math.abs(ringA[index][0] - ringB[bIndex][0]) > epsilonDegrees ||
            Math.abs(ringA[index][1] - ringB[bIndex][1]) > epsilonDegrees
          ) {
            forwardMatch = false;
            break;
          }
        }
        if (forwardMatch) return { isMatch: true };

        // 2. Check reverse alignment (opposite winding direction)
        let reverseMatch = true;
        for (let index = 1; index < ringLength; index++) {
          const bIndex = (ringLength + shift - index) % ringLength;
          if (
            Math.abs(ringA[index][0] - ringB[bIndex][0]) > epsilonDegrees ||
            Math.abs(ringA[index][1] - ringB[bIndex][1]) > epsilonDegrees
          ) {
            reverseMatch = false;
            break;
          }
        }
        if (reverseMatch) return { isMatch: true };
      }
    }

    return {
      isMatch: false,
      mismatchDetail: "Vértices / topología dispar entre DB y Archivo",
    };
  }
}
