import { physicalColumn, qualifiedName } from "../../actualizar-padron/domain/layouts";
import { DETAIL_LIST_LIMIT } from "../../shared/limits";
import { jsonArrayOf, q } from "../../shared/sqlFragments";
import { EJES_TABLE_ROLE } from "../constants";
import type { EjesLayouts } from "../types";

export type RoleName = keyof typeof EJES_TABLE_ROLE;

export const col = (layouts: EjesLayouts, role: RoleName, logical: string): string =>
  physicalColumn(layouts[EJES_TABLE_ROLE[role]], logical);

export const table = (layouts: EjesLayouts, role: RoleName): string => qualifiedName(layouts[EJES_TABLE_ROLE[role]]);

/** The table of a role as the analysis reads it: only the rows of the department scope when the run has one, the whole table otherwise. Use it as `FROM ${...} AS alias`. */
export const scopedTable = (layouts: EjesLayouts, role: RoleName): string => {
  const layout = layouts[EJES_TABLE_ROLE[role]];
  return layout.scopeWhere === undefined ? qualifiedName(layout) : `(SELECT * FROM ${qualifiedName(layout)} WHERE ${layout.scopeWhere})`;
};

export const trimmed = (expression: string): string => `NULLIF(btrim(${expression}::text), '')`;

const limited = (select: string): string => `${select} LIMIT ${DETAIL_LIST_LIMIT}`;

export const countOf = (source: string, condition = "true"): string => `(SELECT count(*) FROM ${q(source)} WHERE ${condition})`;

export const listOf = (alias: string, name: string, select: string): string =>
  `${jsonArrayOf(limited(select), name)} AS ${q(alias)}`;
