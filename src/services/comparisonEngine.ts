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
  shapefileData: ParsedShapefileData | ParsedFileDataset,
  mappingConfig: ColumnMappingConfig
): Promise<ComparisonSummary> {
  const engine = new DbVsFileComparisonEngine();

  const dataset: ParsedFileDataset =
    "recordsMap" in shapefileData
      ? shapefileData
      : {
          fileName: shapefileData.fileName,
          fileSize: shapefileData.fileSize,
          featureCount: shapefileData.featureCount,
          geometryType: shapefileData.geometryType,
          attributes: shapefileData.attributes,
          recordsMap: new Map(),
          geojson: shapefileData.geojson,
        };

  return engine.compare(dbConfig, dataset, mappingConfig);
}
