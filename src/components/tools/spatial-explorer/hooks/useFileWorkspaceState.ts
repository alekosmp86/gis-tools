import { useState } from "react";
import type { ParsedFileDataset } from "@/core/types/parsers";
import { buildFeatureRecordIndex } from "@/core/spatial/FeatureRecordIndex";

export function useFileWorkspaceState(dataset: ParsedFileDataset) {
  const [selectedRecordIndex, setSelectedRecordIndex] = useState<number | null>(null);

  const recordsList = dataset?.recordsMap
    ? Array.from(dataset.recordsMap.values())
    : [];

  const hasGeometry = Boolean(
    dataset?.geojson &&
      dataset.geojson.features &&
      dataset.geojson.features.length > 0
  );

  const featureRecordIndex = buildFeatureRecordIndex(dataset?.geojson?.features);
  const selectedFeatureIndex =
    selectedRecordIndex === null ? null : featureRecordIndex.toFeatureIndex(selectedRecordIndex);

  const handleSelectFeature = (featureIndex: number | null) => {
    setSelectedRecordIndex(
      featureIndex === null ? null : featureRecordIndex.toRecordIndex(featureIndex)
    );
  };

  const handleSelectRecord = (recordIndex: number | null) => {
    setSelectedRecordIndex(recordIndex);
  };

  return {
    recordsList,
    hasGeometry,
    selectedRecordIndex,
    selectedFeatureIndex,
    handleSelectRecord,
    handleSelectFeature,
  };
}
