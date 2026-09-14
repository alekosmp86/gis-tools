import { useState } from "react";
import type { DbConfig } from "@/core/types/db";
import { buildFeatureRecordIndex } from "@/core/spatial/FeatureRecordIndex";
import { useDbTableViewerState } from "./useDbTableViewerState";

export function useDbWorkspaceState(config: DbConfig, columns: string[], totalRows: number) {
  const [selectedRecordIndex, setSelectedRecordIndex] = useState<number | null>(null);

  const {
    records,
    geojson,
    detectedGeometryType,
    detectedSrid,
    progressText,
    isPending,
    isError,
    error,
  } = useDbTableViewerState(config, columns, totalRows);

  const hasGeometry = Boolean(geojson && geojson.features && geojson.features.length > 0);
  const featureRecordIndex = buildFeatureRecordIndex(geojson?.features);
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
    records,
    geojson,
    detectedGeometryType,
    detectedSrid,
    progressText,
    isPending,
    isError,
    error,
    hasGeometry,
    selectedRecordIndex,
    selectedFeatureIndex,
    handleSelectRecord,
    handleSelectFeature,
  };
}
