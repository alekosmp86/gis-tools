import type { Feature, Geometry, Position } from "geojson";
import type { BBox } from "@/core/types/map";
import { SPATIAL_INDEX_TARGET_FEATURES_PER_CELL } from "@/core/constants/mapConstants";

const MIN_GRID_DIMENSION = 4;
const MAX_GRID_DIMENSION = 512;

function expandBoundsWithCoordinate(
  currentBounds: [number, number, number, number] | null,
  coordinate: Position
): [number, number, number, number] | null {
  if (!coordinate || coordinate.length < 2) {
    return currentBounds;
  }
  const coordinateX = coordinate[0];
  const coordinateY = coordinate[1];

  if (
    typeof coordinateX !== "number" ||
    typeof coordinateY !== "number" ||
    Number.isNaN(coordinateX) ||
    Number.isNaN(coordinateY)
  ) {
    return currentBounds;
  }

  if (!currentBounds) {
    return [coordinateX, coordinateY, coordinateX, coordinateY];
  }

  return [
    Math.min(currentBounds[0], coordinateX),
    Math.min(currentBounds[1], coordinateY),
    Math.max(currentBounds[2], coordinateX),
    Math.max(currentBounds[3], coordinateY),
  ];
}

function extractCoordinatesBounds(coordinates: unknown): [number, number, number, number] | null {
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    return null;
  }

  if (typeof coordinates[0] === "number") {
    return expandBoundsWithCoordinate(null, coordinates as Position);
  }

  let currentBounds: [number, number, number, number] | null = null;
  for (let index = 0; index < coordinates.length; index++) {
    const subBounds = extractCoordinatesBounds(coordinates[index]);
    if (subBounds) {
      if (!currentBounds) {
        currentBounds = subBounds;
      } else {
        currentBounds = [
          Math.min(currentBounds[0], subBounds[0]),
          Math.min(currentBounds[1], subBounds[1]),
          Math.max(currentBounds[2], subBounds[2]),
          Math.max(currentBounds[3], subBounds[3]),
        ];
      }
    }
  }

  return currentBounds;
}

export function computeGeometryBBox(geometry: Geometry | null | undefined): BBox | null {
  if (!geometry) {
    return null;
  }

  if (geometry.type === "GeometryCollection") {
    let collectionBounds: [number, number, number, number] | null = null;
    const subGeometries = geometry.geometries ?? [];

    for (let index = 0; index < subGeometries.length; index++) {
      const subBBox = computeGeometryBBox(subGeometries[index]);
      if (subBBox) {
        if (!collectionBounds) {
          collectionBounds = [...subBBox];
        } else {
          collectionBounds = [
            Math.min(collectionBounds[0], subBBox[0]),
            Math.min(collectionBounds[1], subBBox[1]),
            Math.max(collectionBounds[2], subBBox[2]),
            Math.max(collectionBounds[3], subBBox[3]),
          ];
        }
      }
    }

    return collectionBounds;
  }

  return extractCoordinatesBounds(geometry.coordinates);
}

/**
 * Computes the 2D bounding box [minX, minY, maxX, maxY] encompassing all vertices of a GeoJSON feature.
 * Returns null if the feature has no geometry or contains no valid numeric coordinates.
 */
export function computeFeatureBBox(feature: Feature | null | undefined): BBox | null {
  if (!feature || !feature.geometry) {
    return null;
  }
  return computeGeometryBBox(feature.geometry);
}

/**
 * Determines whether two 2D bounding boxes overlap, including exact edge contacts.
 */
export function doBBoxesIntersect(firstBBox: BBox, secondBBox: BBox): boolean {
  return (
    firstBBox[0] <= secondBBox[2] &&
    firstBBox[2] >= secondBBox[0] &&
    firstBBox[1] <= secondBBox[3] &&
    firstBBox[3] >= secondBBox[1]
  );
}

/**
 * Calculates uniform spatial grid resolution dimension clamped between 4 and 512.
 */
export function calculateGridDimension(featureCount: number): number {
  if (featureCount <= 0) {
    return MIN_GRID_DIMENSION;
  }
  const rawDimension = Math.ceil(
    Math.sqrt(featureCount / SPATIAL_INDEX_TARGET_FEATURES_PER_CELL)
  );
  return Math.min(Math.max(rawDimension, MIN_GRID_DIMENSION), MAX_GRID_DIMENSION);
}

/**
 * Headless uniform 2D grid spatial index for fast viewport candidate queries over GeoJSON feature collections.
 */
export class ViewportFeatureIndex {
  private readonly featureBBoxes: Array<BBox | null>;
  private readonly collectionBBox: BBox | null;
  private readonly gridDimension: number;
  private readonly cellWidth: number;
  private readonly cellHeight: number;
  private readonly gridCells: number[][];
  private readonly totalFeatures: number;

  constructor(features: readonly Feature[]) {
    this.totalFeatures = features.length;
    this.featureBBoxes = new Array(this.totalFeatures);

    let globalMinX = Infinity;
    let globalMinY = Infinity;
    let globalMaxX = -Infinity;
    let globalMaxY = -Infinity;
    let hasValidBBox = false;

    for (let featureIndex = 0; featureIndex < this.totalFeatures; featureIndex++) {
      const featureBBox = computeFeatureBBox(features[featureIndex]);
      this.featureBBoxes[featureIndex] = featureBBox;

      if (featureBBox) {
        hasValidBBox = true;
        if (featureBBox[0] < globalMinX) globalMinX = featureBBox[0];
        if (featureBBox[1] < globalMinY) globalMinY = featureBBox[1];
        if (featureBBox[2] > globalMaxX) globalMaxX = featureBBox[2];
        if (featureBBox[3] > globalMaxY) globalMaxY = featureBBox[3];
      }
    }

    if (!hasValidBBox) {
      this.collectionBBox = null;
      this.gridDimension = MIN_GRID_DIMENSION;
      this.cellWidth = 1;
      this.cellHeight = 1;
      this.gridCells = [];
      return;
    }

    this.collectionBBox = [globalMinX, globalMinY, globalMaxX, globalMaxY];
    this.gridDimension = calculateGridDimension(this.totalFeatures);

    const spanX = globalMaxX - globalMinX;
    const spanY = globalMaxY - globalMinY;
    this.cellWidth = spanX > 0 ? spanX / this.gridDimension : 1;
    this.cellHeight = spanY > 0 ? spanY / this.gridDimension : 1;

    const totalCells = this.gridDimension * this.gridDimension;
    this.gridCells = new Array(totalCells);
    for (let cellIndex = 0; cellIndex < totalCells; cellIndex++) {
      this.gridCells[cellIndex] = [];
    }

    for (let featureIndex = 0; featureIndex < this.totalFeatures; featureIndex++) {
      const featureBBox = this.featureBBoxes[featureIndex];
      if (!featureBBox) {
        continue;
      }

      const startCol = this.getColIndex(featureBBox[0]);
      const endCol = this.getColIndex(featureBBox[2]);
      const startRow = this.getRowIndex(featureBBox[1]);
      const endRow = this.getRowIndex(featureBBox[3]);

      for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
        const rowOffset = rowIndex * this.gridDimension;
        for (let colIndex = startCol; colIndex <= endCol; colIndex++) {
          this.gridCells[rowOffset + colIndex].push(featureIndex);
        }
      }
    }
  }

  private getColIndex(coordinateX: number): number {
    if (!this.collectionBBox) return 0;
    const offset = coordinateX - this.collectionBBox[0];
    const rawCol = Math.floor(offset / this.cellWidth);
    return Math.min(Math.max(rawCol, 0), this.gridDimension - 1);
  }

  private getRowIndex(coordinateY: number): number {
    if (!this.collectionBBox) return 0;
    const offset = coordinateY - this.collectionBBox[1];
    const rawRow = Math.floor(offset / this.cellHeight);
    return Math.min(Math.max(rawRow, 0), this.gridDimension - 1);
  }

  /**
   * Queries the spatial grid for candidate feature indices whose bounding boxes intersect queryBBox.
   * Returns sorted, deduplicated feature indices in ascending order.
   */
  public queryBBox(queryBBox: BBox): number[] {
    if (!this.collectionBBox || this.totalFeatures === 0) {
      return [];
    }

    const normalizedQuery: BBox = [
      Math.min(queryBBox[0], queryBBox[2]),
      Math.min(queryBBox[1], queryBBox[3]),
      Math.max(queryBBox[0], queryBBox[2]),
      Math.max(queryBBox[1], queryBBox[3]),
    ];

    if (!doBBoxesIntersect(normalizedQuery, this.collectionBBox)) {
      return [];
    }

    const startCol = this.getColIndex(normalizedQuery[0]);
    const endCol = this.getColIndex(normalizedQuery[2]);
    const startRow = this.getRowIndex(normalizedQuery[1]);
    const endRow = this.getRowIndex(normalizedQuery[3]);

    const visited = new Uint8Array(this.totalFeatures);
    const candidateIndices: number[] = [];

    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex++) {
      const rowOffset = rowIndex * this.gridDimension;
      for (let colIndex = startCol; colIndex <= endCol; colIndex++) {
        const cell = this.gridCells[rowOffset + colIndex];
        for (let cellItemIndex = 0; cellItemIndex < cell.length; cellItemIndex++) {
          const featureIndex = cell[cellItemIndex];
          if (visited[featureIndex] === 0) {
            visited[featureIndex] = 1;
            const featureBBox = this.featureBBoxes[featureIndex];
            if (featureBBox && doBBoxesIntersect(featureBBox, normalizedQuery)) {
              candidateIndices.push(featureIndex);
            }
          }
        }
      }
    }

    candidateIndices.sort((firstIndex, secondIndex) => firstIndex - secondIndex);
    return candidateIndices;
  }

  /**
   * Returns the overall 2D bounding box encompassing all valid features in the collection, or null if empty.
   */
  public getCollectionBBox(): BBox | null {
    return this.collectionBBox;
  }
}
