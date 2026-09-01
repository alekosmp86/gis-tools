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

function normalizeRing(ring: Array<[number, number]>): Array<[number, number]> {
  if (!ring || ring.length === 0) return [];

  // 1. Round coordinates to 4 decimal places (~10 meters spatial tolerance to absorb projection noise)
  let pts: Array<[number, number]> = ring.map(([x, y]) => [
    Math.round(x * 1e4) / 1e4,
    Math.round(y * 1e4) / 1e4,
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

function getRingKey(ring: Array<[number, number]>): string {
  if (ring.length === 0) return "";
  let sumX = 0;
  let sumY = 0;
  ring.forEach(([x, y]) => {
    sumX += x;
    sumY += y;
  });
  const count = ring.length;
  const avgX = Math.round((sumX / count) * 1e4) / 1e4;
  const avgY = Math.round((sumY / count) * 1e4) / 1e4;
  return `${avgX}_${avgY}_${ring.length}`;
}

function extractRings(geom: GeoJSON.Geometry): Array<Array<[number, number]>> {
  const allRings: Array<Array<[number, number]>> = [];

  if (geom.type === "Polygon") {
    (geom.coordinates as Array<Array<[number, number]>>).forEach((ring) => {
      const norm = normalizeRing(ring);
      if (norm.length > 0) allRings.push(norm);
    });
  } else if (geom.type === "MultiPolygon") {
    const multiCoords = geom.coordinates as Array<Array<Array<[number, number]>>>;
    multiCoords.forEach((poly) => {
      poly.forEach((ring) => {
        const norm = normalizeRing(ring);
        if (norm.length > 0) allRings.push(norm);
      });
    });
  }

  // Sort rings deterministically by centroid & point count
  allRings.sort((ringA, ringB) => getRingKey(ringA).localeCompare(getRingKey(ringB)));

  return allRings;
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

  // Handle Polygons / MultiPolygons
  if (normalizeType(dbGeom.type) === "Polygon") {
    const dbRings = extractRings(dbGeom);
    const fileRings = extractRings(fileGeom);

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

  // Fallback for Points / LineStrings: compare coordinates with 4 decimal places (~10m tolerance)
  const dbCoords = "coordinates" in dbGeom ? dbGeom.coordinates : null;
  const fileCoords = "coordinates" in fileGeom ? fileGeom.coordinates : null;

  const roundDeep = (obj: unknown): unknown => {
    if (typeof obj === "number") return Math.round(obj * 1e4) / 1e4;
    if (Array.isArray(obj)) return obj.map(roundDeep);
    return obj;
  };

  const isCoordsMatch = JSON.stringify(roundDeep(dbCoords)) === JSON.stringify(roundDeep(fileCoords));

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
