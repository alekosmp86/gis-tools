import { cte, q } from "../../shared/sqlFragments";
import { GEO_TWIN_ROLE, RENUMBER_CANDIDATE_DISTANCE_M, RENUMBER_HAUSDORFF_M, RENUMBER_SKIP_REASON } from "../constants";
import { countOf, listOf } from "./layoutSql";

/** The temp tables the real run's analysis fills: the renumbered pairs, and the skipped ones (both refs of each stay as they are). */
export interface RenumberSinks {
  renumbered: string;
  skipped: string;
  dropped: string;
}

/**
 * The candidate pairs of the renumber, pruned to one per old section (EJL-27): a removed section and a new one of the same street within
 * `RENUMBER_HAUSDORFF_M`. The best candidate of an old section is the smallest Hausdorff distance, then the lowest numeric `reftramo`.
 * `raw_candidates` counts the candidates before the pruning. The losing candidates are decided by `renumberOutcomeCtes`.
 */
export function renumberPruneCtes(): string[] {
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
    cte(
      "renum_ranked",
      [
        "SELECT c.*, count(*) OVER (PARTITION BY c.old_id) AS raw_candidates,",
        "row_number() OVER (PARTITION BY c.old_id ORDER BY c.hausdorff, CAST(c.new_ref AS numeric)) AS candidate_rank",
        `FROM ${q("renum_cand")} AS c`,
      ].join(" ")
    ),
    cte("renum_best", `SELECT c.* FROM ${q("renum_ranked")} AS c WHERE c.candidate_rank = 1`),
  ];
}

/**
 * The decisions behind the renumber, before the copies are counted (`copyFinalCte` reads `renum_dropped`). Each old section is judged
 * through its best candidate (`renum_status`): the pair renumbers only when no reason holds it. A losing candidate is dropped only when
 * its old section's best pair renumbers, no best pair takes its `reftramo`, it holds no access points and it is not a geometric twin
 * winner. Otherwise it is held (`renum_held_extra`) with the best pair's reason, or `CANDIDATE_HAS_POINTS`. A twin winner is never
 * dropped nor held: it stays a new section.
 */
export function renumberOutcomeCtes(): string[] {
  return [
    cte("cur_rows", `SELECT c.ref, count(*) AS rows FROM ${q("cur")} AS c GROUP BY c.ref`),
    cte(
      "copy_pre_refs",
      `SELECT k.ref, count(*) AS copies FROM ${q("copy_kept")} AS k WHERE NOT EXISTS (SELECT 1 FROM ${q("geo_losers")} AS l WHERE l.ref = k.ref) GROUP BY k.ref`
    ),
    cte(
      "renum_counted",
      [
        "SELECT c.*, COALESCE(k.rows, 0) AS old_rows, COALESCE(kc.copies, 0) AS new_copies,",
        "count(*) OVER (PARTITION BY c.old_ref) AS old_candidates, count(*) OVER (PARTITION BY c.new_ref) AS new_candidates",
        `FROM ${q("renum_best")} AS c LEFT JOIN ${q("cur_rows")} AS k ON k.ref = c.old_ref LEFT JOIN ${q("copy_pre_refs")} AS kc ON kc.ref = c.new_ref`,
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
    cte("renum_winners", `SELECT r.ref FROM ${q("geo_roles")} AS r WHERE r.role = '${GEO_TWIN_ROLE.WINNER}'`),
    cte(
      "renum_losers",
      [
        "SELECT c.old_id, c.old_ref, c.new_ref, c.idcalle, c.hausdorff, COALESCE(oap.points, 0) AS points, COALESCE(nap.points, 0) AS new_points, s.skip_reason,",
        `c.new_ref IN (SELECT b.new_ref FROM ${q("renum_best")} AS b) AS is_best_new, c.new_ref IN (SELECT w.ref FROM ${q("renum_winners")} AS w) AS is_winner`,
        `FROM ${q("renum_ranked")} AS c JOIN ${q("renum_status")} AS s ON s.old_id = c.old_id`,
        `LEFT JOIN ${q("ap")} AS oap ON oap.ref = c.old_ref LEFT JOIN ${q("ap")} AS nap ON nap.ref = c.new_ref WHERE c.candidate_rank > 1`,
      ].join(" ")
    ),
    cte(
      "renum_held_extra",
      [
        `SELECT l.old_id, l.old_ref, l.new_ref, l.idcalle, l.points, COALESCE(l.skip_reason, '${RENUMBER_SKIP_REASON.CANDIDATE_HAS_POINTS}') AS reason`,
        `FROM ${q("renum_losers")} AS l WHERE NOT l.is_best_new AND NOT l.is_winner AND (l.skip_reason IS NOT NULL OR l.new_points > 0)`,
      ].join(" ")
    ),
    cte(
      "renum_dropped",
      [
        "SELECT DISTINCT ON (l.new_ref) l.new_ref AS ref, l.old_ref AS old_ref, b.new_ref AS kept_ref, l.hausdorff AS hausdorff, l.points AS points",
        `FROM ${q("renum_losers")} AS l JOIN ${q("renum_best")} AS b ON b.old_id = l.old_id`,
        "WHERE NOT l.is_best_new AND NOT l.is_winner AND l.skip_reason IS NULL AND l.new_points = 0",
        `AND l.new_ref NOT IN (SELECT h.new_ref FROM ${q("renum_held_extra")} AS h)`,
        "ORDER BY l.new_ref, l.hausdorff, l.old_ref",
      ].join(" ")
    ),
  ];
}

/**
 * Renumbered pairs: a removed section and a new one of the same street with the same shape, only the `reftramo` changed. The pairs
 * are the best candidates of `renumberPruneCtes`, judged by `renumberOutcomeCtes`. A pair renumbers only when its old `reftramo` names
 * exactly one current section, it is the only candidate of that old and of that new `reftramo`, and the new `reftramo` has exactly one
 * kept copy. Every other candidate is skipped with its reason, and its old and new sections are held: neither is removed nor inserted
 * (`removed_rest` and `new_rest` leave them out). A dropped new `reftramo` (`renum_dropped`) is left out of `new_rest` too.
 */
export function renumberCtes(): string[] {
  return [
    cte(
      "renumbered",
      [
        "SELECT c.old_id, c.old_ref, c.new_ref, c.idcalle, COALESCE(ap.points, 0) AS points, c.old_len, c.new_len, c.hausdorff, c.raw_candidates > 1 AS by_geometry",
        `FROM ${q("renum_status")} AS c LEFT JOIN ${q("ap")} AS ap ON ap.ref = c.old_ref WHERE c.skip_reason IS NULL`,
      ].join(" ")
    ),
    cte(
      "renum_skipped",
      [
        "SELECT c.old_id, c.old_ref, c.new_ref, c.idcalle, COALESCE(ap.points, 0) AS points, c.skip_reason AS reason",
        `FROM ${q("renum_status")} AS c LEFT JOIN ${q("ap")} AS ap ON ap.ref = c.old_ref WHERE c.skip_reason IS NOT NULL`,
        "UNION ALL",
        `SELECT h.old_id, h.old_ref, h.new_ref, h.idcalle, h.points, h.reason FROM ${q("renum_held_extra")} AS h`,
      ].join(" ")
    ),
    cte(
      "removed_rest",
      `SELECT r.* FROM ${q("removed")} AS r WHERE r.id NOT IN (SELECT old_id FROM ${q("renumbered")}) AND r.id NOT IN (SELECT old_id FROM ${q("renum_skipped")})`
    ),
    cte(
      "new_rest",
      `SELECT n.* FROM ${q("new_sections")} AS n WHERE n.ref NOT IN (SELECT new_ref FROM ${q("renumbered")}) AND n.ref NOT IN (SELECT new_ref FROM ${q("renum_skipped")}) AND n.ref NOT IN (SELECT ref FROM ${q("renum_dropped")})`
    ),
  ];
}

/** The held pairs: one row per section the analysis held, with the reason the load reports. */
export const buildCreateHeldTableSql = (name: string): string =>
  `CREATE TEMP TABLE ${q(name)} (old_id bigint, old_ref text, new_ref text, idcalle text, points bigint, reason text) ON COMMIT DROP`;

/** The discarded new `reftramo`s: the load keeps none of their copies. */
export const buildCreateDroppedTableSql = (name: string): string => `CREATE TEMP TABLE ${q(name)} (ref text) ON COMMIT DROP`;

/** Data-modifying CTEs: PostgreSQL runs each to completion even though the analysis never reads it. */
export const renumberSinkCtes = (sinks: RenumberSinks): string[] => [
  cte(
    "renum_sink",
    `INSERT INTO ${sinks.renumbered} (old_id, old_ref, new_ref, points) SELECT r.old_id, r.old_ref, r.new_ref, r.points FROM ${q("renumbered")} AS r RETURNING 1`
  ),
  cte(
    "held_sink",
    `INSERT INTO ${sinks.skipped} (old_id, old_ref, new_ref, idcalle, points, reason) SELECT r.old_id, r.old_ref, r.new_ref, r.idcalle, r.points, r.reason FROM ${q("renum_skipped")} AS r RETURNING 1`
  ),
  cte("dropped_sink", `INSERT INTO ${sinks.dropped} (ref) SELECT d.ref FROM ${q("renum_dropped")} AS d RETURNING 1`),
];

/** Held pairs: a repeated old `reftramo` holds one row per section it names, all with the same pair, so the pairs are counted. */
export const distinctPairsCountSql = (source: string): string =>
  `(SELECT count(*) FROM (SELECT DISTINCT p.old_ref, p.new_ref FROM ${source} AS p) AS pairs)`;

export const renumberCountColumns = (): string[] => [
  `${countOf("renumbered")} AS "renumbered"`,
  `${countOf("renumbered", "points > 0")} AS "renumbered_with_points"`,
  `(SELECT COALESCE(sum(points), 0) FROM ${q("renumbered")}) AS "renumbered_points"`,
  `${countOf("renumbered", "by_geometry")} AS "renumbered_by_geometry"`,
  `${countOf("renum_dropped")} AS "renumber_dropped_candidates"`,
  `${distinctPairsCountSql(q("renum_skipped"))} AS "renumber_skipped"`,
];

export const renumberListColumn = (alias: string): string =>
  listOf(
    alias,
    "renumbered_list",
    `SELECT p.old_ref AS "old_ref", p.new_ref AS "new_ref", p.idcalle AS "idcalle", p.points AS "points", p.old_len AS "old_length", p.new_len AS "new_length", p.hausdorff AS "hausdorff" FROM ${q("renumbered")} AS p ORDER BY p.points DESC, p.old_ref`
  );

export const renumberDroppedListColumn = (alias: string): string =>
  listOf(
    alias,
    "renumber_dropped_list",
    `SELECT d.ref AS "ref", d.old_ref AS "old_ref", d.kept_ref AS "kept_ref", d.hausdorff AS "hausdorff", d.points AS "points" FROM ${q("renum_dropped")} AS d ORDER BY d.points DESC, d.ref`
  );

export const renumberSkippedListColumn = (alias: string): string =>
  listOf(
    alias,
    "renumber_skipped_list",
    `SELECT DISTINCT p.old_ref AS "old_ref", p.new_ref AS "new_ref", p.idcalle AS "idcalle", p.points AS "points", p.reason AS "reason" FROM ${q("renum_skipped")} AS p ORDER BY p.points DESC, p.old_ref, p.new_ref`
  );
