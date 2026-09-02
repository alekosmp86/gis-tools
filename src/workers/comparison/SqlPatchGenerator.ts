import type {
  ColumnMappingConfig,
  DiscrepancyItem,
} from "@/types/comparison";
import { DiscrepancyType } from "@/types/comparison";
import { SqlScriptBuilder } from "./SqlScriptBuilder";

export interface SqlPatchSummary {
  sqlUpdateScript: string;
  sqlInsertScript: string;
  sqlUpdateCount: number;
  sqlInsertCount: number;
  sqlUpdatePreview: string;
  sqlInsertPreview: string;
}

export class SqlPatchGenerator {
  private readonly sqlBuilder: SqlScriptBuilder;
  private readonly mappingConfig: ColumnMappingConfig;
  private readonly dbSuidCols: string[];
  private readonly targetFileSuidCols: string[];
  private readonly fieldsToCompare: string[];
  private readonly fieldToFileKey: Map<string, string>;
  private readonly isBinaryDbf: boolean;

  constructor(
    dbSchemaName: string,
    dbTableName: string,
    mappingConfig: ColumnMappingConfig,
    dbColumnTypes?: Record<string, string>,
    isBinaryDbf: boolean = false
  ) {
    this.mappingConfig = mappingConfig;
    this.isBinaryDbf = isBinaryDbf;
    this.sqlBuilder = new SqlScriptBuilder(
      dbSchemaName,
      dbTableName,
      dbColumnTypes,
      mappingConfig.targetSrid
    );

    this.dbSuidCols = mappingConfig.suidColumns;
    this.targetFileSuidCols =
      mappingConfig.matchedFileSuidColumns && mappingConfig.matchedFileSuidColumns.length > 0
        ? mappingConfig.matchedFileSuidColumns
        : this.dbSuidCols;

    this.fieldsToCompare = mappingConfig.fieldsToCompare;
    const attributeMap = mappingConfig.attributeMap || {};

    this.fieldToFileKey = new Map<string, string>();
    this.fieldsToCompare.forEach((field) => {
      const mapped = attributeMap[field] || field;
      this.fieldToFileKey.set(field, mapped);
    });
  }

  /**
   * Generates SQL UPDATE and INSERT sync patches from analyzed discrepancy items.
   */
  public generatePatches(
    discrepancyItems: DiscrepancyItem[],
    emit?: (phase: string, current: number, total: number) => void
  ): SqlPatchSummary {
    const maxPreviewLimit = 500;
    const updateStatements: string[] = [];
    const insertStatements: string[] = [];
    const updatePreviewStatements: string[] = [];
    const insertPreviewStatements: string[] = [];

    let sqlUpdateCount = 0;
    let sqlInsertCount = 0;

    const totalItems = discrepancyItems.length;

    for (let index = 0; index < totalItems; index++) {
      const item = discrepancyItems[index];

      // 1. Generate UPDATE statements for ATTRIBUTE_MISMATCH items
      if (item.type === DiscrepancyType.ATTRIBUTE_MISMATCH && item.dbRecord && item.differences.length > 0) {
        const whereClause = this.buildWhereClause(item.dbRecord);
        if (whereClause) {
          for (let differenceIndex = 0; differenceIndex < item.differences.length; differenceIndex++) {
            const difference = item.differences[differenceIndex];
            const updateSql = this.sqlBuilder.buildUpdateStatement(
              difference.fieldName,
              difference.shpValue,
              whereClause
            );
            sqlUpdateCount++;
            if (updatePreviewStatements.length < maxPreviewLimit) {
              updatePreviewStatements.push(updateSql);
            }
            updateStatements.push(updateSql);
          }
        }
      }

      // 2. Generate INSERT statements for ONLY_IN_SHP items
      if (item.type === DiscrepancyType.ONLY_IN_SHP && item.shpFeatureProps) {
        const fileRec = item.shpFeatureProps;
        const insertCols: string[] = [];
        const insertVals: string[] = [];
        const addedCols = new Set<string>();

        // SUID Columns
        this.dbSuidCols.forEach((col, columnIndex) => {
          const targetCol =
            this.targetFileSuidCols.length > 0
              ? this.targetFileSuidCols[columnIndex] || this.targetFileSuidCols[0]
              : undefined;
          const val = targetCol ? fileRec[targetCol] ?? fileRec[col] : fileRec[col];
          insertCols.push(`"${col}"`);
          insertVals.push(this.sqlBuilder.formatSqlValue(val, col));
          addedCols.add(col);
        });

        // Attributes mapped in fieldsToCompare
        this.fieldsToCompare.forEach((field) => {
          if (addedCols.has(field)) return;
          const fileKey = this.fieldToFileKey.get(field);
          if (fileKey != null && fileRec[fileKey] !== undefined) {
            insertCols.push(`"${field}"`);
            insertVals.push(this.sqlBuilder.formatSqlValue(fileRec[fileKey], field));
            addedCols.add(field);
          }
        });

        // Geometry column injection strictly if mapped or if native Shapefile
        if (item.shpGeometry) {
          const geomCol = this.resolveGeometryColumn();
          if (geomCol && this.isGeometryInsertionRequested(geomCol) && !addedCols.has(geomCol)) {
            insertCols.push(`"${geomCol}"`);
            insertVals.push(this.sqlBuilder.buildPostgisGeomExpr(item.shpGeometry));
            addedCols.add(geomCol);
          }
        }

        // Insert Defaults
        if (this.mappingConfig.insertDefaults) {
          Object.entries(this.mappingConfig.insertDefaults).forEach(([fieldName, defaultConfig]) => {
            if (addedCols.has(fieldName)) return;
            if (defaultConfig.value && defaultConfig.value.trim() !== "") {
              insertCols.push(`"${fieldName}"`);
              if (defaultConfig.useRawExpression) {
                insertVals.push(defaultConfig.value.trim());
              } else {
                insertVals.push(this.sqlBuilder.formatSqlValue(defaultConfig.value, fieldName));
              }
              addedCols.add(fieldName);
            }
          });
        }

        const insertSql = this.sqlBuilder.buildInsertStatement(insertCols, insertVals);
        sqlInsertCount++;
        if (insertPreviewStatements.length < maxPreviewLimit) {
          insertPreviewStatements.push(insertSql);
        }
        insertStatements.push(insertSql);
      }

      if (index > 0 && index % 10_000 === 0 && emit) {
        emit("Generando sentencias SQL...", index, totalItems);
      }
    }

    const sqlUpdateScript = updateStatements.join("\n");
    const sqlInsertScript = insertStatements.join("\n");
    const sqlUpdatePreview = updatePreviewStatements.join("\n");
    const sqlInsertPreview = insertPreviewStatements.join("\n");

    return {
      sqlUpdateScript,
      sqlInsertScript,
      sqlUpdateCount,
      sqlInsertCount,
      sqlUpdatePreview,
      sqlInsertPreview,
    };
  }

  private buildWhereClause(dbRecord: Record<string, unknown>): string {
    const conditions = this.dbSuidCols.map((col) =>
      this.sqlBuilder.formatWhereCondition(col, dbRecord[col])
    );
    return conditions.join(" AND ");
  }

  private isGeometryInsertionRequested(geomColumnName: string): boolean {
    if (this.isBinaryDbf) return true;
    return this.fieldsToCompare.includes(geomColumnName);
  }

  private resolveGeometryColumn(): string | undefined {
    // Only resolve PostGIS geometry column if it was explicitly selected in fieldsToCompare (or native Shapefile)
    const candidateColumns = ["geom", "geometry", "the_geom", "shape"];
    return candidateColumns.find((col) => this.isGeometryInsertionRequested(col));
  }
}
