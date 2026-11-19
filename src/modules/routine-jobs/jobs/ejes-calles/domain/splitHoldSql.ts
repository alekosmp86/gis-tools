import { cte, q } from "../../shared/sqlFragments";
import { EJES_SKIP_REASON } from "../constants";

/** Whether each new `reftramo` has copies with different geometries (`copy_raw`, before the geometric rule); the copy holds read it. */
export const copyVariantCte = (): string =>
  cte("copy_variant", `SELECT r.ref, count(DISTINCT ST_AsEWKB(r.geom)) > 1 AS variant FROM ${q("copy_raw")} AS r GROUP BY r.ref`);

/** The new `reftramo`s with exactly one kept copy and no geometry variant: the only pieces a one-piece replacement may hold (as a split does). */
export const singleCopyCte = (): string =>
  cte("single_copy_refs", `SELECT k.ref FROM ${q("copy_refs")} AS k LEFT JOIN ${q("copy_variant")} AS v ON v.ref = k.ref WHERE k.copies = 1 AND NOT COALESCE(v.variant, false)`);

/**
 * The hold measures of every split: its old `reftramo`, its points, its pieces that are shared with another split or a merge, and
 * the pieces whose copies are not exactly one. `pieces` holds one row per (split, piece); `merges` names the merged new `reftramo`s;
 * `copyCounts` counts the kept copies per `reftramo`. The analysis and the load plan both read the holds from here, so they agree.
 */
export const splitGroupsSql = (pieces: string, merges: string, copyCounts: string): string => {
  const shared = `SELECT s.new_ref FROM ${pieces} AS s GROUP BY s.new_ref HAVING count(DISTINCT s.old_id) > 1 UNION SELECT m.new_ref FROM ${merges} AS m`;
  const groups = [
    "SELECT m.old_id, min(m.old_ref) AS old_ref, min(m.idcalle) AS idcalle, max(m.points) AS points, max(m.id_points) AS id_points, max(m.old_rows) AS old_rows,",
    "bool_or(sh.new_ref IS NOT NULL) AS shared, bool_or(COALESCE(k.copies, 0) <> 1 OR m.geom_variant) AS bad_copy",
    `FROM ${pieces} AS m LEFT JOIN (${shared}) AS sh ON sh.new_ref = m.new_ref LEFT JOIN ${copyCounts} AS k ON k.ref = m.new_ref GROUP BY m.old_id`,
  ].join(" ");
  return [
    "SELECT g.*, CASE",
    `WHEN g.old_ref IS NULL THEN '${EJES_SKIP_REASON.NO_REFTRAMO}'`,
    `WHEN g.old_rows > 1 THEN '${EJES_SKIP_REASON.REPEATED_OLD_REF}'`,
    `WHEN g.id_points > 0 THEN '${EJES_SKIP_REASON.ID_LINKED_POINTS}'`,
    `WHEN g.shared THEN '${EJES_SKIP_REASON.SHARED_PIECE}'`,
    `WHEN g.bad_copy THEN '${EJES_SKIP_REASON.NOT_SINGLE_COPY}'`,
    "END AS hold_reason",
    `FROM (${groups}) AS g`,
  ].join(" ");
};
