import type { FeatureCollection, Feature, Geometry, GeoJsonProperties } from "geojson";
import { DiscrepancyFilter } from "@/types/comparison";
import type {
  ComparisonSummary,
  DiscrepancyFilter as DiscrepancyFilterType,
  DiscrepancyItem,
} from "@/types/comparison";
import type { ParsedFileDataset } from "@/types/parsers";
import type { ParsedShapefileData } from "@/types/shp";
import { cleanSuid } from "@/utils/common/GisStringSanitizer";
import { normalizeGeometry } from "@/utils/spatial/SpatialGeometryComparator";

/**
 * Builds an index of geometries from an existing FeatureCollection keyed by cleaned SUID.
 */
function buildDatasetGeometryMap(
  geojson?: FeatureCollection | null
): Map<string, Geometry> {
  const geoMap = new Map<string, Geometry>();
  if (!geojson || !geojson.features) {
    return geoMap;
  }

  geojson.features.forEach((feature) => {
    if (feature.geometry && feature.properties) {
      const firstAttributeKey = Object.keys(feature.properties)[0];
      if (firstAttributeKey) {
        const featureKey = cleanSuid(feature.properties[firstAttributeKey]);
        if (featureKey) {
          geoMap.set(featureKey, feature.geometry);
        }
      }
    }
  });

  return geoMap;
}

/**
 * Extracts and normalizes DB geometry from a database record.
 */
function extractDbGeometry(
  dbRecord?: Record<string, unknown>
): Geometry | null {
  if (!dbRecord) return null;
  const rawDbGeometry =
    dbRecord.geom || dbRecord.geometry || dbRecord.wkb_geometry || dbRecord.shape;
  return rawDbGeometry ? (normalizeGeometry(rawDbGeometry) as Geometry | null) : null;
}

/**
 * Extracts and normalizes File/Shapefile geometry from a discrepancy item.
 */
function extractFileGeometry(
  item: DiscrepancyItem,
  geoMap: Map<string, Geometry>
): Geometry | null {
  const rawFileGeometry =
    (item.shpGeometry as Geometry | undefined) ||
    (item.suid ? geoMap.get(cleanSuid(item.suid)) : undefined);
  return rawFileGeometry
    ? (normalizeGeometry(rawFileGeometry) as Geometry | null)
    : null;
}

/**
 * Creates visual GeoJSON feature overlays for a single discrepancy item.
 */
function createDiscrepancyFeatures(
  item: DiscrepancyItem,
  geoMap: Map<string, Geometry>
): Array<Feature<Geometry, GeoJsonProperties>> {
  const features: Array<Feature<Geometry, GeoJsonProperties>> = [];
  const dbGeometry = extractDbGeometry(item.dbRecord);
  const fileGeometry = extractFileGeometry(item, geoMap);
  const isMatch = item.type === "MATCH";

  if (dbGeometry) {
    features.push({
      type: "Feature",
      geometry: dbGeometry,
      properties: {
        ...(item.dbRecord || {}),
        suid: item.suid,
        _discrepancyType: isMatch ? "MATCH" : "DB_FEATURE",
        _featureSource: "DB",
        _sourceLabel: "Base de Datos (PostGIS)",
        _discrepancyNote: item.note,
        _differencesCount: item.differences.length,
      },
    });
  }

  if (fileGeometry) {
    features.push({
      type: "Feature",
      geometry: fileGeometry,
      properties: {
        ...(item.shpFeatureProps || {}),
        suid: item.suid,
        _discrepancyType: isMatch ? "MATCH" : "FILE_FEATURE",
        _featureSource: "FILE",
        _sourceLabel: "Archivo Fuente (Shapefile)",
        _discrepancyNote: item.note,
        _differencesCount: item.differences.length,
      },
    });
  }

  return features;
}

/**
 * Custom hook that generates GeoJSON FeatureCollections for discrepancy visualization on the map.
 */
export function useDiscrepancyGeojson(
  summary: ComparisonSummary | undefined,
  fileDataset: ParsedShapefileData | ParsedFileDataset,
  activeFilter: DiscrepancyFilterType,
  isMapActive: boolean = true
): FeatureCollection | null {
  if (!isMapActive) {
    return null;
  }

  if (!summary || !summary.items) {
    return fileDataset.geojson || null;
  }

  const geoMap = buildDatasetGeometryMap(fileDataset.geojson);
  const itemsToRender = summary.items.filter(
    (item) => activeFilter === DiscrepancyFilter.ALL || item.type === activeFilter
  );

  const features = itemsToRender.flatMap((item) =>
    createDiscrepancyFeatures(item, geoMap)
  );

  if (features.length === 0 && fileDataset.geojson) {
    return fileDataset.geojson;
  }

  return {
    type: "FeatureCollection",
    features,
  };
}
