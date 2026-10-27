import { quoteIdentifier, resolveSchemaName } from "@/core/services/sqlStatements";

export interface TableLayout {
  schema: string;
  table: string;
  columns: Record<string, string>;
}

export interface WorkLayout extends TableLayout {
  srid: number;
}

export interface UnitTypeLayout {
  layout: TableLayout;
  localityType: string;
}

export interface PopulateLayouts {
  staging: TableLayout;
  work: WorkLayout;
  province: TableLayout;
  locality: TableLayout;
  unitType?: UnitTypeLayout;
}

export const qualifiedName = (layout: TableLayout): string =>
  `${quoteIdentifier(resolveSchemaName(layout.schema))}.${quoteIdentifier(layout.table)}`;

export function physicalColumn(layout: TableLayout, logical: string): string {
  const physical = layout.columns[logical];
  if (physical === undefined) {
    throw new Error(`Falta la columna resuelta "${logical}" en ${qualifiedName(layout)}.`);
  }
  return quoteIdentifier(physical);
}

export function assertTargetSrid(srid: number): void {
  if (!Number.isSafeInteger(srid) || srid <= 0) {
    throw new Error(`El SRID de destino de la tabla de trabajo no es válido: ${srid}.`);
  }
}
