import { cte, q } from "../../shared/sqlFragments";
import { isPieceSql } from "./pieceSql";
import { splitGroupsSql } from "./splitHoldSql";

/** The temp tables the real run's analysis fills with every merge member, plain removal, split piece and split point (see `removalSinkCtes`). */
export interface RemovalSinks {
  merged: string;
  plain: string;
  split: string;
  splitPoints: string;
}

/** One row per section of a merge: its old `reftramo`, its points and how many current sections carry that `reftramo`. */
export const buildCreateMergeTableSql = (name: string): string =>
  `CREATE TEMP TABLE ${q(name)} (new_ref text, idcalle text, old_id bigint, old_ref text, points bigint, id_points bigint, old_rows bigint) ON COMMIT DROP`;

/** One row per plain removal: the same measures as a merge member. */
export const buildCreatePlainTableSql = (name: string): string =>
  `CREATE TEMP TABLE ${q(name)} (old_id bigint, ref text, idcalle text, points bigint, old_rows bigint) ON COMMIT DROP`;

/** One row per (split, new piece): the old section, its points (by `reftramo` and by id), its old `reftramo` count and one piece. */
export const buildCreateSplitTableSql = (name: string): string =>
  `CREATE TEMP TABLE ${q(name)} (old_id bigint, old_ref text, idcalle text, points bigint, id_points bigint, old_rows bigint, new_ref text, geom_variant boolean, manual boolean) ON COMMIT DROP`;

/**
 * The new pieces of the splits, and the new `reftramo`s that belong to a split or a merge. Such a new section is inserted only when
 * its merge is accepted and applied: the analysis counts leave them out of the new sections, as the load does for held ones.
 */
export const groupPieceCtes = (): string[] => [
  cte(
    "split_members",
    [
      "SELECT s.id AS old_id, s.ref AS old_ref, s.idcalle, COALESCE(ap.points, 0) + COALESCE(apid.points, 0) AS points, COALESCE(apid.points, 0) AS id_points, COALESCE(k.rows, 0) AS old_rows, u.new_ref, COALESCE(gv.variant, false) AS geom_variant, s.manual",
      `FROM ${q("splits")} AS s LEFT JOIN ${q("ap")} AS ap ON ap.ref = s.ref LEFT JOIN ${q("ap")} AS apid ON apid.ref = s.id::text LEFT JOIN ${q("cur_rows")} AS k ON k.ref = s.ref CROSS JOIN LATERAL unnest(s.new_refs) AS u(new_ref)`,
      `LEFT JOIN ${q("copy_variant")} AS gv ON gv.ref = u.new_ref`,
    ].join(" ")
  ),
  cte(
    "group_pieces",
    `SELECT m.new_ref AS ref FROM ${q("split_members")} AS m UNION SELECT g.new_ref AS ref FROM ${q("merges")} AS g`
  ),
  cte("split_groups", splitGroupsSql(q("split_members"), q("merges"), q("copy_refs"))),
];

/** Data-modifying CTEs after the merge and removal lists: every member is written, accepted or not, so the load decides on the same classification. */
export const removalSinkCtes = (sinks: RemovalSinks): string[] => [
  cte(
    "merge_members",
    [
      "SELECT p.new_ref, p.idcalle, p.id AS old_id, p.old_ref, COALESCE(ap.points, 0) AS points, COALESCE(apid.points, 0) AS id_points, COALESCE(k.rows, 0) AS old_rows",
      `FROM ${q("merge_pairs")} AS p JOIN ${q("merges")} AS m ON m.new_ref = p.new_ref`,
      `LEFT JOIN ${q("ap")} AS ap ON ap.ref = p.old_ref LEFT JOIN ${q("ap")} AS apid ON apid.ref = p.id::text LEFT JOIN ${q("cur_rows")} AS k ON k.ref = p.old_ref WHERE ${isPieceSql("p.covered", "p.len", "p.piece_len")}`,
    ].join(" ")
  ),
  cte(
    "plain_members",
    [
      "SELECT p.id AS old_id, p.ref, p.idcalle, COALESCE(ap.points, 0) + COALESCE(apid.points, 0) AS points, COALESCE(k.rows, 0) AS old_rows",
      `FROM ${q("plain")} AS p LEFT JOIN ${q("ap")} AS ap ON ap.ref = p.ref LEFT JOIN ${q("ap")} AS apid ON apid.ref = p.id::text LEFT JOIN ${q("cur_rows")} AS k ON k.ref = p.ref`,
    ].join(" ")
  ),
  cte(
    "merge_sink",
    `INSERT INTO ${sinks.merged} (new_ref, idcalle, old_id, old_ref, points, id_points, old_rows) SELECT m.new_ref, m.idcalle, m.old_id, m.old_ref, m.points, m.id_points, m.old_rows FROM ${q("merge_members")} AS m RETURNING 1`
  ),
  cte(
    "plain_sink",
    `INSERT INTO ${sinks.plain} (old_id, ref, idcalle, points, old_rows) SELECT p.old_id, p.ref, p.idcalle, p.points, p.old_rows FROM ${q("plain_members")} AS p RETURNING 1`
  ),
  cte(
    "split_sink",
    `INSERT INTO ${sinks.split} (old_id, old_ref, idcalle, points, id_points, old_rows, new_ref, geom_variant, manual) SELECT m.old_id, m.old_ref, m.idcalle, m.points, m.id_points, m.old_rows, m.new_ref, m.geom_variant, m.manual FROM ${q("split_members")} AS m RETURNING 1`
  ),
];
