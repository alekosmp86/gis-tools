import { cte, literal, q } from "../../shared/sqlFragments";
import { TWIN_PICKS_CTE } from "../constants";
import type { EjesTwinPick } from "../types";

const EMPTY_PICKS_SQL = "SELECT NULL::text AS ref, NULL::text AS department, NULL::text AS locality WHERE false";

const pickRowSql = (pick: EjesTwinPick): string => `(${literal(pick.ref)}, ${literal(pick.department)}, ${literal(pick.locality)})`;

/** The picks of the analysis as `twin_picks(ref, department, locality)`; an empty list gives no rows. */
export const twinPicksValuesCte = (picks: readonly EjesTwinPick[]): string =>
  cte(
    TWIN_PICKS_CTE,
    picks.length === 0 ? EMPTY_PICKS_SQL : `SELECT * FROM (VALUES ${picks.map(pickRowSql).join(", ")}) AS v(ref, department, locality)`
  );

/** The same `twin_picks` read from the load's temp table of the accepted picks. */
export const twinPicksTableCte = (table: string): string =>
  cte(TWIN_PICKS_CTE, `SELECT p.ref, p.department, p.locality FROM ${table} AS p`);

/** True when the pick (alias `pick`) names the copy (alias `copy`, a `copy_raw` row): same `reftramo`, department and locality. */
export const pickNamesCopySql = (pick: string, copy: string): string =>
  `${pick}.ref = ${copy}.ref AND ${pick}.department = ${copy}.departamento AND ${pick}.locality = ${copy}.localidad`;

/** The picks that name a copy of the staging. A pick that names none has no effect: the load aborts on it instead. */
export const twinPicksAppliedSql = (): string =>
  `(SELECT count(*) FROM ${q(TWIN_PICKS_CTE)} AS p WHERE EXISTS (SELECT 1 FROM ${q("copy_raw")} AS r WHERE ${pickNamesCopySql("p", "r")}))`;
