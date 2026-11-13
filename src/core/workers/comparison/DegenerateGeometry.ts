import type { DegenerateFileExample } from "@/core/types/comparison";

export const DEGENERATE_RELATIVE_EXTENT = 1e-12;
export const DEGENERATE_EXAMPLE_LIMIT = 20;

type Position = readonly number[];

interface Extent {
  width: number;
  height: number;
  tolerance: number;
}

function extentOf(positions: readonly Position[]): Extent {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let largest = 0;
  for (const position of positions) {
    const [x, y] = position;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    largest = Math.max(largest, Math.abs(x), Math.abs(y));
  }
  return { width: maxX - minX, height: maxY - minY, tolerance: DEGENERATE_RELATIVE_EXTENT * Math.max(1, largest) };
}

const isPositions = (value: unknown): value is Position[] => Array.isArray(value) && value.length > 0;

/** A line has collapsed to a point when it extends no more than the tolerance in x and in y. */
const isLineCollapsed = (positions: unknown): boolean => {
  if (!isPositions(positions)) return false;
  const { width, height, tolerance } = extentOf(positions);
  return width <= tolerance && height <= tolerance;
};

/** A polygon has no area when its outer ring extends no more than the tolerance in x or in y. */
const isPolygonCollapsed = (rings: unknown): boolean => {
  if (!Array.isArray(rings) || rings.length === 0 || !isPositions(rings[0])) return false;
  const { width, height, tolerance } = extentOf(rings[0]);
  return width <= tolerance || height <= tolerance;
};

const everyPart = (parts: unknown, isCollapsed: (part: unknown) => boolean): boolean =>
  Array.isArray(parts) && parts.length > 0 && parts.every(isCollapsed);

/** Whether a GeoJSON geometry of a file feature has collapsed to a point. Points, collections, null and empty geometries never are. */
export function isDegenerateGeometry(geometry: unknown): boolean {
  if (typeof geometry !== "object" || geometry === null) return false;
  const { type, coordinates } = geometry as { type?: string; coordinates?: unknown };
  switch (type) {
    case "LineString":
      return isLineCollapsed(coordinates);
    case "MultiLineString":
      return everyPart(coordinates, isLineCollapsed);
    case "Polygon":
      return isPolygonCollapsed(coordinates);
    case "MultiPolygon":
      return everyPart(coordinates, isPolygonCollapsed);
    default:
      return false;
  }
}

/** Counts the file rows left out of the comparison and keeps the first few as examples. */
export class DegenerateRowCollector {
  private skipped = 0;
  private readonly examples: DegenerateFileExample[] = [];

  public add(rowNumber: number, suid: () => string): void {
    this.skipped++;
    if (this.examples.length < DEGENERATE_EXAMPLE_LIMIT) this.examples.push({ rowNumber, suid: suid() });
  }

  public get count(): number {
    return this.skipped;
  }

  public get sample(): DegenerateFileExample[] {
    return this.examples;
  }
}
