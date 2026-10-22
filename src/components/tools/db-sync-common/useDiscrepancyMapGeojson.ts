import { useState } from "react";
import type { FeatureCollection } from "geojson";
import { useDiscrepancyGeojson } from "@/hooks/useDiscrepancyGeojson";
import type { ParsedFileDataset } from "@/core/types/parsers";
import type { ParsedShapefileData } from "@/core/types/shp";
import {
  ResultsViewTab,
  type ComparisonSummary,
  type DiscrepancyFilter,
} from "@/core/types/comparison";

interface DiscrepancyGeojsonCache {
  summary: ComparisonSummary | undefined;
  fileDataset: ParsedShapefileData | ParsedFileDataset;
  activeFilter: DiscrepancyFilter;
  geojson: FeatureCollection;
}

export function useDiscrepancyMapGeojson(
  summary: ComparisonSummary | undefined,
  fileDataset: ParsedShapefileData | ParsedFileDataset,
  activeFilter: DiscrepancyFilter,
  activeViewTab: ResultsViewTab
): FeatureCollection | null {
  const isMapActive = activeViewTab === ResultsViewTab.MAP;
  const [hasActivatedMap, setHasActivatedMap] = useState<boolean>(false);
  if (isMapActive && !hasActivatedMap) {
    setHasActivatedMap(true);
  }

  const rawDiscrepancyGeojson = useDiscrepancyGeojson(summary, fileDataset, activeFilter, isMapActive);
  const [discrepancyGeojsonCache, setDiscrepancyGeojsonCache] = useState<DiscrepancyGeojsonCache | null>(null);

  if (
    rawDiscrepancyGeojson !== null &&
    (!discrepancyGeojsonCache ||
      discrepancyGeojsonCache.summary !== summary ||
      discrepancyGeojsonCache.fileDataset !== fileDataset ||
      discrepancyGeojsonCache.activeFilter !== activeFilter)
  ) {
    setDiscrepancyGeojsonCache({ summary, fileDataset, activeFilter, geojson: rawDiscrepancyGeojson });
  }

  return hasActivatedMap ? (discrepancyGeojsonCache?.geojson ?? null) : null;
}
