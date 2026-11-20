import { cte, q } from "../../shared/sqlFragments";
import {
  ACCESS_POINT_COLUMN,
  ADDRESS_COLUMN,
  AMBIGUOUS_POINT_GAP_M,
  EJES_POINT_REASON,
  EJES_SRID,
  FAR_POINT_REPORT_M,
  REPLACEMENT_MAX_GROWTH_RATIO,
  REPLACEMENT_MIN_OLD_LENGTH_M,
  REPLACEMENT_PIECES,
  REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M,
  REVIEW_POINTS_STORE_LIMIT,
} from "../constants";
import type { EjesLayouts } from "../types";
import { isPieceSql } from "./pieceSql";
import { col, countOf, table } from "./layoutSql";
import { canonicalTextSql } from "./stagingSql";

/** One row per point of a split: the old section, the point, its decision (`reason` null is automatic) and whether it is far. */
export const buildCreateSplitPointTableSql = (name: string): string =>
  `CREATE TEMP TABLE ${q(name)} (old_id bigint, old_ref text, point_id bigint, new_ref text, reason text, far boolean) ON COMMIT DROP`;

const reasonLiteral = (reason: string): string => `'${reason}'`;

/**
 * The points of every split, by `reftramo` only (the `road_section.id` links are counted by the split rows, not moved). A point goes to
 * its nearest piece of its split when the second nearest is at least AMBIGUOUS_POINT_GAP_M farther or when it has one candidate. A
 * replacement (one piece) sends every point to that piece, geometry or not, unless its old section is shorter than
 * REPLACEMENT_MIN_OLD_LENGTH_M or its piece is longer than REPLACEMENT_MAX_GROWTH_RATIO times the old section: then every point is a review
 * point. Other points are review points: the nearest piece is their
 * suggestion, and a point with no address geometry has none. The address geometry
 * is used only when it has the expected SRID; a point whose geometry does not is a point without geometry. Pieces are the pieces that
 * count under `isPieceSql`, the same set the split's `new_refs` holds. An automatic point is sent to review when its receiving piece is
 * more than REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M farther than its old section (the old section geometry is read once per old section).
 */
export function splitPointCtes(layouts: EjesLayouts): string[] {
  const access = (logical: string): string => `a.${col(layouts, "ACCESS_POINT", logical)}`;
  const address = (logical: string): string => `g.${col(layouts, "ADDRESS", logical)}`;
  const reference = canonicalTextSql(access(ACCESS_POINT_COLUMN.ROAD_SECTION));
  return [
    cte(
      "split_point_refs",
      `SELECT ${access(ACCESS_POINT_COLUMN.ID)} AS point_id, ${reference} AS ref FROM ${table(layouts, "ACCESS_POINT")} AS a WHERE ${reference} IN (SELECT s.ref FROM ${q("splits")} AS s JOIN ${q("cur_rows")} AS c ON c.ref = s.ref WHERE c.rows = 1)`
    ),
    cte(
      "split_points",
      [
        `SELECT s.id AS old_id, s.ref AS old_ref, r.point_id, CASE WHEN ST_SRID(${address(ADDRESS_COLUMN.GEOMETRY)}) = ${EJES_SRID} AND NOT ST_IsEmpty(${address(ADDRESS_COLUMN.GEOMETRY)}) THEN ${address(ADDRESS_COLUMN.GEOMETRY)} END AS geom`,
        `FROM ${q("split_point_refs")} AS r JOIN ${q("splits")} AS s ON s.ref = r.ref`,
        `LEFT JOIN ${table(layouts, "ADDRESS")} AS g ON ${address(ADDRESS_COLUMN.ID)} = r.point_id`,
      ].join(" ")
    ),
    cte(
      "split_piece_geo",
      `SELECT DISTINCT ON (p.id, p.new_ref) p.id AS old_id, p.new_ref, p.geom FROM ${q("piece_cover")} AS p WHERE ${isPieceSql("p.piece_covered", "p.len", "p.piece_len")} ORDER BY p.id, p.new_ref`
    ),
    cte(
      "split_point_dist",
      `SELECT sp.old_id, sp.point_id, pg.new_ref, ST_Distance(sp.geom, pg.geom) AS dist FROM ${q("split_points")} AS sp JOIN ${q("split_piece_geo")} AS pg ON pg.old_id = sp.old_id WHERE sp.geom IS NOT NULL`
    ),
    cte(
      "split_point_rank",
      `SELECT d.old_id, d.point_id, d.new_ref, d.dist, row_number() OVER (PARTITION BY d.old_id, d.point_id ORDER BY d.dist NULLS LAST, CAST(d.new_ref AS numeric)) AS rnk FROM ${q("split_point_dist")} AS d`
    ),
    cte(
      "split_point_pick",
      [
        "SELECT sp.old_id, sp.old_ref, sp.point_id, sp.geom IS NOT NULL AS has_geom,",
        "min(r.new_ref) FILTER (WHERE r.rnk = 1) AS near_ref, min(r.dist) FILTER (WHERE r.rnk = 1) AS near_dist, min(r.dist) FILTER (WHERE r.rnk = 2) AS second_dist",
        `FROM ${q("split_points")} AS sp LEFT JOIN ${q("split_point_rank")} AS r ON r.old_id = sp.old_id AND r.point_id = sp.point_id`,
        "GROUP BY sp.old_id, sp.old_ref, sp.point_id, sp.geom IS NOT NULL",
      ].join(" ")
    ),
    cte(
      "split_one_piece",
      `SELECT s.id AS old_id, s.new_refs[1] AS new_ref, (s.len >= ${REPLACEMENT_MIN_OLD_LENGTH_M} AND s.new_len <= ${REPLACEMENT_MAX_GROWTH_RATIO} * s.len) AS usual FROM ${q("splits")} AS s WHERE cardinality(s.new_refs) = ${REPLACEMENT_PIECES}`
    ),
    cte(
      "split_point_base",
      [
        "SELECT k.old_id, k.old_ref, k.point_id, k.near_dist, COALESCE(one.new_ref, k.near_ref) AS new_ref, CASE",
        "WHEN one.new_ref IS NOT NULL AND one.usual THEN NULL",
        `WHEN one.new_ref IS NOT NULL THEN ${reasonLiteral(EJES_POINT_REASON.AMBIGUOUS)}`,
        `WHEN NOT k.has_geom OR k.near_ref IS NULL OR k.near_dist IS NULL THEN ${reasonLiteral(EJES_POINT_REASON.NO_GEOMETRY)}`,
        `WHEN k.second_dist IS NOT NULL AND k.second_dist - k.near_dist < ${AMBIGUOUS_POINT_GAP_M} THEN ${reasonLiteral(EJES_POINT_REASON.AMBIGUOUS)}`,
        "END AS reason,",
        `COALESCE(k.near_dist > ${FAR_POINT_REPORT_M}, false) AS far`,
        `FROM ${q("split_point_pick")} AS k LEFT JOIN ${q("split_one_piece")} AS one ON one.old_id = k.old_id`,
      ].join(" ")
    ),
    cte(
      "split_point_old_dist",
      `SELECT b.old_id, b.point_id, ST_Distance(sp.geom, r.geometry) AS old_dist FROM ${q("split_point_base")} AS b JOIN ${q("split_points")} AS sp ON sp.old_id = b.old_id AND sp.point_id = b.point_id JOIN ${q("removed_rest")} AS r ON r.id = b.old_id WHERE b.reason IS NULL AND sp.geom IS NOT NULL`
    ),
    cte(
      "split_point_decided",
      [
        "SELECT b.old_id, b.old_ref, b.point_id, b.new_ref, CASE",
        `WHEN o.old_dist IS NOT NULL AND b.near_dist > o.old_dist + ${REPLACEMENT_POINT_MAX_EXTRA_DISTANCE_M} THEN ${reasonLiteral(EJES_POINT_REASON.AMBIGUOUS)}`,
        "ELSE b.reason END AS reason, b.far",
        `FROM ${q("split_point_base")} AS b LEFT JOIN ${q("split_point_old_dist")} AS o ON o.old_id = b.old_id AND o.point_id = b.point_id`,
      ].join(" ")
    ),
    cte(
      "split_stats",
      [
        "SELECT d.old_id, count(*) AS ref_points,",
        "count(*) FILTER (WHERE d.reason IS NULL) AS auto_points,",
        `count(*) FILTER (WHERE d.reason = ${reasonLiteral(EJES_POINT_REASON.AMBIGUOUS)}) AS review_points,`,
        `count(*) FILTER (WHERE d.reason = ${reasonLiteral(EJES_POINT_REASON.NO_GEOMETRY)}) AS no_geometry_points,`,
        "count(*) FILTER (WHERE d.far) AS far_points",
        `FROM ${q("split_point_decided")} AS d GROUP BY d.old_id`,
      ].join(" ")
    ),
  ];
}

/** The data-modifying CTE that writes every decided point into the temp table the load reads (PostgreSQL runs it although nothing reads it). */
export const splitPointSinkCtes = (sinkTable: string): string[] => [
  cte(
    "split_point_sink",
    `INSERT INTO ${sinkTable} (old_id, old_ref, point_id, new_ref, reason, far) SELECT d.old_id, d.old_ref, d.point_id, d.new_ref, d.reason, d.far FROM ${q("split_point_decided")} AS d RETURNING 1`
  ),
];

/**
 * The review points of the dry run, kept for the review screen (EJS-6): each review point with its candidate pieces (distance in metres,
 * one decimal, nearest first). A split is stored whole or not at all: `review_fit` keeps the splits whose points fit in
 * REVIEW_POINTS_STORE_LIMIT in the order of their old section, so a split that does not fit is flagged incomplete.
 */
export const reviewPointCtes = (): string[] => [
  cte(
    "review_rows",
    [
      "SELECT d.old_id, d.old_ref, d.point_id, d.reason, d.new_ref AS suggested_ref,",
      "COALESCE((SELECT json_agg(json_build_object('newRef', pg.new_ref, 'distance', ROUND(ST_Distance(sp.geom, pg.geom)::numeric, 1)::float8)",
      "ORDER BY ST_Distance(sp.geom, pg.geom) NULLS LAST, CAST(pg.new_ref AS numeric))",
      `FROM ${q("split_piece_geo")} AS pg WHERE pg.old_id = d.old_id), '[]'::json) AS candidates`,
      `FROM ${q("split_point_decided")} AS d JOIN ${q("split_points")} AS sp ON sp.old_id = d.old_id AND sp.point_id = d.point_id`,
      "WHERE d.reason IS NOT NULL",
    ].join(" ")
  ),
  cte("review_split", `SELECT r.old_id, count(*) AS n FROM ${q("review_rows")} AS r GROUP BY r.old_id`),
  cte(
    "review_fit",
    `SELECT x.old_id, sum(x.n) OVER (ORDER BY x.old_id) <= ${REVIEW_POINTS_STORE_LIMIT} AS fits FROM ${q("review_split")} AS x`
  ),
  cte(
    "review_stored",
    `SELECT r.old_id, r.old_ref, r.point_id, r.reason, r.suggested_ref, r.candidates FROM ${q("review_rows")} AS r JOIN ${q("review_fit")} AS f ON f.old_id = r.old_id WHERE f.fits`
  ),
];

/** The stored review points of the dry run, as one JSON array column of the analysis (not limited by the list limit). */
export const reviewPointsColumn = (): string =>
  [
    "COALESCE((SELECT json_agg(json_build_object('oldRef', s.old_ref, 'pointId', s.point_id::text, 'reason', s.reason,",
    "'suggestedRef', s.suggested_ref, 'candidates', s.candidates) ORDER BY s.old_ref, s.point_id)",
    `FROM ${q("review_stored")} AS s), '[]'::json) AS ${q("review_points")}`,
  ].join(" ");

/** The point counts of the report: all split points by `reftramo`, then by decision, and the far ones (informational). */
export const splitPointCountColumns = (): string[] => [
  `${countOf("split_point_decided")} AS "split_points"`,
  `${countOf("split_point_decided", "reason IS NULL")} AS "split_points_auto"`,
  `${countOf("split_point_decided", `reason = ${reasonLiteral(EJES_POINT_REASON.AMBIGUOUS)}`)} AS "split_points_review"`,
  `${countOf("split_point_decided", `reason = ${reasonLiteral(EJES_POINT_REASON.NO_GEOMETRY)}`)} AS "split_points_no_geometry"`,
  `${countOf("split_point_decided", "far")} AS "split_points_far"`,
];
