import type { Geometry, Position } from "geojson";
import {
  AMBIGUOUS_POINT_GAP_M,
  REPLACEMENT_MAX_GROWTH_RATIO,
  REPLACEMENT_MIN_OLD_LENGTH_M,
  REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M,
} from "../../../jobs/ejes-calles/constants";
import { geodesicLengthM } from "./geodesicLength";

const EARTH_RADIUS_M = 6371008.8;
const DEGREES_TO_RADIANS = Math.PI / 180;

type Planar = readonly [number, number];

const planarOf = (position: Position, origin: Position): Planar => [
  (position[0] - origin[0]) * DEGREES_TO_RADIANS * Math.cos(origin[1] * DEGREES_TO_RADIANS) * EARTH_RADIUS_M,
  (position[1] - origin[1]) * DEGREES_TO_RADIANS * EARTH_RADIUS_M,
];

const segmentDistanceM = (from: Planar, to: Planar): number => {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const lengthSquared = dx * dx + dy * dy;
  const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, -(from[0] * dx + from[1] * dy) / lengthSquared));
  return Math.hypot(from[0] + along * dx, from[1] + along * dy);
};

const linesOf = (geometry: Geometry): Position[][] => {
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
};

/** The distance in metres from a WGS84 point to a WGS84 line, on a plane centred on the point; null when the geometry is not a line. */
export function distanceToLineM(point: Position, geometry: Geometry): number | null {
  const lines = linesOf(geometry).filter((line) => line.length > 1);
  if (lines.length === 0) return null;
  const distances = lines.flatMap((line) => line.slice(1).map((next, index) => segmentDistanceM(planarOf(line[index], point), planarOf(next, point))));
  return Math.min(...distances);
}

/**
 * The piece (index into `pieces`) each access point of the old section would go to, or null when it would go to review. The same rules as
 * the analysis: the nearest piece; two pieces less than AMBIGUOUS_POINT_GAP_M apart in distance make it ambiguous; a piece more than
 * REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M farther than the old section is too far; a one-piece replacement of a very short old section or of
 * a piece more than REPLACEMENT_MAX_GROWTH_RATIO times longer sends every point to review.
 */
export function pointAssignmentsOf(points: readonly Position[], oldGeometry: Geometry | null, pieces: readonly Geometry[]): Array<number | null> {
  if (pieces.length === 0) return points.map(() => null);
  const oldLength = oldGeometry === null ? 0 : geodesicLengthM(oldGeometry);
  const unusualReplacement =
    pieces.length === 1 && (oldLength < REPLACEMENT_MIN_OLD_LENGTH_M || geodesicLengthM(pieces[0]) > REPLACEMENT_MAX_GROWTH_RATIO * oldLength);
  return points.map((point) => {
    if (unusualReplacement) return null;
    const distances = pieces.map((piece) => distanceToLineM(point, piece));
    const nearest = distances.reduce<number | null>((best, distance, index) => (distance !== null && (best === null || distance < (distances[best] ?? Infinity)) ? index : best), null);
    if (nearest === null) return null;
    const nearestDistance = distances[nearest] ?? 0;
    const others = distances.filter((distance, index): distance is number => index !== nearest && distance !== null);
    if (others.length > 0 && Math.min(...others) - nearestDistance < AMBIGUOUS_POINT_GAP_M) return null;
    const oldDistance = oldGeometry === null ? null : distanceToLineM(point, oldGeometry);
    if (oldDistance !== null && nearestDistance > oldDistance + REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M) return null;
    return nearest;
  });
}
