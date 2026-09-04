import type { FeatureCollection, Feature, Geometry } from "geojson";
import { GeometryRawNormalizer } from "./GeometryRawNormalizer";

export interface ParsedRecordGeoJsonResult {
  geojson: FeatureCollection | null;
  detectedGeometryType: string | null;
}

/**
 * GeoJsonDatasetBuilder
 * Object-Oriented Builder for transforming raw database records or tabular datasets into GeoJSON FeatureCollections.
 */
export class GeoJsonDatasetBuilder {
  private readonly normalizer: GeometryRawNormalizer;

  constructor(normalizer = new GeometryRawNormalizer()) {
    this.normalizer = normalizer;
  }

  /**
   * Scans record columns for geometry fields (GeoJSON objects, JSON strings, EWKB Hex, WKT)
   * and constructs a FeatureCollection.
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

      if (geomColName && record[geomColName] != null) {
        geometry = this.normalizer.normalizeGeometry(record[geomColName]);
      }

      // Fallback search across all columns if candidate column was null or not found
      if (!geometry) {
        for (const col of columns) {
          if (col === geomColName) continue;
          const val = record[col];
          if (val != null) {
            const parsed = this.normalizer.normalizeGeometry(val);
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
