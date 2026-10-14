import type { ColumnMappingConfig } from "@/core/types/comparison";
import { compareGeometries } from "@/core/spatial/SpatialGeometryComparator";
import { parseAnyGeometryString } from "@/core/spatial/WktGeometryParser";

export interface GeometryEvaluationResult {
  isGeometryDifferent: boolean;
  geometryDiffDetails?: string;
  resolvedDbGeom: unknown;
  resolvedFileGeom: unknown;
}

/**
 * GeometryDifferenceEvaluator.ts
 * Resolves PostGIS and file geometry fields, parses WKT/GeoJSON representations,
 * and performs tolerance-based spatial polygon/geometry comparisons.
 */
export class GeometryDifferenceEvaluator {
  public evaluateGeometryDifference(
    dbRecord: Record<string, unknown>,
    fileRecord: Record<string, unknown> | undefined,
    fileGeometry: unknown,
    mappingConfig: ColumnMappingConfig
  ): GeometryEvaluationResult {
    if (!mappingConfig.compareGeometry) {
      return {
        isGeometryDifferent: false,
        geometryDiffDetails: undefined,
        resolvedDbGeom: null,
        resolvedFileGeom: null,
      };
    }

    const dbGeom = this.resolveDbGeometry(dbRecord, mappingConfig);
    const fileGeom = this.resolveFileGeometry(fileRecord, fileGeometry, mappingConfig);

    if (dbGeom && fileGeom) {
      const geoCompResult = compareGeometries(dbGeom, fileGeom);
      if (!geoCompResult.isMatch) {
        return {
          isGeometryDifferent: true,
          geometryDiffDetails: geoCompResult.details,
          resolvedDbGeom: dbGeom,
          resolvedFileGeom: fileGeom,
        };
      }
    }

    return {
      isGeometryDifferent: false,
      geometryDiffDetails: undefined,
      resolvedDbGeom: dbGeom,
      resolvedFileGeom: fileGeom,
    };
  }

  public resolveDbGeometry(
    dbRecord: Record<string, unknown>,
    mappingConfig: ColumnMappingConfig
  ): unknown {
    const { mappedDbCol } = this.findMappedGeometryColumns(mappingConfig);
    const rawDbGeom =
      (mappedDbCol ? dbRecord[mappedDbCol] : undefined) ??
      dbRecord.geom ??
      dbRecord.geometry ??
      dbRecord.geom_wkb ??
      dbRecord.wkb_geometry ??
      dbRecord.wkt ??
      dbRecord.the_geom;
    return this.parseIfString(rawDbGeom);
  }

  public resolveFileGeometry(
    fileRecord: Record<string, unknown> | undefined,
    fileGeometry: unknown,
    mappingConfig: ColumnMappingConfig
  ): unknown {
    const { mappedFileCol } = this.findMappedGeometryColumns(mappingConfig);
    const rawFileGeom =
      fileGeometry ??
      (mappedFileCol && fileRecord ? fileRecord[mappedFileCol] : undefined);
    return this.parseIfString(rawFileGeom);
  }

  private parseIfString(rawGeometry: unknown): unknown {
    return typeof rawGeometry === "string"
      ? parseAnyGeometryString(rawGeometry) || rawGeometry
      : rawGeometry;
  }

  private findMappedGeometryColumns(mappingConfig: ColumnMappingConfig): {
    mappedDbCol?: string;
    mappedFileCol?: string;
  } {
    if (!mappingConfig.attributeMap) return {};
    for (const [dbKey, fileKey] of Object.entries(mappingConfig.attributeMap)) {
      if (/geom/i.test(dbKey) || /geom/i.test(fileKey)) {
        return { mappedDbCol: dbKey, mappedFileCol: fileKey };
      }
    }
    return {};
  }
}
