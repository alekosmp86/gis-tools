import { literal, q } from "../../shared/sqlFragments";

export type TypedColumn = readonly [name: string, sqlType: string];
export type TypedCell = string | number | null;

const integerLiteral = (value: number): string => {
  if (!Number.isSafeInteger(value)) throw new Error(`Un valor de la lista no es un entero: ${value}`);
  return String(value);
};

const cellSql = (value: TypedCell, sqlType: string): string => {
  const rendered = value === null ? "NULL" : typeof value === "number" ? integerLiteral(value) : literal(value);
  return `CAST(${rendered} AS ${sqlType})`;
};

const rowSql = (columns: readonly TypedColumn[], cells: readonly TypedCell[]): string =>
  `(${cells.map((value, index) => cellSql(value, columns[index][1])).join(", ")})`;

function emptyValuesSql(columns: readonly TypedColumn[]): string {
  const typedNulls = columns.map(([name, sqlType]) => `CAST(NULL AS ${sqlType}) AS ${q(name)}`);
  return `SELECT ${typedNulls.join(", ")} WHERE false`;
}

/** A CTE body of typed literal rows: text is escaped by literal(), integers are validated; no rows gives an empty set of the same shape. */
export function typedValuesSql(columns: readonly TypedColumn[], rows: readonly (readonly TypedCell[])[], alias: string): string {
  if (rows.length === 0) return emptyValuesSql(columns);
  const columnNames = columns.map(([name]) => q(name)).join(", ");
  return `SELECT * FROM (VALUES ${rows.map((cells) => rowSql(columns, cells)).join(", ")}) AS ${q(alias)}(${columnNames})`;
}
