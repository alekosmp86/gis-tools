import type { Geometry } from "geojson";
import { GIS_PRECISION } from "@/constants/gisConstants";
import { EwkbGeometryParser } from "./EwkbGeometryParser";
import { WktGeometryParser } from "./WktGeometryParser";

export interface GeometryComparisonResult {
  isMatch: boolean;
  details?: string;
  dbType?: string;
  fileType?: string;
  dbGeomNormalized?: Geometry | null;
  fileGeomNormalized?: Geometry | null;
}

export interface SpatialComparatorOptions {
  /** Decimal places to round coordinates to absorb minor projection noise (default: GIS_PRECISION.COMPARISON_DECIMALS = 4, ~10m) */
  decimalPrecision?: number;
}

/**
 * SpatialGeometryComparator
 * Object-Oriented Domain Service for topological and vertex-level geometry comparison.
 * Normalizes rings, detects centroid alignment, and supports polygon vertex rotation invariance.
 */
export class SpatialGeometryComparator {
  private readonly decimalPrecision: number;
  private readonly roundFactor: number;
  private readonly ewkbParser = new EwkbGeometryParser();
  private readonly wktParser = new WktGeometryParser();

  constructor(options: SpatialComparatorOptions = {}) {
    this.decimalPrecision = options.decimalPrecision ?? GIS_PRECISION.COMPARISON_DECIMALS;
    this.roundFactor = Math.pow(10, this.decimalPrecision);
  }

  private normalizePointCoordinate(coordinate: [number, number]): [number, number] {
    return EwkbGeometryParser.normalizeCoordinate(coordinate[0], coordinate[1]);
  }

  /**
   * Normalizes all coordinates within a Geometry object to geographic WGS84 degrees.
   */
  public normalizeCoordinatesInGeometry(geom: Geometry): Geometry {
    if (!geom || !("coordinates" in geom)) return geom;

    switch (geom.type) {
      case "Point":
        return {
          ...geom,
          coordinates: this.normalizePointCoordinate(geom.coordinates as [number, number]),
        };
      case "MultiPoint":
      case "LineString":
        return {
          ...geom,
          coordinates: (geom.coordinates as Array<[number, number]>).map((coord) =>
            this.normalizePointCoordinate(coord)
          ),
        };
      case "Polygon":
      case "MultiLineString":
        return {
          ...geom,
          coordinates: (geom.coordinates as Array<Array<[number, number]>>).map((ring) =>
            ring.map((coord) => this.normalizePointCoordinate(coord))
          ),
        };
      case "MultiPolygon":
        return {
          ...geom,
          coordinates: (geom.coordinates as Array<Array<Array<[number, number]>>>).map((poly) =>
            poly.map((ring) => ring.map((coord) => this.normalizePointCoordinate(coord)))
          ),
        };
      default:
        return geom;
    }
  }

  /**
   * Normalizes unknown raw geometry inputs (GeoJSON objects, JSON strings, WKT, EWKB Hex).
   */
  public normalizeGeometry(raw: unknown): Geometry | null {
    if (!raw) return null;

    let baseGeom: Geometry | null = null;

    if (typeof raw === "object" && raw !== null && "type" in raw && "coordinates" in raw) {
      baseGeom = raw as Geometry;
    } else if (typeof raw === "string") {
      const trimmed = raw.trim();
      if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
        try {
          const parsed = JSON.parse(trimmed);
          if (parsed && typeof parsed === "object" && "type" in parsed && "coordinates" in parsed) {
            baseGeom = parsed as Geometry;
          }
        } catch {
          // Fall through to WKT / EWKB check
        }
      }
      if (!baseGeom) {
        if (trimmed.startsWith("010") || trimmed.startsWith("000")) {
          baseGeom = this.ewkbParser.parse(trimmed);
        } else {
          baseGeom = this.wktParser.parse(trimmed);
        }
      }
    }

    if (!baseGeom) return null;
    return this.normalizeCoordinatesInGeometry(baseGeom);
  }

  private normalizeRing(ring: Array<[number, number]>): Array<[number, number]> {
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

  private getRingKey(ring: Array<[number, number]>): string {
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

  private extractRings(geom: Geometry): Array<Array<[number, number]>> {
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

  /**
   * Compares two raw geometry representations and evaluates topological match.
   */
  public compare(dbGeomRaw: unknown, fileGeomRaw: unknown): GeometryComparisonResult {
    const dbGeom = this.normalizeGeometry(dbGeomRaw);
    const fileGeom = this.normalizeGeometry(fileGeomRaw);

    if (!dbGeom && !fileGeom) {
      return { isMatch: true, dbGeomNormalized: null, fileGeomNormalized: null };
    }

    if (!dbGeom || !fileGeom) {
      const missingSource = !dbGeom ? "Base de datos" : "Archivo fuente";
      return {
        isMatch: false,
        details: `Geometría ausente en ${missingSource}`,
        dbType: dbGeom?.type,
        fileType: fileGeom?.type,
        dbGeomNormalized: dbGeom,
        fileGeomNormalized: fileGeom,
      };
    }

    // Type comparison
    const normalizeType = (typeName: string) => typeName.replace(/^Multi/, "");
    if (normalizeType(dbGeom.type) !== normalizeType(fileGeom.type)) {
      return {
        isMatch: false,
        details: `Tipo de geometría no coincide: DB (${dbGeom.type}) vs Archivo (${fileGeom.type})`,
        dbType: dbGeom.type,
        fileType: fileGeom.type,
        dbGeomNormalized: dbGeom,
        fileGeomNormalized: fileGeom,
      };
    }

    // Handle Polygons / MultiPolygons
    if (normalizeType(dbGeom.type) === "Polygon") {
      const dbRings = this.extractRings(dbGeom);
      const fileRings = this.extractRings(fileGeom);

      if (dbRings.length !== fileRings.length) {
        return {
          isMatch: false,
          details: `Cantidad de anillos no coincide: DB (${dbRings.length}) vs Archivo (${fileRings.length})`,
          dbType: dbGeom.type,
          fileType: fileGeom.type,
          dbGeomNormalized: dbGeom,
          fileGeomNormalized: fileGeom,
        };
      }

      const isRingsMatch = JSON.stringify(dbRings) === JSON.stringify(fileRings);

      if (!isRingsMatch) {
        return {
          isMatch: false,
          details: `Vértices / topología dispar entre DB y Archivo`,
          dbType: dbGeom.type,
          fileType: fileGeom.type,
          dbGeomNormalized: dbGeom,
          fileGeomNormalized: fileGeom,
        };
      }

      return {
        isMatch: true,
        dbType: dbGeom.type,
        fileType: fileGeom.type,
        dbGeomNormalized: dbGeom,
        fileGeomNormalized: fileGeom,
      };
    }

    // Fallback for Points / LineStrings: compare coordinates with rounded tolerance
    const dbCoords = "coordinates" in dbGeom ? dbGeom.coordinates : null;
    const fileCoords = "coordinates" in fileGeom ? fileGeom.coordinates : null;

    const roundDeep = (obj: unknown): unknown => {
      if (typeof obj === "number") return Math.round(obj * this.roundFactor) / this.roundFactor;
      if (Array.isArray(obj)) return obj.map(roundDeep);
      return obj;
    };

    const isCoordsMatch =
      JSON.stringify(roundDeep(dbCoords)) === JSON.stringify(roundDeep(fileCoords));

    if (!isCoordsMatch) {
      return {
        isMatch: false,
        details: `Coordenadas espaciales no coinciden (Desviación > 10m)`,
        dbType: dbGeom.type,
        fileType: fileGeom.type,
        dbGeomNormalized: dbGeom,
        fileGeomNormalized: fileGeom,
      };
    }

    return {
      isMatch: true,
      dbType: dbGeom.type,
      fileType: fileGeom.type,
      dbGeomNormalized: dbGeom,
      fileGeomNormalized: fileGeom,
    };
  }
}

/** Convenience singleton and functional exports */
export const defaultComparator = new SpatialGeometryComparator();
export const compareGeometries = (dbGeom: unknown, fileGeom: unknown): GeometryComparisonResult =>
  defaultComparator.compare(dbGeom, fileGeom);
export const normalizeGeometry = (raw: unknown): Geometry | null =>
  defaultComparator.normalizeGeometry(raw);
export const normalizeCoordinatesInGeometry = (geom: Geometry): Geometry =>
  defaultComparator.normalizeCoordinatesInGeometry(geom);
