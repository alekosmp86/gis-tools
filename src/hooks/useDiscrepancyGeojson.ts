import { useDeferredValue } from "react";
import type { FeatureCollection, Feature, Geometry, GeoJsonProperties } from "geojson";
import { DiscrepancyFilter } from "@/types/comparison";
import type { ComparisonSummary, DiscrepancyFilter as DiscrepancyFilterType } from "@/types/comparison";
import type { ParsedFileDataset } from "@/types/parsers";
import type { ParsedShapefileData } from "@/types/shp";
import { cleanSuid } from "@/utils/common/GisStringSanitizer";
import { normalizeGeometry } from "@/utils/spatial/SpatialGeometryComparator";

export function useDiscrepancyGeojson(
  summary: ComparisonSummary | undefined,
  fileDataset: ParsedShapefileData | ParsedFileDataset,
  activeFilter: DiscrepancyFilterType
): FeatureCollection | null {
  const deferredFilter = useDeferredValue(activeFilter);

  if (!summary || !summary.items) {
    return fileDataset.geojson || null;
  }

  const geoMap = new Map<string, Geometry>();
  if (fileDataset.geojson && fileDataset.geojson.features) {
    fileDataset.geojson.features.forEach((feature) => {
      if (feature.geometry && feature.properties) {
        const firstAttr = Object.keys(feature.properties)[0];
        if (firstAttr) {
          const featureKey = cleanSuid(feature.properties[firstAttr]);
          if (featureKey) {
            geoMap.set(featureKey, feature.geometry);
          }
        }
      }
    });
  }

  const features: Array<Feature<Geometry, GeoJsonProperties>> = [];
  const itemsToRender = summary.items.filter((item) => {
    return deferredFilter === DiscrepancyFilter.ALL || item.type === deferredFilter;
  });

  const totalItems = itemsToRender.length;
  for (let index = 0; index < totalItems; index++) {
    const item = itemsToRender[index];
    const rawShpGeom =
      (item.shpGeometry as Geometry | undefined) ||
      (item.suid ? geoMap.get(cleanSuid(item.suid)) : undefined);
    const shpGeom = rawShpGeom ? (normalizeGeometry(rawShpGeom) as Geometry | null) : null;

    // Extract DB geometry if present in dbRecord
    const rawDbGeom = item.dbRecord
      ? item.dbRecord.geom ||
        item.dbRecord.geometry ||
        item.dbRecord.wkb_geometry ||
        item.dbRecord.shape
      : null;
    const dbGeom = rawDbGeom ? (normalizeGeometry(rawDbGeom) as Geometry | null) : null;

    // 1. Render DB Feature if geometry exists
    if (dbGeom) {
      features.push({
        type: "Feature",
        geometry: dbGeom,
        properties: {
          ...(item.dbRecord || {}),
          suid: item.suid,
          _discrepancyType: item.type === "MATCH" ? "MATCH" : "DB_FEATURE",
          _featureSource: "DB",
          _sourceLabel: "Base de Datos (PostGIS)",
          _discrepancyNote: item.note,
          _differencesCount: item.differences.length,
        },
      });
    }

    // 2. Render File/SHP Feature if geometry exists
    if (shpGeom) {
      features.push({
        type: "Feature",
        geometry: shpGeom,
        properties: {
          ...(item.shpFeatureProps || {}),
          suid: item.suid,
          _discrepancyType: item.type === "MATCH" ? "MATCH" : "FILE_FEATURE",
          _featureSource: "FILE",
          _sourceLabel: "Archivo Fuente (Shapefile)",
          _discrepancyNote: item.note,
          _differencesCount: item.differences.length,
        },
      });
    }
  }

  if (features.length === 0 && fileDataset.geojson) {
    return fileDataset.geojson;
  }

  return {
    type: "FeatureCollection",
    features,
  };
}
