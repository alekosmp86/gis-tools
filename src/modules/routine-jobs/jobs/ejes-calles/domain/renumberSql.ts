import { cte, q } from "../../shared/sqlFragments";
import { RENUMBER_CANDIDATE_DISTANCE_M, RENUMBER_HAUSDORFF_M, RENUMBER_SKIP_REASON } from "../constants";
import { countOf, listOf } from "./layoutSql";

/** The temp tables the real run's analysis fills: the renumbered pairs, and the skipped ones (both refs of each stay as they are). */
export interface RenumberSinks {
  renumbered: string;
  skipped: string;
}

/**
 * Renumbered pairs: a removed section and a new one of the same street with the same shape, only the `reftramo` changed.
 * The Hausdorff distance is computed only for the candidates the spatial index and the street join leave. A pair renumbers only
 * when its old `reftramo` names exactly one current section, it is the only candidate of that old and of that new `reftramo`, and
 * the new `reftramo` has exactly one kept copy. Every other candidate is skipped with its reason, and its old and new sections are
 * held: neither is removed nor inserted (`removed_rest` and `new_rest` leave them out).
 */
export function renumberCtes(): string[] {
  return [
    cte(
      "renum_cand",
      [
        "SELECT r.id AS old_id, r.ref AS old_ref, n.ref AS new_ref, r.idcalle AS idcalle, r.len AS old_len, ST_Length(n.geom) AS new_len,",
        "ST_HausdorffDistance(r.geometry, n.geom) AS hausdorff",
        `FROM ${q("removed")} AS r JOIN ${q("new_sections")} AS n ON n.idcalle = r.idcalle AND ST_DWithin(r.geometry, n.geom, ${RENUMBER_CANDIDATE_DISTANCE_M})`,
        `WHERE r.len > 0 AND r.idcalle IS NOT NULL AND r.ref IS NOT NULL AND ST_HausdorffDistance(r.geometry, n.geom) < ${RENUMBER_HAUSDORFF_M}`,
      ].join(" ")
    ),
    cte("cur_rows", `SELECT c.ref, count(*) AS rows FROM ${q("cur")} AS c GROUP BY c.ref`),
    cte(
      "renum_counted",
      [
        "SELECT c.*, COALESCE(k.rows, 0) AS old_rows, COALESCE(kc.copies, 0) AS new_copies,",
        "count(*) OVER (PARTITION BY c.old_ref) AS old_candidates, count(*) OVER (PARTITION BY c.new_ref) AS new_candidates",
        `FROM ${q("renum_cand")} AS c LEFT JOIN ${q("cur_rows")} AS k ON k.ref = c.old_ref LEFT JOIN ${q("copy_refs")} AS kc ON kc.ref = c.new_ref`,
      ].join(" ")
    ),
    cte(
      "renum_status",
      [
        "SELECT c.*, CASE",
        `WHEN c.old_rows > 1 THEN '${RENUMBER_SKIP_REASON.REPEATED_OLD_REF}'`,
        `WHEN c.old_candidates > 1 THEN '${RENUMBER_SKIP_REASON.AMBIGUOUS_OLD_REF}'`,
        `WHEN c.new_candidates > 1 THEN '${RENUMBER_SKIP_REASON.AMBIGUOUS_NEW_REF}'`,
        `WHEN c.new_copies <> 1 THEN '${RENUMBER_SKIP_REASON.NOT_SINGLE_COPY}'`,
        "END AS skip_reason",
        `FROM ${q("renum_counted")} AS c`,
      ].join(" ")
    ),
    cte(
      "renumbered",
      [
        "SELECT c.old_id, c.old_ref, c.new_ref, c.idcalle, COALESCE(ap.points, 0) AS points, c.old_len, c.new_len, c.hausdorff",
        `FROM ${q("renum_status")} AS c LEFT JOIN ${q("ap")} AS ap ON ap.ref = c.old_ref WHERE c.skip_reason IS NULL`,
      ].join(" ")
    ),
    cte(
      "renum_skipped",
      [
        "SELECT c.old_id, c.old_ref, c.new_ref, c.idcalle, COALESCE(ap.points, 0) AS points, c.skip_reason AS reason",
        `FROM ${q("renum_status")} AS c LEFT JOIN ${q("ap")} AS ap ON ap.ref = c.old_ref WHERE c.skip_reason IS NOT NULL`,
      ].join(" ")
    ),
    cte(
      "removed_rest",
      `SELECT r.* FROM ${q("removed")} AS r WHERE r.id NOT IN (SELECT old_id FROM ${q("renumbered")}) AND r.id NOT IN (SELECT old_id FROM ${q("renum_skipped")})`
    ),
    cte(
      "new_rest",
      `SELECT n.* FROM ${q("new_sections")} AS n WHERE n.ref NOT IN (SELECT new_ref FROM ${q("renumbered")}) AND n.ref NOT IN (SELECT new_ref FROM ${q("renum_skipped")})`
    ),
  ];
}

/** Data-modifying CTEs: PostgreSQL runs each to completion even though the analysis never reads it. */
export const renumberSinkCtes = (sinks: RenumberSinks): string[] => [
  cte(
    "renum_sink",
    `INSERT INTO ${sinks.renumbered} (old_id, old_ref, new_ref, points) SELECT r.old_id, r.old_ref, r.new_ref, r.points FROM ${q("renumbered")} AS r RETURNING 1`
  ),
  cte(
    "held_sink",
    `INSERT INTO ${sinks.skipped} (old_id, old_ref, new_ref, points) SELECT r.old_id, r.old_ref, r.new_ref, r.points FROM ${q("renum_skipped")} AS r RETURNING 1`
  ),
];

/** Held pairs: a repeated old `reftramo` holds one row per section it names, all with the same pair, so the pairs are counted. */
export const distinctPairsCountSql = (source: string): string =>
  `(SELECT count(*) FROM (SELECT DISTINCT p.old_ref, p.new_ref FROM ${source} AS p) AS pairs)`;

export const renumberCountColumns = (): string[] => [
  `${countOf("renumbered")} AS "renumbered"`,
  `${countOf("renumbered", "points > 0")} AS "renumbered_with_points"`,
  `(SELECT COALESCE(sum(points), 0) FROM ${q("renumbered")}) AS "renumbered_points"`,
  `${distinctPairsCountSql(q("renum_skipped"))} AS "renumber_skipped"`,
];

export const renumberListColumn = (alias: string): string =>
  listOf(
    alias,
    "renumbered_list",
    `SELECT p.old_ref AS "old_ref", p.new_ref AS "new_ref", p.idcalle AS "idcalle", p.points AS "points", p.old_len AS "old_length", p.new_len AS "new_length", p.hausdorff AS "hausdorff" FROM ${q("renumbered")} AS p ORDER BY p.points DESC, p.old_ref`
  );

export const renumberSkippedListColumn = (alias: string): string =>
  listOf(
    alias,
    "renumber_skipped_list",
    `SELECT DISTINCT p.old_ref AS "old_ref", p.new_ref AS "new_ref", p.idcalle AS "idcalle", p.points AS "points", p.reason AS "reason" FROM ${q("renum_skipped")} AS p ORDER BY p.points DESC, p.old_ref, p.new_ref`
  );
