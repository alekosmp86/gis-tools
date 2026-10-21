type Ring = number[][];
type Polygon = Ring[];

interface BoundingBox {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface RingEdgeIndex {
  readonly minY: number;
  readonly maxY: number;
  readonly bucketScale: number;
  readonly buckets: number[][];
}

interface OuterRingEntry {
  readonly ring: Ring;
  readonly absoluteArea: number;
  readonly boundingBox: BoundingBox;
  readonly holes: Ring[];
  /** `undefined` = not built yet; `null` = ring cannot be indexed (non-finite coordinates). */
  edgeIndex: RingEdgeIndex | null | undefined;
}

type PointPosition = "INSIDE" | "OUTSIDE" | "BOUNDARY";

const POINT_POSITION = {
  INSIDE: "INSIDE",
  OUTSIDE: "OUTSIDE",
  BOUNDARY: "BOUNDARY",
} as const satisfies Record<PointPosition, PointPosition>;

const MIN_EDGE_BUCKET_COUNT = 8;
const MAX_EDGE_BUCKET_COUNT = 4096;

/** Shoelace signed area: negative = clockwise (y-up). */
function computeSignedArea(ring: Ring): number {
  let doubledArea = 0;
  for (let vertexIndex = 0; vertexIndex < ring.length - 1; vertexIndex++) {
    const [currentX, currentY] = ring[vertexIndex];
    const [nextX, nextY] = ring[vertexIndex + 1];
    doubledArea += currentX * nextY - nextX * currentY;
  }
  return doubledArea / 2;
}

function computeBoundingBox(ring: Ring): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [vertexX, vertexY] of ring) {
    if (vertexX < minX) minX = vertexX;
    if (vertexX > maxX) maxX = vertexX;
    if (vertexY < minY) minY = vertexY;
    if (vertexY > maxY) maxY = vertexY;
  }
  return { minX, minY, maxX, maxY };
}

function isBoxInsideBox(inner: BoundingBox, outer: BoundingBox): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.maxX <= outer.maxX &&
    inner.minY >= outer.minY &&
    inner.maxY <= outer.maxY
  );
}

function isPointOnSegment(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): boolean {
  const cross = (endX - startX) * (pointY - startY) - (endY - startY) * (pointX - startX);
  if (cross !== 0) return false;
  return (
    pointX >= Math.min(startX, endX) &&
    pointX <= Math.max(startX, endX) &&
    pointY >= Math.min(startY, endY) &&
    pointY <= Math.max(startY, endY)
  );
}

function doesEdgeCrossRay(
  pointX: number,
  pointY: number,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): boolean {
  const crossesRay = startY > pointY !== endY > pointY;
  return crossesRay && pointX < ((endX - startX) * (pointY - startY)) / (endY - startY) + startX;
}

function locatePointInEdges(
  pointX: number,
  pointY: number,
  ring: Ring,
  edgeStartIndices: ArrayLike<number>
): PointPosition {
  let isInside = false;
  for (let listIndex = 0; listIndex < edgeStartIndices.length; listIndex++) {
    const [startX, startY] = ring[edgeStartIndices[listIndex]];
    const [endX, endY] = ring[edgeStartIndices[listIndex] + 1];
    if (isPointOnSegment(pointX, pointY, startX, startY, endX, endY)) {
      return POINT_POSITION.BOUNDARY;
    }
    if (doesEdgeCrossRay(pointX, pointY, startX, startY, endX, endY)) {
      isInside = !isInside;
    }
  }
  return isInside ? POINT_POSITION.INSIDE : POINT_POSITION.OUTSIDE;
}

function locatePointInRingLinear(pointX: number, pointY: number, ring: Ring): PointPosition {
  const allEdgeStartIndices = Array.from(Array(Math.max(0, ring.length - 1)).keys());
  return locatePointInEdges(pointX, pointY, ring, allEdgeStartIndices);
}

function hasOnlyFiniteCoordinates(ring: Ring): boolean {
  for (const [vertexX, vertexY] of ring) {
    if (!Number.isFinite(vertexX) || !Number.isFinite(vertexY)) return false;
  }
  return true;
}

function computeBucketCount(vertexCount: number): number {
  const targetCount = Math.round(Math.sqrt(vertexCount));
  return Math.min(MAX_EDGE_BUCKET_COUNT, Math.max(MIN_EDGE_BUCKET_COUNT, targetCount));
}

function findBucketIndex(pointY: number, edgeIndex: RingEdgeIndex): number {
  const bucketIndex = Math.floor((pointY - edgeIndex.minY) * edgeIndex.bucketScale);
  return Math.min(edgeIndex.buckets.length - 1, Math.max(0, bucketIndex));
}

/**
 * Every edge is registered in every bucket its Y-range spans (bounds inclusive), so the
 * bucket holding a point's Y is a superset of the edges that touch or straddle that Y.
 */
function buildRingEdgeIndex(ring: Ring, boundingBox: BoundingBox): RingEdgeIndex | null {
  if (!hasOnlyFiniteCoordinates(ring)) return null;
  const { minY, maxY } = boundingBox;
  const height = maxY - minY;
  const bucketCount = height > 0 ? computeBucketCount(ring.length) : 1;
  const bucketScale = bucketCount / height;
  const isDegenerateHeight = !(height > 0) || !Number.isFinite(bucketScale);
  const edgeIndex: RingEdgeIndex = {
    minY,
    maxY,
    bucketScale: isDegenerateHeight ? 0 : bucketScale,
    buckets: Array.from({ length: isDegenerateHeight ? 1 : bucketCount }, (): number[] => []),
  };
  for (let vertexIndex = 0; vertexIndex < ring.length - 1; vertexIndex++) {
    const startY = ring[vertexIndex][1];
    const endY = ring[vertexIndex + 1][1];
    const firstBucket = findBucketIndex(Math.min(startY, endY), edgeIndex);
    const lastBucket = findBucketIndex(Math.max(startY, endY), edgeIndex);
    for (let bucketIndex = firstBucket; bucketIndex <= lastBucket; bucketIndex++) {
      edgeIndex.buckets[bucketIndex].push(vertexIndex);
    }
  }
  return edgeIndex;
}

function getEdgeIndex(outerEntry: OuterRingEntry): RingEdgeIndex | null {
  if (outerEntry.edgeIndex === undefined) {
    outerEntry.edgeIndex = buildRingEdgeIndex(outerEntry.ring, outerEntry.boundingBox);
  }
  return outerEntry.edgeIndex;
}

function locatePointInOuterRing(
  pointX: number,
  pointY: number,
  outerEntry: OuterRingEntry
): PointPosition {
  const edgeIndex = getEdgeIndex(outerEntry);
  if (edgeIndex === null) return locatePointInRingLinear(pointX, pointY, outerEntry.ring);
  if (!(pointY >= edgeIndex.minY && pointY <= edgeIndex.maxY)) return POINT_POSITION.OUTSIDE;
  const bucket = edgeIndex.buckets[findBucketIndex(pointY, edgeIndex)];
  return locatePointInEdges(pointX, pointY, outerEntry.ring, bucket);
}

/** A hole may touch its shell: the first vertex strictly inside or outside decides. */
function isRingContainedInRing(innerRing: Ring, outerEntry: OuterRingEntry): boolean {
  for (const [vertexX, vertexY] of innerRing) {
    const position = locatePointInOuterRing(vertexX, vertexY, outerEntry);
    if (position === POINT_POSITION.INSIDE) return true;
    if (position === POINT_POSITION.OUTSIDE) return false;
  }
  return false;
}

function findSmallestContainingOuter(
  holeRing: Ring,
  outerEntriesByAscendingArea: OuterRingEntry[]
): OuterRingEntry | null {
  const holeBoundingBox = computeBoundingBox(holeRing);
  for (const outerEntry of outerEntriesByAscendingArea) {
    if (!isBoxInsideBox(holeBoundingBox, outerEntry.boundingBox)) continue;
    if (isRingContainedInRing(holeRing, outerEntry)) return outerEntry;
  }
  return null;
}

/**
 * Groups the raw rings of an ESRI polygon record into polygons (`[outer, ...holes]`).
 * Rings must be in raw file coordinates: ESRI orientation (outer = clockwise, hole =
 * counter-clockwise) is lost if a projection swaps or flips axes before this runs.
 * Zero-area rings are kept as outer rings; holes contained by no outer ring become polygons.
 */
export function assemblePolygons(rings: Ring[]): Polygon[] {
  const outerEntries: OuterRingEntry[] = [];
  const holeRings: Ring[] = [];

  for (const ring of rings) {
    const signedArea = computeSignedArea(ring);
    if (signedArea > 0) {
      holeRings.push(ring);
    } else {
      outerEntries.push({
        ring,
        absoluteArea: Math.abs(signedArea),
        boundingBox: computeBoundingBox(ring),
        holes: [],
        edgeIndex: undefined,
      });
    }
  }

  const outerEntriesByAscendingArea = [...outerEntries].sort(
    (first, second) => first.absoluteArea - second.absoluteArea
  );
  const orphanHoleSet = new Set<Ring>();
  for (const holeRing of holeRings) {
    const container = findSmallestContainingOuter(holeRing, outerEntriesByAscendingArea);
    if (container) {
      container.holes.push(holeRing);
    } else {
      orphanHoleSet.add(holeRing);
    }
  }

  const polygons: Polygon[] = outerEntries.map((entry) => [entry.ring, ...entry.holes]);
  for (const orphanHole of orphanHoleSet) {
    polygons.push([orphanHole]);
  }
  return polygons;
}
