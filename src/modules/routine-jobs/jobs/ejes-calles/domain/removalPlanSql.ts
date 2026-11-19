import { withClause, q } from "../../shared/sqlFragments";
import { ADDRESS_COLUMN, EJES_SKIP_KIND, EJES_SKIP_REASON, GEO_TWIN_ROLE, INVALID_CHOICE_REFS_LIMIT, PADRON_COLUMN, ROAD_SECTION_COLUMN } from "../constants";
import type { EjesLayouts } from "../types";
import { currentCtes } from "./analysisSql";
import { col, table } from "./layoutSql";
import { createTemp, LOAD_TEMP, tmp } from "./loadSelectionSql";

const quoted = (value: string): string => `'${value}'`;

/**
 * Merges: one row per new `reftramo` of the analysis. A merge is applied only when it is accepted, its new `reftramo` is not a split
 * piece, it has one kept copy, its old sections each carry one current `reftramo`, no old section has points linked by id, and no
 * accepted merge shares an old section with it. The lookups are grouped once and joined, not counted per row.
 */
export function buildMergePlanSql(): string {
  const merge = tmp(LOAD_TEMP.MERGE);
  const accepted = tmp(LOAD_TEMP.ACC_MERGE);
  const sharedOld = `SELECT o.old_id FROM ${merge} AS o JOIN ${accepted} AS oa ON oa.ref = o.new_ref GROUP BY o.old_id HAVING count(DISTINCT o.new_ref) > 1`;
  const copies = `SELECT c.ref, count(*) AS copies FROM ${tmp(LOAD_TEMP.COPY)} AS c WHERE c.ref IN (SELECT m.new_ref FROM ${merge} AS m) GROUP BY c.ref`;
  const pieces = `SELECT DISTINCT s.new_ref FROM ${tmp(LOAD_TEMP.SPLIT)} AS s`;
  const groups = [
    "SELECT m.new_ref, min(m.idcalle) AS idcalle, string_agg(m.old_ref, ',' ORDER BY m.old_ref) AS refs, sum(m.points + m.id_points)::bigint AS points,",
    "bool_or(a.ref IS NOT NULL) AS accepted, bool_or(m.old_ref IS NULL) AS no_ref, bool_or(m.old_rows > 1) AS repeated,",
    "bool_or(m.id_points > 0) AS id_linked, bool_or(so.old_id IS NOT NULL) AS shared",
    `FROM ${merge} AS m LEFT JOIN ${accepted} AS a ON a.ref = m.new_ref LEFT JOIN (${sharedOld}) AS so ON so.old_id = m.old_id GROUP BY m.new_ref`,
  ].join(" ");
  return createTemp(LOAD_TEMP.MERGE_PLAN, [
    "SELECT g.new_ref, g.idcalle, g.refs, g.points, CASE",
    `WHEN NOT g.accepted THEN ${quoted(EJES_SKIP_REASON.NOT_ACCEPTED)}`,
    `WHEN sp.new_ref IS NOT NULL THEN ${quoted(EJES_SKIP_REASON.SHARED_PIECE)}`,
    `WHEN COALESCE(k.copies, 0) <> 1 THEN ${quoted(EJES_SKIP_REASON.NOT_SINGLE_COPY)}`,
    `WHEN g.no_ref THEN ${quoted(EJES_SKIP_REASON.NO_REFTRAMO)}`,
    `WHEN g.id_linked THEN ${quoted(EJES_SKIP_REASON.ID_LINKED_POINTS)}`,
    `WHEN g.repeated THEN ${quoted(EJES_SKIP_REASON.REPEATED_OLD_REF)}`,
    `WHEN g.shared THEN ${quoted(EJES_SKIP_REASON.SHARED_OLD_REF)}`,
    "END AS reason",
    `FROM (${groups}) AS g`,
    `LEFT JOIN (${copies}) AS k ON k.ref = g.new_ref`,
    `LEFT JOIN (${pieces}) AS sp ON sp.new_ref = g.new_ref`,
  ].join(" "));
}

/**
 * A twin winner that is not in carto and that no load writes: held (`ej_held`), dropped (`ej_dropped`), a held split piece, a held merge
 * `reftramo`, or without a copy in `ej_copy`. Such a loser would move its points to a section that never exists. Reads the plans of
 * the same transaction, so the split plan runs before the plain plan.
 */
const winnerNotLoadedSql = (winner: string): string => {
  const inTable = (table: string, column: string, condition = "true"): string =>
    `EXISTS (SELECT 1 FROM ${table} AS x WHERE x.${column} = ${winner} AND ${condition})`;
  const heldSplitPiece = `EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.SPLIT)} AS s JOIN ${tmp(LOAD_TEMP.SPLIT_PLAN)} AS sp ON sp.old_id = s.old_id WHERE s.new_ref = ${winner} AND sp.reason IS NOT NULL)`;
  const heldMergeRef = inTable(tmp(LOAD_TEMP.MERGE_PLAN), "new_ref", "x.reason IS NOT NULL");
  const notLoaded = [
    inTable(tmp(LOAD_TEMP.HELD), "new_ref"),
    inTable(tmp(LOAD_TEMP.DROPPED), "ref"),
    heldSplitPiece,
    heldMergeRef,
    `NOT ${inTable(tmp(LOAD_TEMP.COPY), "ref")}`,
  ];
  return `(NOT EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.GEO_TWIN)} AS w WHERE w.ref = ${winner} AND w.in_carto) AND (${notLoaded.join(" OR ")}))`;
};

/**
 * Plain removals and accepted geometric twin losers in carto: accepted, one current `reftramo`, and no access point left by `reftramo`
 * (plain removals) or by id (both). A twin loser keeps its points by `reftramo` until the load moves them to its winner (`new_ref`); a
 * loser whose winner is not loaded (`winnerNotLoadedSql`) stays as it is, with `WINNER_NOT_LOADED`. `kind` tells the two sources apart
 * (the skipped list counts them apart). Runs after the merge and split plans.
 */
export function buildPlainPlanSql(): string {
  const plain = [
    `SELECT p.old_id, p.ref, p.idcalle, p.points, NULL::text AS new_ref, CASE`,
    `WHEN a.ref IS NULL THEN ${quoted(EJES_SKIP_REASON.NOT_ACCEPTED)}`,
    `WHEN p.ref IS NULL THEN ${quoted(EJES_SKIP_REASON.NO_REFTRAMO)}`,
    `WHEN p.old_rows > 1 THEN ${quoted(EJES_SKIP_REASON.REPEATED_OLD_REF)}`,
    `WHEN p.points > 0 THEN ${quoted(EJES_SKIP_REASON.HAS_POINTS)}`,
    `END AS reason, ${quoted(EJES_SKIP_KIND.REMOVAL)} AS kind`,
    `FROM ${tmp(LOAD_TEMP.PLAIN)} AS p LEFT JOIN ${tmp(LOAD_TEMP.ACC_PLAIN)} AS a ON a.ref = p.ref`,
  ].join(" ");
  const twins = [
    `SELECT t.section_id AS old_id, t.ref, t.idcalle, t.points, t.winner_ref AS new_ref, CASE`,
    `WHEN a.ref IS NULL THEN ${quoted(EJES_SKIP_REASON.NOT_ACCEPTED)}`,
    `WHEN t.cur_rows > 1 THEN ${quoted(EJES_SKIP_REASON.REPEATED_OLD_REF)}`,
    `WHEN t.id_points > 0 THEN ${quoted(EJES_SKIP_REASON.ID_LINKED_POINTS)}`,
    `WHEN ${winnerNotLoadedSql("t.winner_ref")} THEN ${quoted(EJES_SKIP_REASON.WINNER_NOT_LOADED)}`,
    `END AS reason, ${quoted(EJES_SKIP_KIND.TWIN)} AS kind`,
    `FROM ${tmp(LOAD_TEMP.GEO_TWIN)} AS t LEFT JOIN ${tmp(LOAD_TEMP.ACC_TWIN)} AS a ON a.ref = t.ref`,
    `WHERE t.role = ${quoted(GEO_TWIN_ROLE.LOSER)} AND t.in_carto`,
  ].join(" ");
  return createTemp(LOAD_TEMP.PLAIN_PLAN, `${plain} UNION ALL ${twins}`);
}

/**
 * The copies of the pieces of splits and of the new `reftramo`s of merges that are not applied are held: they are not inserted, so no
 * section, master or way is created for them. Runs after the plans, which count the copies of each new `reftramo`.
 */
export const buildHoldGroupCopiesSql = (): string =>
  [
    `DELETE FROM ${tmp(LOAD_TEMP.COPY)} AS c WHERE`,
    `c.ref IN (SELECT s.new_ref FROM ${tmp(LOAD_TEMP.SPLIT)} AS s JOIN ${tmp(LOAD_TEMP.SPLIT_PLAN)} AS sp ON sp.old_id = s.old_id WHERE sp.reason IS NOT NULL)`,
    `OR c.ref IN (SELECT p.new_ref FROM ${tmp(LOAD_TEMP.MERGE_PLAN)} AS p WHERE p.reason IS NOT NULL)`,
  ].join(" ");

/**
 * Every access point move of the load: the renumbered `reftramo`s, the old sections of the applied merges and the applied twin losers,
 * each to its new `reftramo` (the twin's winner).
 */
export const buildMoveTableSql = (): string =>
  createTemp(
    LOAD_TEMP.MOVE,
    [
      `SELECT n.old_ref, n.new_ref, n.points FROM ${tmp(LOAD_TEMP.RENUM)} AS n`,
      "UNION ALL",
      `SELECT m.old_ref, m.new_ref, m.points FROM ${tmp(LOAD_TEMP.MERGE)} AS m JOIN ${tmp(LOAD_TEMP.MERGE_PLAN)} AS p ON p.new_ref = m.new_ref WHERE p.reason IS NULL`,
      "UNION ALL",
      `SELECT p.ref, p.new_ref, p.points FROM ${tmp(LOAD_TEMP.PLAIN_PLAN)} AS p WHERE p.kind = ${quoted(EJES_SKIP_KIND.TWIN)} AND p.reason IS NULL`,
    ].join(" ")
  );

/**
 * The move targets of the split points and of the move table that no section will hold: no kept copy of the load names them (a renumber
 * pair joins its copy, so a renumbered target counts only when its copy is kept) and no existing section has them. One row per target,
 * with its first old `reftramo`. Runs after the holds, so the copies are the ones the writes will insert or pair.
 */
export const buildMissingMoveTargetsSql = (layouts: EjesLayouts): string =>
  [
    withClause(currentCtes(layouts)),
    "SELECT m.new_ref AS \"new_ref\", m.old_ref AS \"old_ref\" FROM (",
    "SELECT DISTINCT ON (t.new_ref) t.new_ref, t.old_ref FROM (",
    `SELECT f.new_ref, f.old_ref FROM ${tmp(LOAD_TEMP.SPLIT_FINAL)} AS f`,
    "UNION ALL",
    `SELECT n.new_ref, n.old_ref FROM ${tmp(LOAD_TEMP.MOVE)} AS n`,
    ") AS t",
    `WHERE NOT EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.COPY)} AS c WHERE c.ref = t.new_ref)`,
    `AND NOT EXISTS (SELECT 1 FROM ${q("cur")} AS r WHERE r.ref = t.new_ref)`,
    "ORDER BY t.new_ref, t.old_ref) AS m",
    `ORDER BY m.new_ref LIMIT ${INVALID_CHOICE_REFS_LIMIT}`,
  ].join(" ");

/**
 * The road sections the load deletes: applied splits' and merges' old sections and applied plain removals. `master_deleted` is true only
 * when the section has a master that nothing else holds: no other section outside this delete, no address, no padron. Only those masters
 * are counted, deleted and restored; a shared master stays and is never re-inserted by a revert.
 */
export function buildDeleteTableSql(layouts: EjesLayouts): string {
  const road = (logical: string): string => `r.${col(layouts, "ROAD_SECTION", logical)}`;
  const master = road(ROAD_SECTION_COLUMN.ADDRESS_MASTER);
  const sectionMasterColumn = col(layouts, "ROAD_SECTION", ROAD_SECTION_COLUMN.ADDRESS_MASTER);
  const sectionIdColumn = col(layouts, "ROAD_SECTION", ROAD_SECTION_COLUMN.ID);
  const otherSectionHolds = `EXISTS (SELECT 1 FROM ${table(layouts, "ROAD_SECTION")} AS o WHERE o.${sectionMasterColumn} = ${master} AND o.${sectionIdColumn} NOT IN (SELECT c.road_id FROM cand AS c))`;
  const addressHolds = `EXISTS (SELECT 1 FROM ${table(layouts, "ADDRESS")} AS h WHERE h.${col(layouts, "ADDRESS", ADDRESS_COLUMN.ADDRESS_MASTER)} = ${master})`;
  const padronHolds = `EXISTS (SELECT 1 FROM ${table(layouts, "PADRONES")} AS h WHERE h.${col(layouts, "PADRONES", PADRON_COLUMN.ADDRESS_MASTER)} = ${master})`;
  const candidates = [
    `SELECT m.old_id AS road_id, m.old_ref AS ref, m.points FROM ${tmp(LOAD_TEMP.MERGE)} AS m JOIN ${tmp(LOAD_TEMP.MERGE_PLAN)} AS p ON p.new_ref = m.new_ref WHERE p.reason IS NULL`,
    "UNION ALL",
    `SELECT p.old_id AS road_id, p.ref AS ref, p.points FROM ${tmp(LOAD_TEMP.PLAIN_PLAN)} AS p WHERE p.reason IS NULL`,
    "UNION ALL",
    `SELECT p.old_id AS road_id, p.old_ref AS ref, p.points FROM ${tmp(LOAD_TEMP.SPLIT_PLAN)} AS p WHERE p.reason IS NULL`,
  ].join(" ");
  return createTemp(
    LOAD_TEMP.DEL,
    [
      `WITH cand AS (${candidates})`,
      `SELECT d.road_id, d.ref, d.points, ${master} AS master_id,`,
      `(${master} IS NOT NULL AND NOT ${otherSectionHolds} AND NOT ${addressHolds} AND NOT ${padronHolds}) AS master_deleted`,
      `FROM cand AS d JOIN ${table(layouts, "ROAD_SECTION")} AS r ON ${road(ROAD_SECTION_COLUMN.ID)} = d.road_id`,
    ].join(" ")
  );
}

/**
 * Every skipped row of the load, one per group: a split (its old section, with all its pieces), a merge (its new `reftramo`, with
 * its old ones), a plain removal, a held renumber pair. Applied rows are never here, so the list and its counts are exact.
 */
export const buildSkippedTableSql = (): string =>
  createTemp(LOAD_TEMP.SKIPPED, [
    `SELECT ${quoted(EJES_SKIP_KIND.SPLIT)} AS kind, s.old_ref AS refs, string_agg(s.new_ref, ',' ORDER BY s.new_ref) AS new_refs,`,
    `s.idcalle, s.points, p.reason`,
    `FROM ${tmp(LOAD_TEMP.SPLIT)} AS s JOIN ${tmp(LOAD_TEMP.SPLIT_PLAN)} AS p ON p.old_id = s.old_id WHERE p.reason IS NOT NULL`,
    "GROUP BY s.old_id, s.old_ref, s.idcalle, s.points, p.reason",
    "UNION ALL",
    `SELECT ${quoted(EJES_SKIP_KIND.MERGE)}, p.refs, p.new_ref, p.idcalle, p.points, p.reason`,
    `FROM ${tmp(LOAD_TEMP.MERGE_PLAN)} AS p WHERE p.reason IS NOT NULL`,
    "UNION ALL",
    `SELECT p.kind, p.ref, '', p.idcalle, p.points, p.reason`,
    `FROM ${tmp(LOAD_TEMP.PLAIN_PLAN)} AS p WHERE p.reason IS NOT NULL`,
    "UNION ALL",
    `SELECT DISTINCT ${quoted(EJES_SKIP_KIND.RENUMBER)}, h.old_ref, h.new_ref, h.idcalle, h.points, h.reason`,
    `FROM ${tmp(LOAD_TEMP.HELD)} AS h`,
  ].join(" "));

/** The first `limit` skipped rows, the largest first; the total and the counts by reason come from `buildSkippedReasonCountsSql`. */
export const buildSkippedListSql = (limit: number): string =>
  [
    'SELECT s.kind AS "kind", s.refs AS "refs", s.new_refs AS "new_refs", s.idcalle AS "idcalle", s.points AS "points", s.reason AS "reason"',
    `FROM ${tmp(LOAD_TEMP.SKIPPED)} AS s ORDER BY s.points DESC, s.kind, s.refs LIMIT ${limit}`,
  ].join(" ");

export const buildSkippedReasonCountsSql = (): string =>
  `SELECT s.reason AS "reason", count(*) AS "count" FROM ${tmp(LOAD_TEMP.SKIPPED)} AS s GROUP BY s.reason`;
