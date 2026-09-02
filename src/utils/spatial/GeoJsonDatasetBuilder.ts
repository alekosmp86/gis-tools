import type { FeatureCollection, Feature, Geometry } from "geojson";
import { EwkbGeometryParser } from "./EwkbGeometryParser";
import { WktGeometryParser } from "./WktGeometryParser";

export interface ParsedRecordGeoJsonResult {
  geojson: FeatureCollection | null;
  detectedGeometryType: string | null;
}

/**
 * GeoJsonDatasetBuilder
 * Object-Oriented Builder for transforming raw database records or tabular datasets into GeoJSON FeatureCollections.
 */
export class GeoJsonDatasetBuilder {
  private readonly ewkbParser = new EwkbGeometryParser();
  private readonly wktParser = new WktGeometryParser();

  /**
   * Scans record columns for geometry fields (EWKB Hex or WKT) and constructs a FeatureCollection.
   */
  public buildFromRecords(
    records: Array<Record<string, unknown>>,
    columns: string[]
  ): ParsedRecordGeoJsonResult {
    if (!records || records.length === 0 || columns.length === 0) {
      return { geojson: null, detectedGeometryType: null };
    }

    // Identify candidate geometry column
    const geomColName = columns.find((columnName) => {
      const lower = columnName.toLowerCase();
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

    records.forEach((record, recordIndex) => {
      let geometry: Geometry | null = null;

      if (geomColName && record[geomColName]) {
        const val = String(record[geomColName]).trim();
        if (/^[0-9a-fA-F]+$/.test(val) && val.length >= 16) {
          geometry = this.ewkbParser.parse(val);
        } else if (/^[A-Z]+\s*\(/.test(val)) {
          geometry = this.wktParser.parse(val);
        }
      } else {
        // Fallback search across all columns for EWKB Hex
        for (const col of columns) {
          const val = String(record[col] || "").trim();
          if (/^[0-9a-fA-F]+$/.test(val) && val.length >= 32) {
            const parsed = this.ewkbParser.parse(val);
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
          id: recordIndex,
          geometry,
          properties: { ...record },
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

  public static parseRecordsToGeoJson(
    records: Array<Record<string, unknown>>,
    columns: string[]
  ): ParsedRecordGeoJsonResult {
    const builder = new GeoJsonDatasetBuilder();
    return builder.buildFromRecords(records, columns);
  }
}

/** Convenience export */
export const parseRecordsToGeoJson = GeoJsonDatasetBuilder.parseRecordsToGeoJson;
