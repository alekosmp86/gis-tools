import type { FeatureCollection, Feature, Geometry } from "geojson";
import { parseEwkbHexToGeoJson } from "./ewkbParser";
import { parseWktToGeoJson } from "./wktParser";

export interface ParsedRecordGeoJsonResult {
  geojson: FeatureCollection | null;
  detectedGeometryType: string | null;
}

/**
  * Parses tabular records and extracts spatial geometries (EWKB Hex / WKT) into a GeoJSON FeatureCollection.
  */
export function parseRecordsToGeoJson(
  records: Array<Record<string, unknown>>,
  columns: string[]
): ParsedRecordGeoJsonResult {
  if (!records || records.length === 0 || columns.length === 0) {
    return { geojson: null, detectedGeometryType: null };
  }

  // Identify candidate geometry column
  const geomColName = columns.find((c) => {
    const lower = c.toLowerCase();
    return (
      lower === "geom" ||
      lower === "geometry" ||
      lower === "wkt" ||
      lower === "wkb_geometry" ||
      lower.includes("geom")
    );
  });

  const features: Feature[] = [];
  let geoType: string | null = null;

  records.forEach((rec, idx) => {
    let geometry: Geometry | null = null;

    if (geomColName && rec[geomColName]) {
      const val = String(rec[geomColName]).trim();
      // Check if EWKB Hex
      if (/^[0-9a-fA-F]+$/.test(val) && val.length >= 16) {
        geometry = parseEwkbHexToGeoJson(val);
      } else if (/^[A-Z]+\s*\(/.test(val)) {
        // WKT String
        geometry = parseWktToGeoJson(val);
      }
    } else {
      // Fallback search across all record properties for EWKB Hex
      for (const col of columns) {
        const val = String(rec[col] || "").trim();
        if (/^[0-9a-fA-F]+$/.test(val) && val.length >= 32) {
          const parsed = parseEwkbHexToGeoJson(val);
          if (parsed) {
            geometry = parsed;
            break;
          }
        }
      }
    }

    if (geometry) {
      if (!geoType) {
        geoType = geometry.type;
      }
      features.push({
        type: "Feature",
        id: idx,
        geometry,
        properties: { ...rec },
      });
    }
  });

  if (features.length === 0) {
    return { geojson: null, detectedGeometryType: null };
  }

  return {
    geojson: {
      type: "FeatureCollection",
      features,
    },
    detectedGeometryType: geoType,
  };
}
