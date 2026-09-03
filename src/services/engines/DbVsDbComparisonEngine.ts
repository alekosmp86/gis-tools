import type { DbConfig } from "@/types/db";
import type { ParsedFileDataset } from "@/types/parsers";
import { FileSourceKind } from "@/types/parsers";
import {
  type ColumnMappingConfig,
  type IComparisonEngine,
  type ComparisonSummary,
} from "@/types/comparison";
import { runInWorker, serializeFileDataset } from "@/services/workerBridge";
import type { ProgressCallback } from "@/services/workerBridge";
import { DatabaseStreamReader } from "@/services/streaming/DatabaseStreamReader";

export class DbVsDbComparisonEngine implements IComparisonEngine {
  readonly engineName = "PostgreSQL DB 1 vs PostgreSQL DB 2 Comparison Engine";

  /**
   * Compares two PostgreSQL database tables (Source DB 1 vs Target DB 2).
   */
  async compareDbVsDb(
    sourceDbConfig: DbConfig,
    targetDbConfig: DbConfig,
    mappingConfig: ColumnMappingConfig,
    onProgress?: ProgressCallback
  ): Promise<ComparisonSummary> {
    // 1. Fetch Source DB 1 Records
    const sourceSuidCols =
      mappingConfig.matchedFileSuidColumns && mappingConfig.matchedFileSuidColumns.length > 0
        ? mappingConfig.matchedFileSuidColumns
        : mappingConfig.suidColumns;

    const sourceFields = this.buildSourceFields(mappingConfig, sourceSuidCols);

    const sourceMappingConfig: ColumnMappingConfig = {
      ...mappingConfig,
      suidColumns: sourceSuidCols,
      fieldsToCompare: sourceFields,
    };

    const { records: sourceRecords } = await DatabaseStreamReader.fetchOrStreamRecords(
      sourceDbConfig,
      sourceMappingConfig,
      (phase, current, total) => {
        onProgress?.(
          `[BD Origen] ${phase}`,
          current,
          total
        );
      }
    );

    // Construct ParsedFileDataset structure from Source DB 1 records
    const recordsMap = new Map<string, Record<string, unknown>>();
    sourceRecords.forEach((rec, idx) => {
      recordsMap.set(String(idx), rec);
    });

    const sourceDataset: ParsedFileDataset = {
      kind: FileSourceKind.CSV,
      fileName: `${sourceDbConfig.db_name}.${sourceDbConfig.schema_name}.${sourceDbConfig.table_name}`,
      fileSize: 0, // In-memory database recordset (no physical file size)
      featureCount: sourceRecords.length,
      attributes: sourceFields,
      recordsMap,
    };

    // 2. Fetch Target DB 2 Records
    const {
      records: targetRecords,
      columnTypes: targetColumnTypes,
      detectedSrid,
    } = await DatabaseStreamReader.fetchOrStreamRecords(
      targetDbConfig,
      mappingConfig,
      (phase, current, total) => {
        onProgress?.(
          `[BD Destino] ${phase}`,
          current,
          total
        );
      }
    );

    const finalMappingConfig: ColumnMappingConfig = {
      ...mappingConfig,
      targetSrid: mappingConfig.targetSrid ?? detectedSrid,
    };

    // 3. Serialize Source DB 1 dataset & run comparison in Web Worker
    const serializedDataset = serializeFileDataset(sourceDataset);

    return runInWorker(
      {
        dbRecords: targetRecords,
        fileDataset: serializedDataset,
        mappingConfig: finalMappingConfig,
        dbSchemaName: targetDbConfig.schema_name,
        dbTableName: targetDbConfig.table_name,
        dbColumnTypes: targetColumnTypes,
      },
      onProgress
    );
  }

  /**
   * Fallback implementation for IComparisonEngine interface.
   */
  async compare(
    targetDbConfig: DbConfig,
    sourceDataset: ParsedFileDataset,
    mappingConfig: ColumnMappingConfig,
    onProgress?: ProgressCallback
  ): Promise<ComparisonSummary> {
    const { records: targetRecords, columnTypes: targetColumnTypes } =
      await DatabaseStreamReader.fetchOrStreamRecords(
        targetDbConfig,
        mappingConfig,
        onProgress
      );

    const serializedDataset = serializeFileDataset(sourceDataset);

    return runInWorker(
      {
        dbRecords: targetRecords,
        fileDataset: serializedDataset,
        mappingConfig,
        dbSchemaName: targetDbConfig.schema_name,
        dbTableName: targetDbConfig.table_name,
        dbColumnTypes: targetColumnTypes,
      },
      onProgress
    );
  }

  /**
   * Helper method to build the list of columns to query from Source DB 1.
   */
  private buildSourceFields(
    mappingConfig: ColumnMappingConfig,
    sourceSuidCols: string[]
  ): string[] {
    const sourceFields: string[] = [];
    const sourceSet = new Set<string>();

    if (mappingConfig.attributeMap) {
      Object.values(mappingConfig.attributeMap).forEach((attrVal) => {
        if (attrVal && !sourceSet.has(attrVal)) {
          sourceFields.push(attrVal);
          sourceSet.add(attrVal);
        }
      });
    }

    if (sourceFields.length === 0 && mappingConfig.fieldsToCompare) {
      mappingConfig.fieldsToCompare.forEach((col) => {
        if (!sourceSet.has(col)) {
          sourceFields.push(col);
          sourceSet.add(col);
        }
      });
    }

    sourceSuidCols.forEach((col) => {
      if (!sourceSet.has(col)) {
        sourceFields.push(col);
        sourceSet.add(col);
      }
    });

    return sourceFields;
  }
}
