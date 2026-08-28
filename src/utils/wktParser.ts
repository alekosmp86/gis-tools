import type { Geometry } from "geojson";
import { normalizeCoordinate, parseEwkbHexToGeoJson } from "./ewkbParser";

/**
 * Parses a Well-Known Text (WKT) string (e.g. 'POINT(-56.16 -34.90)', 'POLYGON((...))') into a GeoJSON Geometry object.
 */
export function parseWktToGeoJson(wktStr: string): Geometry | null {
  if (!wktStr || typeof wktStr !== "string") return null;

  const str = wktStr.trim();
  if (str.length < 7) return null;

  try {
    // 1. POINT(x y) or POINT (x y)
    const pointMatch = str.match(/^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/i);
    if (pointMatch) {
      const xCoordinate = parseFloat(pointMatch[1]);
      const yCoordinate = parseFloat(pointMatch[2]);
      return {
        type: "Point",
        coordinates: normalizeCoordinate(xCoordinate, yCoordinate),
      };
    }

    // 2. LINESTRING(x1 y1, x2 y2, ...)
    const lineMatch = str.match(/^LINESTRING\s*\((.+)\)$/i);
    if (lineMatch) {
      const coordsStr = lineMatch[1];
      const pts = coordsStr.split(",").map((pointPair) => {
        const [xStr, yStr] = pointPair.trim().split(/\s+/);
        return normalizeCoordinate(parseFloat(xStr), parseFloat(yStr));
      });
      return {
        type: "LineString",
        coordinates: pts,
      };
    }

    // 3. POLYGON((x1 y1, x2 y2, ...), (...))
    const polyMatch = str.match(/^POLYGON\s*\(\s*\((.+)\)\s*\)$/i);
    if (polyMatch) {
      const ringsRaw = str.replace(/^POLYGON\s*\(/i, "").replace(/\)$/, "").trim();
      const ringStrings = ringsRaw.split(/\)\s*,\s*\(/);
      const rings = ringStrings.map((ringStr) => {
        const cleanRing = ringStr.replace(/^\(/, "").replace(/\)$/, "").trim();
        return cleanRing.split(",").map((pointPair) => {
          const [xStr, yStr] = pointPair.trim().split(/\s+/);
          return normalizeCoordinate(parseFloat(xStr), parseFloat(yStr));
        });
      });
      return {
        type: "Polygon",
        coordinates: rings,
      };
    }

    // 4. MULTIPOLYGON(((...)))
    const multiPolyMatch = str.match(/^MULTIPOLYGON\s*\(\s*\(\s*\((.+)\)\s*\)\s*\)$/i);
    if (multiPolyMatch) {
      const polysRaw = str.replace(/^MULTIPOLYGON\s*\(\s*\(/i, "").replace(/\)\s*\)$/, "").trim();
      const polyStrings = polysRaw.split(/\)\s*\)\s*,\s*\(\s*\(/);
      const polys = polyStrings.map((polyStr) => {
        const ringStrings = polyStr.split(/\)\s*,\s*\(/);
        return ringStrings.map((ringStr) => {
          const cleanRing = ringStr.replace(/^\(/, "").replace(/\)$/, "").trim();
          return cleanRing.split(",").map((pointPair) => {
            const [xStr, yStr] = pointPair.trim().split(/\s+/);
            return normalizeCoordinate(parseFloat(xStr), parseFloat(yStr));
          });
        });
      });
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

/**
 * Parses any geometry representation from a string cell: EWKB Hex or WKT format.
 */
export function parseAnyGeometryString(geomVal: unknown): Geometry | null {
  if (!geomVal) return null;
  const str = String(geomVal).trim();
  if (!str) return null;

  // Try EWKB Hex first (starts with 01 or 00 and contains hex characters)
  if (/^[0-9a-fA-F]{18,}$/.test(str)) {
    const parsed = parseEwkbHexToGeoJson(str);
    if (parsed) return parsed;
  }

  // Try WKT next
  return parseWktToGeoJson(str);
}
