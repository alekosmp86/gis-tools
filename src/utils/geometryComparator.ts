export interface GeometryComparisonResult {
  isMatch: boolean;
  details?: string;
  dbType?: string;
  fileType?: string;
  dbGeomNormalized?: GeoJSON.Geometry | null;
  fileGeomNormalized?: GeoJSON.Geometry | null;
}

export function parseWktToGeoJSON(wkt: string): GeoJSON.Geometry | null {
  const trimmed = wkt.trim();
  if (!trimmed) return null;

  // Match WKT pattern: TYPE(...)
  const match = trimmed.match(/^([A-Za-z]+)\s*\(([\s\S]*)\)$/);
  if (!match) return null;

  const typeUpper = match[1].toUpperCase();
  const content = match[2].trim();

  try {
    if (typeUpper === "POINT") {
      const coords = content.replace(/[()]/g, "").trim().split(/\s+/).map(Number);
      if (coords.length >= 2 && !coords.some(isNaN)) {
        return { type: "Point", coordinates: [coords[0], coords[1]] };
      }
    }

    if (typeUpper === "LINESTRING") {
      const points = content.replace(/[()]/g, "").split(",").map((ptStr) => {
        const coords = ptStr.trim().split(/\s+/).map(Number);
        return [coords[0], coords[1]];
      });
      return { type: "LineString", coordinates: points };
    }

    if (typeUpper === "POLYGON") {
      // Content has rings separated by parentheses: ((x y, x y), (x y, x y))
      const ringMatches = content.match(/\(([^()]+)\)/g);
      if (ringMatches) {
        const rings = ringMatches.map((ringStr) => {
          const inner = ringStr.replace(/[()]/g, "");
          return inner.split(",").map((ptStr) => {
            const coords = ptStr.trim().split(/\s+/).map(Number);
            return [coords[0], coords[1]];
          });
        });
        return { type: "Polygon", coordinates: rings };
      }
    }
  } catch {
    return null;
  }

  return null;
}

export function normalizeGeometry(raw: unknown): GeoJSON.Geometry | null {
  if (!raw) return null;

  if (typeof raw === "object" && raw !== null && "type" in raw && "coordinates" in raw) {
    return raw as GeoJSON.Geometry;
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && "type" in parsed && "coordinates" in parsed) {
          return parsed as GeoJSON.Geometry;
        }
      } catch {
        // Fall through to WKT check
      }
    }
    return parseWktToGeoJSON(trimmed);
  }

  return null;
}

function roundCoordinate(num: number): number {
  return Math.round(num * 1e6) / 1e6;
}

function roundCoordinatesDeep(coords: unknown): unknown {
  if (typeof coords === "number") {
    return roundCoordinate(coords);
  }
  if (Array.isArray(coords)) {
    return coords.map(roundCoordinatesDeep);
  }
  return coords;
}

export function compareGeometries(
  dbGeomRaw: unknown,
  fileGeomRaw: unknown
): GeometryComparisonResult {
  const dbGeom = normalizeGeometry(dbGeomRaw);
  const fileGeom = normalizeGeometry(fileGeomRaw);

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
  const normalizeType = (t: string) => t.replace(/^Multi/, "");
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

  // Coordinate comparison rounded to ~10cm tolerance (6 decimal places)
  const dbCoords = "coordinates" in dbGeom ? dbGeom.coordinates : null;
  const fileCoords = "coordinates" in fileGeom ? fileGeom.coordinates : null;

  const dbRounded = roundCoordinatesDeep(dbCoords);
  const fileRounded = roundCoordinatesDeep(fileCoords);

  const isCoordsMatch = JSON.stringify(dbRounded) === JSON.stringify(fileRounded);

  if (!isCoordsMatch) {
    return {
      isMatch: false,
      details: `Topología / Coordenadas espaciales no coinciden`,
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
