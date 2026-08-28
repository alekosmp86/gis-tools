import type { Geometry } from "geojson";

/**
 * Converts UTM Zone 19S (EPSG:32719) coordinates (easting, northing) in meters
 * to WGS84 (longitude, latitude) degrees.
 */
export function utm19sToWgs84(easting: number, northing: number): [number, number] {
  const k0 = 0.9996;
  const a = 6378137.0; // WGS84 semi-major axis
  const f = 1 / 298.257223563; // WGS84 flattening
  const b = a * (1 - f);
  const e2 = (a * a - b * b) / (a * a);
  const ePrime2 = (a * a - b * b) / (b * b);

  const xCoordinate = easting - 500000.0;
  const yCoordinate = northing - 10000000.0; // Southern Hemisphere

  const M = yCoordinate / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * Math.pow(e2, 3)) / 256));

  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));

  const phi1Rad =
    mu +
    ((3 * e1) / 2 - (27 * Math.pow(e1, 3)) / 32) * Math.sin(2 * mu) +
    ((21 * e1 * e1) / 16 - (55 * Math.pow(e1, 4)) / 32) * Math.sin(4 * mu) +
    ((151 * Math.pow(e1, 3)) / 96) * Math.sin(6 * mu) +
    ((1097 * Math.pow(e1, 4)) / 512) * Math.sin(8 * mu);

  const sinPhi1 = Math.sin(phi1Rad);
  const cosPhi1 = Math.cos(phi1Rad);
  const tanPhi1 = Math.tan(phi1Rad);

  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = ePrime2 * cosPhi1 * cosPhi1;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = xCoordinate / (N1 * k0);

  const latRad =
    phi1Rad -
    ((N1 * tanPhi1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ePrime2) * Math.pow(D, 4)) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ePrime2 - 3 * C1 * C1) * Math.pow(D, 6)) /
          720);

  const lonRad =
    (-57.0 * Math.PI) / 180.0 +
    (D -
      ((1 + 2 * T1 + C1) * Math.pow(D, 3)) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ePrime2 + 24 * T1 * T1) * Math.pow(D, 5)) / 120) /
      cosPhi1;

  const lat = (latRad * 180.0) / Math.PI;
  const lon = (lonRad * 180.0) / Math.PI;

  return [lon, lat];
}

/**
 * Checks whether a coordinate point is in UTM meters range (e.g. Easting 100000..900000, Northing 5000000..9000000)
 */
function isUtmCoordinates(xCoordinate: number, yCoordinate: number): boolean {
  return Math.abs(xCoordinate) > 180 || Math.abs(yCoordinate) > 90;
}

/**
 * Normalizes a coordinate pair [xCoordinate, yCoordinate] to [lon, lat] degrees.
 */
export function normalizeCoordinate(xCoordinate: number, yCoordinate: number): [number, number] {
  if (isUtmCoordinates(xCoordinate, yCoordinate)) {
    return utm19sToWgs84(xCoordinate, yCoordinate);
  }
  return [xCoordinate, yCoordinate];
}

/**
 * Parses PostGIS EWKB Hex geometry strings (e.g. '0105000020D17F0000...') into standard GeoJSON Geometry objects.
 */
export function parseEwkbHexToGeoJson(hexStr: string): Geometry | null {
  if (!hexStr || typeof hexStr !== "string") return null;

  const cleanHex = hexStr.trim();
  if (cleanHex.length < 18) return null;

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
      return normalizeCoordinate(xCoordinate, yCoordinate);
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
        offset += 5; // Sub-header (1 byte endian + 4 byte type)
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
        offset += 5; // Sub-header (1 byte endian + 4 byte type)
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
        offset += 5; // Sub-header (1 byte endian + 4 byte type)
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
