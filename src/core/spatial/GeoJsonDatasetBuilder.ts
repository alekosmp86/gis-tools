import type { FeatureCollection, Feature, Geometry } from "geojson";
import { GeometryRawNormalizer } from "./GeometryRawNormalizer";

export interface ParsedRecordGeoJsonResult {
  geojson: FeatureCollection | null;
  detectedGeometryType: string | null;
}

/** Substring shared by the usual PostGIS geometry column names (`geom`, `geometry`, `wkb_geometry`). */
const GEOMETRY_COLUMN_KEYWORD = "geom";

/** Geometry column names that do not contain the shared keyword. */
const GEOMETRY_COLUMN_ALIASES: readonly string[] = ["wkt"];

const EMPTY_PARSED_RESULT: ParsedRecordGeoJsonResult = {
  geojson: null,
  detectedGeometryType: null,
};

/**
 * GeoJsonDatasetBuilder
 * Object-Oriented Builder for transforming raw database records or tabular datasets into GeoJSON FeatureCollections.
 */
export class GeoJsonDatasetBuilder {
  private readonly normalizer = new GeometryRawNormalizer();

  /**
   * Scans record columns for geometry fields (GeoJSON objects, JSON strings, EWKB Hex, WKT)
   * and constructs a FeatureCollection.
   */
  public buildFromRecords(
    records: Array<Record<string, unknown>>,
    columns: string[]
  ): ParsedRecordGeoJsonResult {
    if (!records || records.length === 0 || columns.length === 0) {
      return EMPTY_PARSED_RESULT;
    }

    const geometryColumnName = this.findGeometryColumnName(columns);
    const features: Feature[] = [];
    let detectedGeometryType: string | null = null;

    records.forEach((record, recordIndex) => {
      const geometry = this.resolveRecordGeometry(record, columns, geometryColumnName);
      if (!geometry) {
        return;
      }

      if (!detectedGeometryType) {
        detectedGeometryType = geometry.type;
      }

      features.push({
        type: "Feature",
        id: recordIndex,
        geometry,
        properties: { ...record },
      });
    });

    if (features.length === 0) {
      return EMPTY_PARSED_RESULT;
    }

    return {
      geojson: {
        type: "FeatureCollection",
        features,
      },
      detectedGeometryType,
    };
  }

  /** Picks the first column whose name looks like a geometry field. */
  private findGeometryColumnName(columns: string[]): string | undefined {
    return columns.find((columnName) => {
      const normalizedColumnName = columnName.toLowerCase();
      return (
        normalizedColumnName.includes(GEOMETRY_COLUMN_KEYWORD) ||
        GEOMETRY_COLUMN_ALIASES.includes(normalizedColumnName)
      );
    });
  }

  /**
   * Resolves the geometry of a single record, preferring the detected geometry column and falling
   * back to the first other column holding a parseable geometry value.
   */
  private resolveRecordGeometry(
    record: Record<string, unknown>,
    columns: string[],
    geometryColumnName: string | undefined
  ): Geometry | null {
    if (geometryColumnName && record[geometryColumnName] != null) {
      const candidateGeometry = this.normalizer.normalizeGeometry(record[geometryColumnName]);
      if (candidateGeometry) {
        return candidateGeometry;
      }
    }

    return this.findGeometryInOtherColumns(record, columns, geometryColumnName);
  }

  /** Scans every remaining column of a record until a value normalizes into a geometry. */
  private findGeometryInOtherColumns(
    record: Record<string, unknown>,
    columns: string[],
    excludedColumnName: string | undefined
  ): Geometry | null {
    for (const columnName of columns) {
      if (columnName === excludedColumnName) {
        continue;
      }

      const rawValue = record[columnName];
      if (rawValue == null) {
        continue;
      }

      const candidateGeometry = this.normalizer.normalizeGeometry(rawValue);
      if (candidateGeometry) {
        return candidateGeometry;
      }
    }

    return null;
  }

  public static parseRecordsToGeoJson(
    records: Array<Record<string, unknown>>,
    columns: string[]
  ): ParsedRecordGeoJsonResult {
    return new GeoJsonDatasetBuilder().buildFromRecords(records, columns);
  }
}

/** Convenience export */
export const parseRecordsToGeoJson = GeoJsonDatasetBuilder.parseRecordsToGeoJson;
