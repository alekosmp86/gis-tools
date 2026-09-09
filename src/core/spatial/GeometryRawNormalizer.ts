import type { Geometry } from "geojson";
import { EwkbGeometryParser } from "./EwkbGeometryParser";
import { WktGeometryParser } from "./WktGeometryParser";

/**
 * GeometryRawNormalizer.ts
 * Normalizes unknown raw geometry inputs (GeoJSON objects, JSON strings, WKT, EWKB Hex)
 * and rescales coordinates to geographic WGS84 degrees.
 */
export class GeometryRawNormalizer {
  private readonly ewkbParser: EwkbGeometryParser;
  private readonly wktParser: WktGeometryParser;

  constructor(
    ewkbParser = new EwkbGeometryParser(),
    wktParser = new WktGeometryParser()
  ) {
    this.ewkbParser = ewkbParser;
    this.wktParser = wktParser;
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
        const cleanHex = trimmed.replace(/^(\\x|0x)/i, "");
        if (/^[0-9a-fA-F]+$/.test(cleanHex) && cleanHex.length >= 16) {
          baseGeom = this.ewkbParser.parse(trimmed);
        } else {
          baseGeom = this.wktParser.parse(trimmed);
        }
      }
    }

    if (!baseGeom) return null;
    return this.normalizeCoordinatesInGeometry(baseGeom);
  }
}
