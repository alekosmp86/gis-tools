import { cte, literal, q } from "../../shared/sqlFragments";
import { MANUAL_SPLIT_REASON, MANUAL_SPLITS_CTE, PIECE_COVER_TOLERANCE_M } from "../constants";
import type { EjesManualSplit } from "../types";
import { countOf, listOf } from "./layoutSql";

/** The CTEs a manual split reads or writes (see `manualSplitCtes`). `COVER` feeds the splits; `PIECES_ON_OLD` feeds the split points too. */
export const MANUAL_CTE = {
  OLD: "manual_old",
  AVAILABLE: "manual_available",
  GROUPS: "manual_groups",
  PIECES: "manual_pieces",
  PIECES_ON_OLD: "manual_pieces_on_old",
  COVER: "manual_cover",
} as const;

const EMPTY_MANUAL_SQL = "SELECT NULL::text AS old_ref, NULL::text AS new_ref WHERE false";

const manualRowSql = (group: EjesManualSplit): string[] =>
  group.newRefs.map((newRef) => `(${literal(group.oldRef)}, ${literal(newRef)})`);

/** The manual splits as `manual_splits(old_ref, new_ref)`, one row per listed piece; an empty list gives no rows. */
export const manualSplitsValuesCte = (groups: readonly EjesManualSplit[]): string =>
  cte(
    MANUAL_SPLITS_CTE,
    groups.length === 0 ? EMPTY_MANUAL_SQL : `SELECT * FROM (VALUES ${groups.flatMap(manualRowSql).join(", ")}) AS v(old_ref, new_ref)`
  );

/**
 * The manual splits the analysis applies (EJS-22). A group applies when its old `reftramo` is a removed section that is not renumbered
 * (`removed_rest`) and every listed piece is an available new section (`new_rest`, one kept copy); otherwise the whole group is ignored
 * (`manual_groups`). An applied group forces its old section to exactly its listed pieces: `manual_cover` is one row per such section, with
 * the lengths read from the geometries, and it replaces the automatic row of that section in `splits`. Every hold of the splits applies to it.
 */
export function manualSplitCtes(): string[] {
  const tolerance = PIECE_COVER_TOLERANCE_M;
  return [
    cte(
      MANUAL_CTE.OLD,
      `SELECT r.id, r.ref, r.idcalle, r.len, r.geometry FROM ${q("removed_rest")} AS r JOIN (SELECT DISTINCT m.old_ref FROM ${q(MANUAL_SPLITS_CTE)} AS m) AS g ON g.old_ref = r.ref WHERE r.len > 0`
    ),
    cte(
      MANUAL_CTE.AVAILABLE,
      `SELECT m.old_ref, m.new_ref, n.geom FROM ${q(MANUAL_SPLITS_CTE)} AS m JOIN ${q("new_rest")} AS n ON n.ref = m.new_ref JOIN ${q("single_copy_refs")} AS k ON k.ref = m.new_ref`
    ),
    cte(
      MANUAL_CTE.GROUPS,
      [
        "SELECT g.old_ref, (o.ref IS NOT NULL AND COALESCE(a.available, 0) = g.listed) AS valid, CASE",
        `WHEN o.ref IS NULL THEN '${MANUAL_SPLIT_REASON.NOT_REMOVED}'`,
        `WHEN COALESCE(a.available, 0) <> g.listed THEN '${MANUAL_SPLIT_REASON.PIECE_UNAVAILABLE}'`,
        "END AS reason",
        `FROM (SELECT m.old_ref, count(*) AS listed FROM ${q(MANUAL_SPLITS_CTE)} AS m GROUP BY m.old_ref) AS g`,
        `LEFT JOIN (SELECT v.old_ref, count(*) AS available FROM ${q(MANUAL_CTE.AVAILABLE)} AS v GROUP BY v.old_ref) AS a ON a.old_ref = g.old_ref`,
        `LEFT JOIN (SELECT DISTINCT x.ref FROM ${q(MANUAL_CTE.OLD)} AS x) AS o ON o.ref = g.old_ref`,
      ].join(" ")
    ),
    cte(
      MANUAL_CTE.PIECES,
      `SELECT v.old_ref, v.new_ref, v.geom FROM ${q(MANUAL_CTE.AVAILABLE)} AS v JOIN ${q(MANUAL_CTE.GROUPS)} AS g ON g.old_ref = v.old_ref WHERE g.valid`
    ),
    cte(
      MANUAL_CTE.PIECES_ON_OLD,
      `SELECT r.id, r.ref, r.idcalle, r.len, r.geometry, p.new_ref, p.geom FROM ${q(MANUAL_CTE.OLD)} AS r JOIN ${q(MANUAL_CTE.PIECES)} AS p ON p.old_ref = r.ref`
    ),
    cte(
      MANUAL_CTE.COVER,
      [
        "SELECT p.id, p.ref, p.idcalle, p.len, count(p.new_ref) AS new_count,",
        `ST_Length(ST_Intersection(p.geometry, ST_Buffer(ST_Collect(p.geom), ${tolerance}))) AS covered,`,
        "array_agg(p.new_ref ORDER BY p.new_ref) AS new_refs,",
        "ST_Length(ST_Union(p.geom)) AS new_len,",
        `ST_Length(ST_Difference(ST_Union(p.geom), ST_Buffer(p.geometry, ${tolerance}))) AS outside_len`,
        `FROM ${q(MANUAL_CTE.PIECES_ON_OLD)} AS p GROUP BY p.id, p.ref, p.idcalle, p.len, p.geometry`,
      ].join(" ")
    ),
  ];
}

/** The applied-or-ignored counts of the manual splits (`manual_groups`). */
export const manualCountColumns = (): string[] => [
  `${countOf(MANUAL_CTE.GROUPS, "valid")} AS "manual_splits_applied"`,
  `${countOf(MANUAL_CTE.GROUPS, "NOT valid")} AS "manual_splits_ignored"`,
];

/** The ignored manual splits: the old `reftramo` and the reason, ordered by `reftramo`. */
export const manualIgnoredListColumn = (alias: string): string =>
  listOf(
    alias,
    "manual_splits_ignored_list",
    `SELECT g.old_ref AS "old_ref", g.reason AS "reason" FROM ${q(MANUAL_CTE.GROUPS)} AS g WHERE NOT g.valid ORDER BY g.old_ref`
  );
