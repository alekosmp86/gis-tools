import type { DbConfig } from "@/types/db";
import type { ColumnMappingConfig } from "@/types/gis";
import type { ParsedFileDataset } from "@/types/parsers";
import {
  type IComparisonEngine,
  type ComparisonSummary,
} from "@/types/comparison";
import { runInWorker, serializeFileDataset } from "@/services/workerBridge";
import type { ProgressCallback } from "@/services/workerBridge";

export class DbVsFileComparisonEngine implements IComparisonEngine {
  readonly engineName = "PostgreSQL vs Tabular File Comparison Engine";

  private progressCallback?: ProgressCallback;

  /**
   * Sets an optional progress callback to receive phase updates from the worker.
   * Must be called before compare() to receive progress events.
   */
  setProgressCallback(cb: ProgressCallback): this {
    this.progressCallback = cb;
    return this;
  }

  async compare(
    dbConfig: DbConfig,
    dataset: ParsedFileDataset,
    mappingConfig: ColumnMappingConfig
  ): Promise<ComparisonSummary> {
    // 1. Fetch DB Records from API route
    const res = await fetch("/api/db/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...dbConfig,
        suid_columns: mappingConfig.suidColumns,
        fields_to_compare: mappingConfig.fieldsToCompare,
      }),
    });

    const dbData = await res.json();
    if (!res.ok || !dbData.success) {
      throw new Error(
        dbData.error || "No se pudieron consultar los registros de la base de datos."
      );
    }

    const dbRecords: Array<Record<string, unknown>> = dbData.records || [];
    const dbColumnTypes: Record<string, string> = dbData.columnTypes || {};

    // 2. Serialize dataset for postMessage (Map -> plain object)
    const serializedDataset = serializeFileDataset(dataset);

    // 3. Offload CPU-intensive work to Web Worker
    return runInWorker(
      {
        dbRecords,
        fileDataset: serializedDataset,
        mappingConfig,
        dbSchemaName: dbConfig.schema_name,
        dbTableName: dbConfig.table_name,
        dbColumnTypes,
      },
      this.progressCallback
    );
  }
}
