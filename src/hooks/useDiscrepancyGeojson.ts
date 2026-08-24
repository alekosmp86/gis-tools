import type { FeatureCollection, Feature, Geometry, GeoJsonProperties } from "geojson";
import { DiscrepancyFilter } from "@/types/comparison";
import type { ComparisonSummary, DiscrepancyFilter as DiscrepancyFilterType } from "@/types/comparison";
import type { ParsedFileDataset } from "@/types/parsers";
import type { ParsedShapefileData } from "@/types/shp";
import { cleanSuid } from "@/utils/gisCleaners";

export function useDiscrepancyGeojson(
  summary: ComparisonSummary | undefined,
  fileDataset: ParsedShapefileData | ParsedFileDataset,
  activeFilter: DiscrepancyFilterType
): FeatureCollection | null {
  if (!summary || !summary.items) return fileDataset.geojson || null;

  const geoMap = new Map<string, Geometry>();
  if (fileDataset.geojson && fileDataset.geojson.features) {
    fileDataset.geojson.features.forEach((feat) => {
      if (feat.geometry && feat.properties) {
        const firstAttr = Object.keys(feat.properties)[0];
        if (firstAttr) {
          const key = cleanSuid(feat.properties[firstAttr]);
          if (key) geoMap.set(key, feat.geometry);
        }
      }
    });
  }

  const features: Array<Feature<Geometry, GeoJsonProperties>> = [];
  const itemsToRender = summary.items.filter((item) => {
    return activeFilter === DiscrepancyFilter.ALL || item.type === activeFilter;
  });

  itemsToRender.forEach((item) => {
    const geom = (item.shpGeometry as Geometry | undefined) || geoMap.get(cleanSuid(item.suid));
    if (geom) {
      features.push({
        type: "Feature",
        geometry: geom,
        properties: {
          ...(item.shpFeatureProps || item.dbRecord || {}),
          suid: item.suid,
          _discrepancyType: item.type,
          _discrepancyNote: item.note,
          _differencesCount: item.differences.length,
        },
      });
    }
  });

  if (features.length === 0 && fileDataset.geojson) {
    return fileDataset.geojson;
  }

  return {
    type: "FeatureCollection",
    features,
  };
}
