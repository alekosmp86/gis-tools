import { useQuery } from "@tanstack/react-query";
import { runDatasetComparison } from "@/services/comparisonEngine";
import type { DbConfig } from "@/types/db";
import type { ParsedShapefileData } from "@/types/shp";
import type { ColumnMappingConfig } from "@/types/gis";
import type { ParsedFileDataset } from "@/types/parsers";

export function useComparisonQuery(
  dbConfig: DbConfig,
  fileDataset: ParsedShapefileData | ParsedFileDataset,
  mappingConfig: ColumnMappingConfig
) {
  return useQuery({
    queryKey: [
      "datasetComparison",
      dbConfig.db_name,
      dbConfig.table_name,
      fileDataset.fileName,
      mappingConfig.suidColumn,
      mappingConfig.fieldsToCompare,
    ],
    queryFn: () => runDatasetComparison(dbConfig, fileDataset, mappingConfig),
    enabled: Boolean(dbConfig && fileDataset && mappingConfig),
  });
}
