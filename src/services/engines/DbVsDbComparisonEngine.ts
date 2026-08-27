import type { DbConfig } from "@/types/db";
import type { ColumnMappingConfig } from "@/types/gis";
import type { ParsedFileDataset } from "@/types/parsers";
import { FileSourceKind } from "@/types/parsers";
import {
  type IComparisonEngine,
  type ComparisonSummary,
} from "@/types/comparison";
import { runInWorker, serializeFileDataset } from "@/services/workerBridge";
import type { ProgressCallback } from "@/services/workerBridge";

interface DbRecordsResponse {
  records: Array<Record<string, unknown>>;
  columnTypes: Record<string, string>;
}

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
    onProgress?.("Consultando registros de la Base de Datos Origen (DB 1)...", 0, 0);

    // 1. Fetch Source DB 1 Records
    const sourceSuidCols =
      mappingConfig.matchedFileSuidColumns && mappingConfig.matchedFileSuidColumns.length > 0
        ? mappingConfig.matchedFileSuidColumns
        : mappingConfig.suidColumns;

    const sourceFields = this.buildSourceFields(mappingConfig, sourceSuidCols);

    const { records: sourceRecords } = await this.fetchDbRecords(
      sourceDbConfig,
      sourceSuidCols,
      sourceFields,
      "No se pudieron consultar los registros de la Base de Datos Origen (DB 1)."
    );

    // Construct ParsedFileDataset structure from Source DB 1 records
    const recordsMap = new Map<string, Record<string, unknown>>();
    sourceRecords.forEach((rec, idx) => {
      recordsMap.set(String(idx), rec);
    });

    const sourceDataset: ParsedFileDataset = {
      kind: FileSourceKind.CSV,
      fileName: `${sourceDbConfig.db_name}.${sourceDbConfig.schema_name}.${sourceDbConfig.table_name}`,
      fileSize: sourceRecords.length * 100,
      featureCount: sourceRecords.length,
      attributes: sourceFields,
      recordsMap,
    };

    // 2. Fetch Target DB 2 Records
    onProgress?.("Consultando registros de la Base de Datos Destino (DB 2)...", 0, 0);

    const { records: targetRecords, columnTypes: targetColumnTypes } = await this.fetchDbRecords(
      targetDbConfig,
      mappingConfig.suidColumns,
      mappingConfig.fieldsToCompare,
      "No se pudieron consultar los registros de la Base de Datos Destino (DB 2)."
    );

    // 3. Serialize Source DB 1 dataset & run comparison in Web Worker
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
   * Fallback implementation for IComparisonEngine interface.
   */
  async compare(
    targetDbConfig: DbConfig,
    sourceDataset: ParsedFileDataset,
    mappingConfig: ColumnMappingConfig,
    onProgress?: ProgressCallback
  ): Promise<ComparisonSummary> {
    onProgress?.("Consultando registros PostGIS...", 0, 0);

    const { records: targetRecords, columnTypes: targetColumnTypes } = await this.fetchDbRecords(
      targetDbConfig,
      mappingConfig.suidColumns,
      mappingConfig.fieldsToCompare,
      "No se pudieron consultar los registros de la base de datos."
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
   * Helper method to execute POST /api/db/records requests.
   */
  private async fetchDbRecords(
    dbConfig: DbConfig,
    suidColumns: string[],
    fieldsToCompare: string[],
    errorMessage: string
  ): Promise<DbRecordsResponse> {
    const res = await fetch("/api/db/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...dbConfig,
        suid_columns: suidColumns,
        fields_to_compare: fieldsToCompare,
      }),
    });

    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || errorMessage);
    }

    return {
      records: data.records || [],
      columnTypes: data.columnTypes || {},
    };
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
