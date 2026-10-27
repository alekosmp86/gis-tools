import { TYPE_COLUMN } from "../constants";
import { physicalColumn, qualifiedName, type UnitTypeLayout } from "./layouts";

const textLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const typeColumns = ({ layout }: UnitTypeLayout): { id: string; name: string; table: string } => ({
  id: physicalColumn(layout, TYPE_COLUMN.ID),
  name: physicalColumn(layout, TYPE_COLUMN.NAME),
  table: qualifiedName(layout),
});

export function buildUnitTypeMatchSql(unitType: UnitTypeLayout): string {
  const { id, name, table } = typeColumns(unitType);
  return `SELECT ${id} AS "id" FROM ${table} WHERE upper(${name}) = upper($1)`;
}

export function unitTypeIdSubquery(unitType: UnitTypeLayout): string {
  const { id, name, table } = typeColumns(unitType);
  return `(SELECT ${id} FROM ${table} WHERE upper(${name}) = upper(${textLiteral(unitType.localityType)}))`;
}
