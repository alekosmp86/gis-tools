import type { Geometry } from "geojson";

export interface IGeometryParser {
  parse(rawInput: unknown): Geometry | null;
}

/**
 * EwkbGeometryParser
 * Object-Oriented parser for PostGIS Extended Well-Known Binary (EWKB) Hex strings.
 * Includes UTM Zone 19S (EPSG:32719) reprojection and coordinate normalization algorithms.
 */
export class EwkbGeometryParser implements IGeometryParser {
  /**
   * Converts UTM Zone 19S (EPSG:32719) coordinates in meters to WGS84 (longitude, latitude) degrees.
   */
  public static utm19sToWgs84(easting: number, northing: number): [number, number] {
    const k0 = 0.9996;
    const semiMajorAxis = 6378137.0; // WGS84 semi-major axis (a)
    const flattening = 1 / 298.257223563; // WGS84 flattening (f)
    const semiMinorAxis = semiMajorAxis * (1 - flattening);
    const eccentricitySquared =
      (semiMajorAxis * semiMajorAxis - semiMinorAxis * semiMinorAxis) /
      (semiMajorAxis * semiMajorAxis);
    const secondEccentricitySquared =
      (semiMajorAxis * semiMajorAxis - semiMinorAxis * semiMinorAxis) /
      (semiMinorAxis * semiMinorAxis);

    const xCoordinate = easting - 500000.0;
    const yCoordinate = northing - 10000000.0; // Southern Hemisphere

    const meridianDistance = yCoordinate / k0;
    const rectifyingLatitude =
      meridianDistance /
      (semiMajorAxis *
        (1 -
          eccentricitySquared / 4 -
          (3 * eccentricitySquared * eccentricitySquared) / 64 -
          (5 * Math.pow(eccentricitySquared, 3)) / 256));

    const footprintLatitude =
      (1 - Math.sqrt(1 - eccentricitySquared)) / (1 + Math.sqrt(1 - eccentricitySquared));

    const phi1Rad =
      rectifyingLatitude +
      ((3 * footprintLatitude) / 2 - (27 * Math.pow(footprintLatitude, 3)) / 32) *
        Math.sin(2 * rectifyingLatitude) +
      ((21 * footprintLatitude * footprintLatitude) / 16 -
        (55 * Math.pow(footprintLatitude, 4)) / 32) *
        Math.sin(4 * rectifyingLatitude) +
      ((151 * Math.pow(footprintLatitude, 3)) / 96) * Math.sin(6 * rectifyingLatitude) +
      ((1097 * Math.pow(footprintLatitude, 4)) / 512) * Math.sin(8 * rectifyingLatitude);

    const sinPhi1 = Math.sin(phi1Rad);
    const cosPhi1 = Math.cos(phi1Rad);
    const tanPhi1 = Math.tan(phi1Rad);

    const radiusCurvaturePrime =
      semiMajorAxis / Math.sqrt(1 - eccentricitySquared * sinPhi1 * sinPhi1);
    const tangentSquared = tanPhi1 * tanPhi1;
    const etaSquared = secondEccentricitySquared * cosPhi1 * cosPhi1;
    const radiusCurvatureMeridian =
      (semiMajorAxis * (1 - eccentricitySquared)) /
      Math.pow(1 - eccentricitySquared * sinPhi1 * sinPhi1, 1.5);
    const normalizedDistance = xCoordinate / (radiusCurvaturePrime * k0);

    const latitudeRadians =
      phi1Rad -
      ((radiusCurvaturePrime * tanPhi1) / radiusCurvatureMeridian) *
        ((normalizedDistance * normalizedDistance) / 2 -
          ((5 +
            3 * tangentSquared +
            10 * etaSquared -
            4 * etaSquared * etaSquared -
            9 * secondEccentricitySquared) *
            Math.pow(normalizedDistance, 4)) /
            24 +
          ((61 +
            90 * tangentSquared +
            298 * etaSquared +
            45 * tangentSquared * tangentSquared -
            252 * secondEccentricitySquared -
            3 * etaSquared * etaSquared) *
            Math.pow(normalizedDistance, 6)) /
            720);

    const longitudeRadians =
      (-57.0 * Math.PI) / 180.0 +
      (normalizedDistance -
        ((1 + 2 * tangentSquared + etaSquared) * Math.pow(normalizedDistance, 3)) / 6 +
        ((5 -
          2 * etaSquared +
          28 * tangentSquared -
          3 * etaSquared * etaSquared +
          8 * secondEccentricitySquared +
          24 * tangentSquared * tangentSquared) *
          Math.pow(normalizedDistance, 5)) /
          120) /
        cosPhi1;

    const latitudeDegrees = (latitudeRadians * 180.0) / Math.PI;
    const longitudeDegrees = (longitudeRadians * 180.0) / Math.PI;

    return [longitudeDegrees, latitudeDegrees];
  }

  /**
   * Checks whether coordinates are outside standard WGS84 degree bounds (indicating metric/UTM coordinates).
   */
  public static isUtmCoordinates(xCoordinate: number, yCoordinate: number): boolean {
    return Math.abs(xCoordinate) > 180 || Math.abs(yCoordinate) > 90;
  }

  /**
   * Normalizes a coordinate pair [xCoordinate, yCoordinate] to [lon, lat] degrees.
   */
  public static normalizeCoordinate(xCoordinate: number, yCoordinate: number): [number, number] {
    if (EwkbGeometryParser.isUtmCoordinates(xCoordinate, yCoordinate)) {
      return EwkbGeometryParser.utm19sToWgs84(xCoordinate, yCoordinate);
    }
    return [xCoordinate, yCoordinate];
  }

  /**
   * Parses PostGIS EWKB Hex geometry strings into standard GeoJSON Geometry objects.
   */
  public parse(rawInput: unknown): Geometry | null {
    if (!rawInput || typeof rawInput !== "string") {
      return null;
    }

    const cleanHex = rawInput.trim();
    if (cleanHex.length < 18) {
      return null;
    }

    try {
      const bytes = new Uint8Array(cleanHex.length / 2);
      for (let charIndex = 0; charIndex < cleanHex.length; charIndex += 2) {
        bytes[charIndex / 2] = parseInt(cleanHex.substring(charIndex, charIndex + 2), 16);
      }

      const view = new DataView(bytes.buffer);
      let offset = 0;

      const byteOrder = view.getUint8(offset);
      offset += 1;
      const littleEndian = byteOrder === 1;

      const rawType = view.getUint32(offset, littleEndian);
      offset += 4;

      const hasSrid = (rawType & 0x20000000) !== 0;
      const baseType = rawType & 0xff;

      if (hasSrid) {
        offset += 4; // Skip SRID uint32
      }

      const parsePoint = (): [number, number] => {
        const xCoordinate = view.getFloat64(offset, littleEndian);
        offset += 8;
        const yCoordinate = view.getFloat64(offset, littleEndian);
        offset += 8;
        return EwkbGeometryParser.normalizeCoordinate(xCoordinate, yCoordinate);
      };

      const parseLineStringCoords = (): Array<[number, number]> => {
        const numPoints = view.getUint32(offset, littleEndian);
        offset += 4;
        const pts: Array<[number, number]> = [];
        for (let pointIndex = 0; pointIndex < numPoints; pointIndex++) {
          pts.push(parsePoint());
        }
        return pts;
      };

      // Point
      if (baseType === 1) {
        return {
          type: "Point",
          coordinates: parsePoint(),
        };
      }

      // LineString
      if (baseType === 2) {
        return {
          type: "LineString",
          coordinates: parseLineStringCoords(),
        };
      }

      // Polygon
      if (baseType === 3) {
        const numRings = view.getUint32(offset, littleEndian);
        offset += 4;
        const rings: Array<Array<[number, number]>> = [];
        for (let ringIndex = 0; ringIndex < numRings; ringIndex++) {
          rings.push(parseLineStringCoords());
        }
        return {
          type: "Polygon",
          coordinates: rings,
        };
      }

      // MultiPoint
      if (baseType === 4) {
        const numGeoms = view.getUint32(offset, littleEndian);
        offset += 4;
        const pts: Array<[number, number]> = [];
        for (let geomIndex = 0; geomIndex < numGeoms; geomIndex++) {
          offset += 5;
          pts.push(parsePoint());
        }
        return {
          type: "MultiPoint",
          coordinates: pts,
        };
      }

      // MultiLineString
      if (baseType === 5) {
        const numGeoms = view.getUint32(offset, littleEndian);
        offset += 4;
        const lines: Array<Array<[number, number]>> = [];
        for (let geomIndex = 0; geomIndex < numGeoms; geomIndex++) {
          offset += 5;
          lines.push(parseLineStringCoords());
        }
        return {
          type: "MultiLineString",
          coordinates: lines,
        };
      }

      // MultiPolygon
      if (baseType === 6) {
        const numGeoms = view.getUint32(offset, littleEndian);
        offset += 4;
        const polys: Array<Array<Array<[number, number]>>> = [];
        for (let geomIndex = 0; geomIndex < numGeoms; geomIndex++) {
          offset += 5;
          const numRings = view.getUint32(offset, littleEndian);
          offset += 4;
          const rings: Array<Array<[number, number]>> = [];
          for (let ringIndex = 0; ringIndex < numRings; ringIndex++) {
            rings.push(parseLineStringCoords());
          }
          polys.push(rings);
        }
        return {
          type: "MultiPolygon",
          coordinates: polys,
        };
      }
    } catch {
      return null;
    }

    return null;
  }
}

/** Convenience export */
export const normalizeCoordinate = EwkbGeometryParser.normalizeCoordinate;
