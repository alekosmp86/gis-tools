import type {
  ColumnMappingConfig,
  DiscrepancyItem,
  SqlPatchSummary,
} from "@/types/comparison";
import { DiscrepancyType } from "@/types/comparison";
import { SqlScriptBuilder } from "./SqlScriptBuilder";
import { PatchCollector } from "./PatchCollector";
import type { BinaryShpReader } from "@/utils/binary/BinaryShpReader";

export type { SqlPatchSummary };

export class SqlPatchGenerator {
  private readonly sqlBuilder: SqlScriptBuilder;
  private readonly mappingConfig: ColumnMappingConfig;
  private readonly dbSuidCols: string[];
  private readonly targetFileSuidCols: string[];
  private readonly fieldsToCompare: string[];
  private readonly fieldToFileKey: Map<string, string>;
  private readonly isBinaryDbf: boolean;
  private readonly dbColumnTypes?: Record<string, string>;
  private readonly shpReader?: BinaryShpReader | null;
  private readonly fileSrid?: number;

  constructor(
    dbSchemaName: string,
    dbTableName: string,
    mappingConfig: ColumnMappingConfig,
    dbColumnTypes?: Record<string, string>,
    isBinaryDbf: boolean = false,
    shpReader?: BinaryShpReader | null,
    fileSrid?: number
  ) {
    this.mappingConfig = mappingConfig;
    this.isBinaryDbf = isBinaryDbf;
    this.dbColumnTypes = dbColumnTypes;
    this.shpReader = shpReader;
    this.fileSrid = fileSrid;

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
    emit?: (phase: string, current: number, total: number) => void,
    collectFullScript: boolean = true
  ): SqlPatchSummary {
    const collector = new PatchCollector(25, collectFullScript);
    const totalItems = discrepancyItems.length;

    for (let index = 0; index < totalItems; index++) {
      const item = discrepancyItems[index];

      this.processItemUpdates(item, collector);
      this.processItemInsert(item, collector);

      if (index > 0 && index % 10_000 === 0 && emit) {
        emit("Generando sentencias SQL...", index, totalItems);
      }
    }

    return collector.toSummary();
  }

  private processItemUpdates(item: DiscrepancyItem, collector: PatchCollector): void {
    if (!item.dbRecord) return;
    const whereClause = this.buildWhereClause(item.dbRecord);
    if (!whereClause) return;

    this.buildAttributeUpdates(item, whereClause, collector);
    this.buildGeometryUpdate(item, whereClause, collector);
  }

  private buildAttributeUpdates(
    item: DiscrepancyItem,
    whereClause: string,
    collector: PatchCollector
  ): void {
    if (item.differences.length === 0) return;

    for (let differenceIndex = 0; differenceIndex < item.differences.length; differenceIndex++) {
      const difference = item.differences[differenceIndex];
      const updateSql = this.sqlBuilder.buildUpdateStatement(
        difference.fieldName,
        difference.shpValue,
        whereClause
      );
      collector.addUpdate(updateSql);
    }
  }

  private buildGeometryUpdate(
    item: DiscrepancyItem,
    whereClause: string,
    collector: PatchCollector
  ): void {
    const hasGeometryMismatch =
      item.type === DiscrepancyType.GEOMETRY_MISMATCH || Boolean(item.geometryDifference);

    if (!hasGeometryMismatch || !this.isBinaryDbf) return;

    const geomCol = this.resolveGeometryColumn();
    if (!geomCol) return;

    const rawGeom =
      item.fileRecordIndex != null && this.shpReader
        ? this.shpReader.readGeometry(item.fileRecordIndex, null)
        : item.shpGeometry;

    if (!rawGeom) return;

    const geomExpr = this.sqlBuilder.buildPostgisGeomExpr(rawGeom, geomCol, this.fileSrid);
    const updateSql = this.sqlBuilder.buildUpdateStatementRaw(geomCol, geomExpr, whereClause);
    collector.addUpdate(updateSql);
  }

  private processItemInsert(item: DiscrepancyItem, collector: PatchCollector): void {
    if (item.type !== DiscrepancyType.ONLY_IN_SHP || !item.shpFeatureProps) return;

    const fileRec = item.shpFeatureProps;
    const insertCols: string[] = [];
    const insertVals: string[] = [];
    const addedCols = new Set<string>();

    // 1. SUID Columns
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

    // 2. Attributes mapped in fieldsToCompare
    this.fieldsToCompare.forEach((field) => {
      if (addedCols.has(field)) return;
      const fileKey = this.fieldToFileKey.get(field);
      if (fileKey != null && fileRec[fileKey] !== undefined) {
        insertCols.push(`"${field}"`);
        insertVals.push(this.sqlBuilder.formatSqlValue(fileRec[fileKey], field));
        addedCols.add(field);
      }
    });

    // 3. Geometry column injection strictly if mapped or if native Shapefile
    if (item.shpGeometry || item.fileRecordIndex != null) {
      const geomCol = this.resolveGeometryColumn();
      if (geomCol && this.isGeometryInsertionRequested(geomCol) && !addedCols.has(geomCol)) {
        insertCols.push(`"${geomCol}"`);
        const rawGeom =
          item.fileRecordIndex != null && this.shpReader
            ? this.shpReader.readGeometry(item.fileRecordIndex, null)
            : item.shpGeometry;
        insertVals.push(this.sqlBuilder.buildPostgisGeomExpr(rawGeom, geomCol, this.fileSrid));
        addedCols.add(geomCol);
      }
    }

    // 4. Insert Defaults
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
    collector.addInsert(insertSql);
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
    if (this.dbColumnTypes) {
      const geoCol = Object.keys(this.dbColumnTypes).find((col) => {
        const dt = this.dbColumnTypes![col].toLowerCase();
        return dt.includes("geometry") || dt.includes("geography") || dt.includes("user-defined");
      });
      if (geoCol) return geoCol;
    }
    const candidateColumns = ["geom", "geometry", "the_geom", "shape"];
    return candidateColumns.find((col) => this.isGeometryInsertionRequested(col));
  }
}
