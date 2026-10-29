import { TYPE_COLUMN } from "../constants";
import { physicalColumn, qualifiedName, type TableLayout } from "./layouts";

export function buildLocalityTypeMatchSql(type: TableLayout): string {
  return [
    `SELECT count(*) AS "matches", min(${physicalColumn(type, TYPE_COLUMN.ID)}) AS "id"`,
    `FROM ${qualifiedName(type)} WHERE upper(${physicalColumn(type, TYPE_COLUMN.NAME)}) = upper($1)`,
  ].join(" ");
}
