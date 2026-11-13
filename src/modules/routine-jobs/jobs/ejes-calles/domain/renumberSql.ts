import { cte, q } from "../../shared/sqlFragments";
import { RENUMBER_CANDIDATE_DISTANCE_M, RENUMBER_HAUSDORFF_M } from "../constants";
import { countOf, listOf } from "./layoutSql";

/**
 * Renumbered pairs: a removed section and a new one of the same street with the same shape, only the `reftramo` changed.
 * The Hausdorff distance is computed only for the candidates the spatial index and the street join leave; only pairs where
 * each side has exactly one candidate count. `removed_rest` and `new_rest` are what the split, merge and plain logic reads.
 */
export function renumberCtes(): string[] {
  return [
    cte(
      "renum_cand",
      [
        "SELECT r.id AS old_id, r.ref AS old_ref, n.ref AS new_ref, r.idcalle AS idcalle, r.len AS old_len, ST_Length(n.geom) AS new_len,",
        "ST_HausdorffDistance(r.geometry, n.geom) AS hausdorff",
        `FROM ${q("removed")} AS r JOIN ${q("new_sections")} AS n ON n.idcalle = r.idcalle AND ST_DWithin(r.geometry, n.geom, ${RENUMBER_CANDIDATE_DISTANCE_M})`,
        `WHERE r.len > 0 AND r.idcalle IS NOT NULL AND ST_HausdorffDistance(r.geometry, n.geom) < ${RENUMBER_HAUSDORFF_M}`,
      ].join(" ")
    ),
    cte(
      "renum_counted",
      "SELECT c.*, count(*) OVER (PARTITION BY c.old_id) AS old_candidates, count(*) OVER (PARTITION BY c.new_ref) AS new_candidates FROM " +
        `${q("renum_cand")} AS c`
    ),
    cte(
      "renumbered",
      [
        "SELECT c.old_id, c.old_ref, c.new_ref, c.idcalle, COALESCE(ap.points, 0) AS points, c.old_len, c.new_len, c.hausdorff",
        `FROM ${q("renum_counted")} AS c LEFT JOIN ${q("ap")} AS ap ON ap.ref = c.old_ref WHERE c.old_candidates = 1 AND c.new_candidates = 1`,
      ].join(" ")
    ),
    cte("removed_rest", `SELECT r.* FROM ${q("removed")} AS r WHERE r.id NOT IN (SELECT old_id FROM ${q("renumbered")})`),
    cte("new_rest", `SELECT n.* FROM ${q("new_sections")} AS n WHERE n.ref NOT IN (SELECT new_ref FROM ${q("renumbered")})`),
  ];
}

export const renumberCountColumns = (): string[] => [
  `${countOf("renumbered")} AS "renumbered"`,
  `${countOf("renumbered", "points > 0")} AS "renumbered_with_points"`,
  `(SELECT COALESCE(sum(points), 0) FROM ${q("renumbered")}) AS "renumbered_points"`,
];

export const renumberListColumn = (alias: string): string =>
  listOf(
    alias,
    "renumbered_list",
    `SELECT p.old_ref AS "old_ref", p.new_ref AS "new_ref", p.idcalle AS "idcalle", p.points AS "points", p.old_len AS "old_length", p.new_len AS "new_length", p.hausdorff AS "hausdorff" FROM ${q("renumbered")} AS p ORDER BY p.points DESC, p.old_ref`
  );
