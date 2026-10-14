const MAX_SAMPLED_VERTICES = 16;

type Position = [number, number];

export interface PreparedGeometry {
  isLine: boolean;
  centroid: Position;
  samples: Position[];
}

interface GeometryParts {
  parts: Position[][];
  isLine: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toPosition(raw: unknown): Position | null {
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const [x, y] = raw;
  return Number.isFinite(x) && Number.isFinite(y) ? [x as number, y as number] : null;
}

function toVertices(raw: unknown): Position[] {
  if (!Array.isArray(raw)) return [];
  const vertices: Position[] = [];
  for (const rawPosition of raw) {
    const position = toPosition(rawPosition);
    if (position) vertices.push(position);
  }
  return vertices;
}

function toExteriorRing(rawPolygon: unknown): Position[] {
  const ring = toVertices(Array.isArray(rawPolygon) ? rawPolygon[0] : undefined);
  if (ring.length > 1) {
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  }
  return ring;
}

function toList(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

function extractRawParts(type: string, coordinates: unknown): Position[][] | null {
  switch (type) {
    case "Point": {
      const point = toPosition(coordinates);
      return point ? [[point]] : [];
    }
    case "MultiPoint":
      return toList(coordinates).map((raw) => toVertices([raw]));
    case "LineString":
      return [toVertices(coordinates)];
    case "MultiLineString":
      return toList(coordinates).map(toVertices);
    case "Polygon":
      return [toExteriorRing(coordinates)];
    case "MultiPolygon":
      return toList(coordinates).map(toExteriorRing);
    default:
      return null;
  }
}

function extractParts(geometry: unknown): GeometryParts | null {
  if (!isRecord(geometry) || typeof geometry.type !== "string") return null;
  const rawParts = extractRawParts(geometry.type, geometry.coordinates);
  if (!rawParts) return null;
  const parts = rawParts.filter((part) => part.length > 0);
  if (parts.length === 0) return null;
  return { parts, isLine: geometry.type.endsWith("LineString") };
}

function meanOf(vertices: Position[]): Position {
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of vertices) {
    sumX += x;
    sumY += y;
  }
  return [sumX / vertices.length, sumY / vertices.length];
}

function centroidOf(parts: Position[][]): Position {
  return meanOf(parts.map((part) => meanOf(part)));
}

function sampleVertices(vertices: Position[]): Position[] {
  if (vertices.length <= MAX_SAMPLED_VERTICES) return vertices;
  const step = (vertices.length - 1) / (MAX_SAMPLED_VERTICES - 1);
  const sampled: Position[] = [];
  for (let sampleIndex = 0; sampleIndex < MAX_SAMPLED_VERTICES; sampleIndex++) {
    sampled.push(vertices[Math.round(sampleIndex * step)]);
  }
  return sampled;
}

function pointDistance(first: Position, second: Position): number {
  return Math.hypot(first[0] - second[0], first[1] - second[1]);
}

function directedHausdorff(from: Position[], to: Position[]): number {
  let worst = 0;
  for (const origin of from) {
    let nearest = Infinity;
    for (const target of to) {
      nearest = Math.min(nearest, pointDistance(origin, target));
    }
    worst = Math.max(worst, nearest);
  }
  return worst;
}

function sampledHausdorff(first: Position[], second: Position[]): number {
  return Math.max(directedHausdorff(first, second), directedHausdorff(second, first));
}

export function prepareGeometry(geometry: unknown): PreparedGeometry | null {
  const extracted = extractParts(geometry);
  if (!extracted) return null;
  return {
    isLine: extracted.isLine,
    centroid: centroidOf(extracted.parts),
    samples: extracted.isLine ? sampleVertices(extracted.parts.flat()) : [],
  };
}

/**
 * Distance between two prepared geometries in coordinate units. Points and polygons use the
 * centroid distance; lines use max(centroid distance, sampled Hausdorff). Missing geometry is
 * Infinity (not geometrically pairable).
 */
export function geometryDistance(
  first: PreparedGeometry | null,
  second: PreparedGeometry | null
): number {
  if (!first || !second) return Infinity;
  const centroidDistance = pointDistance(first.centroid, second.centroid);
  if (!first.isLine || !second.isLine) return centroidDistance;
  return Math.max(centroidDistance, sampledHausdorff(first.samples, second.samples));
}
