import type { Geometry } from "geojson";
import { GIS_PRECISION } from "@/constants/gisConstants";
import { GeometryRawNormalizer } from "./GeometryRawNormalizer";
import { PolygonRingNormalizer } from "./PolygonRingNormalizer";

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
 * Domain Service coordinating topological and vertex-level geometry comparison.
 * Delegates multi-format parsing to GeometryRawNormalizer and polygon ring topology
 * to PolygonRingNormalizer.
 */
export class SpatialGeometryComparator {
  private readonly decimalPrecision: number;
  private readonly roundFactor: number;
  private readonly rawNormalizer: GeometryRawNormalizer;
  private readonly ringNormalizer: PolygonRingNormalizer;

  constructor(
    options: SpatialComparatorOptions = {},
    rawNormalizer = new GeometryRawNormalizer(),
    ringNormalizer?: PolygonRingNormalizer
  ) {
    this.decimalPrecision = options.decimalPrecision ?? GIS_PRECISION.COMPARISON_DECIMALS;
    this.roundFactor = Math.pow(10, this.decimalPrecision);
    this.rawNormalizer = rawNormalizer;
    this.ringNormalizer = ringNormalizer ?? new PolygonRingNormalizer(this.roundFactor);
  }

  /**
   * Normalizes all coordinates within a Geometry object to geographic WGS84 degrees.
   */
  public normalizeCoordinatesInGeometry(geom: Geometry): Geometry {
    return this.rawNormalizer.normalizeCoordinatesInGeometry(geom);
  }

  /**
   * Normalizes unknown raw geometry inputs (GeoJSON objects, JSON strings, WKT, EWKB Hex).
   */
  public normalizeGeometry(raw: unknown): Geometry | null {
    return this.rawNormalizer.normalizeGeometry(raw);
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
      const dbRings = this.ringNormalizer.extractRings(dbGeom);
      const fileRings = this.ringNormalizer.extractRings(fileGeom);

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

      let isRingsMatch = JSON.stringify(dbRings) === JSON.stringify(fileRings);
      let mismatchDetail = "Vértices / topología dispar entre DB y Archivo";

      // If exact string match failed, test cyclic alignment with numerical epsilon tolerance
      if (!isRingsMatch && dbRings.length === fileRings.length) {
        let allRingsMatch = true;

        for (let ringIndex = 0; ringIndex < dbRings.length; ringIndex++) {
          const matchResult = this.ringNormalizer.areRingsCyclicallyMatching(
            dbRings[ringIndex],
            fileRings[ringIndex]
          );
          if (!matchResult.isMatch) {
            allRingsMatch = false;
            mismatchDetail = matchResult.mismatchDetail || mismatchDetail;
            break;
          }
        }

        if (allRingsMatch) {
          isRingsMatch = true;
        }
      }

      if (!isRingsMatch) {
        return {
          isMatch: false,
          details: mismatchDetail,
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

    const isCoordsMatch =
      JSON.stringify(this.roundDeep(dbCoords)) === JSON.stringify(this.roundDeep(fileCoords));

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

  private roundDeep(obj: unknown): unknown {
    if (typeof obj === "number") return Math.round(obj * this.roundFactor) / this.roundFactor;
    if (Array.isArray(obj)) return obj.map((item) => this.roundDeep(item));
    return obj;
  }
}

/** Convenience singleton and functional exports */
export const defaultComparator = new SpatialGeometryComparator();
export const compareGeometries = (dbGeom: unknown, fileGeom: unknown): GeometryComparisonResult =>
  defaultComparator.compare(dbGeom, fileGeom);
export const normalizeGeometry = (raw: unknown): Geometry | null =>
  defaultComparator.normalizeGeometry(raw);
