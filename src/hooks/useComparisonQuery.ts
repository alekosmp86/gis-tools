import { useQuery } from "@tanstack/react-query";
import { runDatasetComparison } from "@/services/comparisonEngine";
import type { DbConfig } from "@/types/db";
import type { ParsedShapefileData } from "@/types/shp";
import type { ColumnMappingConfig } from "@/types/gis";

export function useComparisonQuery(
  dbConfig: DbConfig,
  shapefileData: ParsedShapefileData,
  mappingConfig: ColumnMappingConfig
) {
  return useQuery({
    queryKey: [
      "datasetComparison",
      dbConfig.db_name,
      dbConfig.table_name,
      shapefileData.fileName,
      mappingConfig.suidColumn,
      mappingConfig.fieldsToCompare,
    ],
    queryFn: () => runDatasetComparison(dbConfig, shapefileData, mappingConfig),
    enabled: Boolean(dbConfig && shapefileData && mappingConfig),
  });
}
