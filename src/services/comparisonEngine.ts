import type { DbConfig } from "@/types/db";
import type { ParsedShapefileData } from "@/types/shp";
import type { ColumnMappingConfig } from "@/types/gis";
import type { ComparisonSummary } from "@/types/comparison";
import type { ParsedFileDataset } from "@/types/parsers";
import { DbVsFileComparisonEngine } from "@/services/engines/DbVsFileComparisonEngine";

export { cleanSuid, cleanValue } from "@/utils/gisCleaners";

/**
 * Main comparison entry point delegating to DbVsFileComparisonEngine strategy.
 */
export async function runDatasetComparison(
  dbConfig: DbConfig,
  fileDataset: ParsedShapefileData | ParsedFileDataset,
  mappingConfig: ColumnMappingConfig
): Promise<ComparisonSummary> {
  const engine = new DbVsFileComparisonEngine();

  const dataset: ParsedFileDataset =
    "recordsMap" in fileDataset
      ? fileDataset
      : {
          fileName: fileDataset.fileName,
          fileSize: fileDataset.fileSize,
          featureCount: fileDataset.featureCount,
          geometryType: fileDataset.geometryType,
          attributes: fileDataset.attributes,
          recordsMap: new Map(),
          geojson: fileDataset.geojson,
        };

  return engine.compare(dbConfig, dataset, mappingConfig);
}
