export const TableKind = {
  TABLE: "TABLE",
  VIEW: "VIEW",
} as const;

export type TableKind = (typeof TableKind)[keyof typeof TableKind];

export const ColumnStatus = {
  RESOLVED: "resolved",
  MISSING: "missing",
  AMBIGUOUS: "ambiguous",
} as const;

export type ColumnStatus = (typeof ColumnStatus)[keyof typeof ColumnStatus];

export interface CatalogTable {
  name: string;
  kind: TableKind;
}

export interface TableListing {
  schemaExists: boolean;
  tables: CatalogTable[];
}

export interface ResolvedColumn {
  logical: string;
  status: ColumnStatus;
  column?: string;
  dataType?: string;
  suggestion?: string;
}
