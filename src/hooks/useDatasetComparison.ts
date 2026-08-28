import { useQuery, useIsMutating } from "@tanstack/react-query";
import { useComparisonProgress } from "./useComparisonProgress";
import { DbVsFileComparisonEngine } from "@/services/engines/DbVsFileComparisonEngine";
import { DbVsDbComparisonEngine } from "@/services/engines/DbVsDbComparisonEngine";
import type { DbConfig } from "@/types/db";
import type { ParsedShapefileData } from "@/types/shp";
import type { ParsedFileDataset } from "@/types/parsers";
import type { ColumnMappingConfig, ComparisonSummary, ComparisonProgress } from "@/types/comparison";

export interface UseDatasetComparisonParams {
  dbConfig: DbConfig;
  fileDataset: ParsedShapefileData | ParsedFileDataset;
  mappingConfig: ColumnMappingConfig;
  sourceDbConfig?: DbConfig;
}

export interface UseDatasetComparisonResult {
  summary: ComparisonSummary | undefined;
  loading: boolean;
  isFetching: boolean;
  isReanalyzing: boolean;
  isExecuting: boolean;
  isBusy: boolean;
  customNotice?: string;
  error: Error | null;
  progress: ComparisonProgress;
}

/**
 * Custom Hook encapsulating dataset comparison state, engine factory selection,
 * background execution status tracking via React Query mutation keys,
 * progress tracking, and React Query execution off the UI component layer.
 */
export function useDatasetComparison({
  dbConfig,
  fileDataset,
  mappingConfig,
  sourceDbConfig,
}: UseDatasetComparisonParams): UseDatasetComparisonResult {
  const { progress, onProgress, resetProgress } = useComparisonProgress();

  const suidLabel = mappingConfig?.suidColumns ? mappingConfig.suidColumns.join(" + ") : "";

  const { data: summary, isLoading: loading, isFetching, error } = useQuery({
    queryKey: [
      "datasetComparison",
      sourceDbConfig ? sourceDbConfig.db_name : "",
      sourceDbConfig ? sourceDbConfig.table_name : "",
      dbConfig.db_name,
      dbConfig.table_name,
      fileDataset.fileName,
      suidLabel,
      mappingConfig.fieldsToCompare,
    ],
    queryFn: () => {
      resetProgress();
      if (sourceDbConfig) {
        const engine = new DbVsDbComparisonEngine();
        return engine.compareDbVsDb(sourceDbConfig, dbConfig, mappingConfig, onProgress);
      }
      const dataset: ParsedFileDataset =
        "recordsMap" in fileDataset
          ? fileDataset
          : {
              kind: fileDataset.kind,
              fileName: fileDataset.fileName,
              fileSize: fileDataset.fileSize,
              featureCount: fileDataset.featureCount,
              geometryType: fileDataset.geometryType,
              attributes: fileDataset.attributes,
              recordsMap: new Map(),
              geojson: fileDataset.geojson,
            };
      const engine = new DbVsFileComparisonEngine();
      return engine.compare(dbConfig, dataset, mappingConfig, onProgress);
    },
    enabled: Boolean(dbConfig && fileDataset && mappingConfig),
  });

  const isExecuting = useIsMutating({ mutationKey: ["executeSql"] }) > 0;
  const isReanalyzing = Boolean(isFetching && !loading);
  const isBusy = isExecuting || isReanalyzing;

  const customNotice = isExecuting
    ? "Ejecutando sentencias SQL en la base de datos PostgreSQL en segundo plano..."
    : undefined;

  return {
    summary,
    loading,
    isFetching,
    isReanalyzing,
    isExecuting,
    isBusy,
    customNotice,
    error: error instanceof Error ? error : null,
    progress,
  };
}
