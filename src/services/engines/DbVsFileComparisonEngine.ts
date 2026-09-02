import type { DbConfig } from "@/types/db";
import type { ParsedFileDataset } from "@/types/parsers";
import {
  type ColumnMappingConfig,
  type IComparisonEngine,
  type ComparisonSummary,
} from "@/types/comparison";
import { runInWorker, serializeFileDataset } from "@/services/workerBridge";
import type { ProgressCallback } from "@/services/workerBridge";
import { DatabaseStreamReader } from "@/services/streaming/DatabaseStreamReader";

export class DbVsFileComparisonEngine implements IComparisonEngine {
  readonly engineName = "PostgreSQL vs Tabular File Comparison Engine";

  async compare(
    dbConfig: DbConfig,
    dataset: ParsedFileDataset,
    mappingConfig: ColumnMappingConfig,
    onProgress?: ProgressCallback
  ): Promise<ComparisonSummary> {
    // 1. Fetch or Stream DB Records progressively with real-time progress updates
    const {
      records: dbRecords,
      columnTypes: dbColumnTypes,
      detectedSrid,
    } = await DatabaseStreamReader.fetchOrStreamRecords(dbConfig, mappingConfig, onProgress);

    const finalMappingConfig: ColumnMappingConfig = {
      ...mappingConfig,
      targetSrid: mappingConfig.targetSrid ?? detectedSrid,
    };

    // 2. Serialize dataset for postMessage (Map -> plain object)
    const serializedDataset = serializeFileDataset(dataset);

    // 3. Offload CPU-intensive comparison to Web Worker
    return runInWorker(
      {
        dbRecords,
        fileDataset: serializedDataset,
        mappingConfig: finalMappingConfig,
        dbSchemaName: dbConfig.schema_name,
        dbTableName: dbConfig.table_name,
        dbColumnTypes,
      },
      onProgress
    );
  }
}
