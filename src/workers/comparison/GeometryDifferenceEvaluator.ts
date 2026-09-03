import type { ColumnMappingConfig } from "@/types/comparison";
import { compareGeometries } from "@/utils/spatial/SpatialGeometryComparator";
import { parseAnyGeometryString } from "@/utils/spatial/WktGeometryParser";

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

    // Resolve mapped geometry columns (e.g. DB "geom_wkb" <-> CSV "geom")
    let mappedDbCol: string | undefined = undefined;
    let mappedFileCol: string | undefined = undefined;

    if (mappingConfig.attributeMap) {
      for (const [dbKey, fileKey] of Object.entries(mappingConfig.attributeMap)) {
        if (/geom/i.test(dbKey) || /geom/i.test(fileKey)) {
          mappedDbCol = dbKey;
          mappedFileCol = fileKey;
          break;
        }
      }
    }

    const rawDbGeom =
      (mappedDbCol ? dbRecord[mappedDbCol] : undefined) ??
      dbRecord.geom ??
      dbRecord.geometry ??
      dbRecord.geom_wkb ??
      dbRecord.wkb_geometry ??
      dbRecord.wkt ??
      dbRecord.the_geom;

    const dbGeom =
      typeof rawDbGeom === "string"
        ? parseAnyGeometryString(rawDbGeom) || rawDbGeom
        : rawDbGeom;

    const rawFileGeom =
      fileGeometry ??
      (mappedFileCol && fileRecord ? fileRecord[mappedFileCol] : undefined);

    const fileGeom =
      typeof rawFileGeom === "string"
        ? parseAnyGeometryString(rawFileGeom) || rawFileGeom
        : rawFileGeom;

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
}
