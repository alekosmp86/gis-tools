import type { Geometry, Position } from "geojson";

const EARTH_RADIUS_M = 6371008.8;
const DEGREES_TO_RADIANS = Math.PI / 180;

const segmentLengthM = (from: Position, to: Position): number => {
  const [fromLongitude, fromLatitude] = from;
  const [toLongitude, toLatitude] = to;
  const latitudeDelta = (toLatitude - fromLatitude) * DEGREES_TO_RADIANS;
  const longitudeDelta = (toLongitude - fromLongitude) * DEGREES_TO_RADIANS;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude * DEGREES_TO_RADIANS) * Math.cos(toLatitude * DEGREES_TO_RADIANS) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(haversine));
};

const lineLengthM = (line: Position[]): number =>
  line.slice(1).reduce((sum, point, index) => sum + segmentLengthM(line[index], point), 0);

/** The geodesic length in metres of a WGS84 line; a geometry that is not a line has none. */
export function geodesicLengthM(geometry: Geometry): number {
  if (geometry.type === "LineString") return lineLengthM(geometry.coordinates);
  if (geometry.type === "MultiLineString") return geometry.coordinates.reduce((sum, line) => sum + lineLengthM(line), 0);
  return 0;
}
