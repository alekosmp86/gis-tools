import { cte, q } from "../../shared/sqlFragments";
import { EJES_SKIP_REASON, RENUMBER_SKIP_REASON } from "../constants";
import { countOf, listOf } from "./layoutSql";
import { twinPicksAppliedSql } from "./twinPickSql";

/** The `reftramo`s that keep more than one copy after the rules and the picks: the copies the load would write for them, not yet decided. */
export const twinUndecidedCte = (): string => cte("undecided", `SELECT k.ref FROM ${q("copy_refs")} AS k WHERE k.copies > 1`);

/** Held rows that wait for this `reftramo` to keep one copy: renumber pairs and splits whose hold is `not_single_copy` (exact). */
const waitingSql = (): string =>
  [
    `(SELECT count(*) FROM ${q("renum_skipped")} AS s WHERE s.new_ref = u.ref AND s.reason = '${RENUMBER_SKIP_REASON.NOT_SINGLE_COPY}')`,
    `+ (SELECT count(DISTINCT m.old_id) FROM ${q("split_members")} AS m JOIN ${q("split_groups")} AS g ON g.old_id = m.old_id`,
    `WHERE m.new_ref = u.ref AND g.hold_reason = '${EJES_SKIP_REASON.NOT_SINGLE_COPY}')`,
  ].join(" ");

export const twinUndecidedListColumn = (alias: string): string =>
  listOf(
    alias,
    "twin_undecided_list",
    [
      'SELECT u.ref AS "ref",',
      `(SELECT min(c.idcalle) FROM ${q("copy_final")} AS c WHERE c.ref = u.ref) AS "idcalle",`,
      `(SELECT min(c.nombre) FROM ${q("copy_final")} AS c WHERE c.ref = u.ref) AS "name",`,
      `(SELECT json_agg(json_build_object('department', c.departamento, 'locality', c.localidad) ORDER BY c.departamento NULLS FIRST, c.localidad NULLS FIRST) FROM ${q("copy_final")} AS c WHERE c.ref = u.ref) AS "copies",`,
      'COALESCE(ap.points, 0) AS "points",',
      `${waitingSql()} AS "waiting"`,
      `FROM ${q("undecided")} AS u LEFT JOIN ${q("ap")} AS ap ON ap.ref = u.ref ORDER BY COALESCE(ap.points, 0) DESC, u.ref`,
    ].join(" ")
  );

export const twinUndecidedCountColumns = (): string[] => [
  `${countOf("undecided")} AS "twins_undecided"`,
  `${twinPicksAppliedSql()} AS "twin_picks_applied"`,
];
