import { ACCESS_POINT_COLUMN, EJES_SKIP_REASON, EJES_TABLE_ROLE, ROAD_SECTION_COLUMN } from "../constants";
import type { EjesLoadContext } from "../types";
import { accessPointRefMatchSql } from "./analysisSql";
import { canonicalTextSql } from "./stagingSql";
import { splitGroupsSql } from "./splitHoldSql";
import { physicalOf, qualifiedOf, typedAs } from "./loadContext";
import { createTemp, LOAD_TEMP, tmp } from "./loadSelectionSql";
import { counted } from "./loadWriteSql";

const quoted = (value: string): string => `'${value}'`;

/**
 * One row per split of the accepted load. A split is applied only when it is accepted, holds no reason of `splitGroupsSql` (the same
 * rules the analysis reports as `heldReason`), and has no review point left without a choice. Runs before the copies are held, so the
 * copy count is the one the pieces would be inserted with.
 */
export const buildSplitPlanSql = (): string => {
  const pieces = tmp(LOAD_TEMP.SPLIT);
  const choices = tmp(LOAD_TEMP.ACC_CHOICE);
  const copies = `(SELECT c.ref, count(*) AS copies FROM ${tmp(LOAD_TEMP.COPY)} AS c GROUP BY c.ref)`;
  const unresolved = [
    `SELECT p.old_id, count(*) AS n FROM ${tmp(LOAD_TEMP.SPLIT_PTS)} AS p WHERE p.reason IS NOT NULL`,
    `AND NOT EXISTS (SELECT 1 FROM ${choices} AS c WHERE c.old_ref = p.old_ref AND c.point_id = p.point_id::text)`,
    "GROUP BY p.old_id",
  ].join(" ");
  return createTemp(LOAD_TEMP.SPLIT_PLAN, [
    "SELECT g.old_id, g.old_ref, g.idcalle, g.points, CASE",
    `WHEN a.ref IS NULL THEN ${quoted(EJES_SKIP_REASON.NOT_ACCEPTED)}`,
    "WHEN g.hold_reason IS NOT NULL THEN g.hold_reason",
    `WHEN COALESCE(u.n, 0) > 0 THEN ${quoted(EJES_SKIP_REASON.REVIEW_REQUIRED)}`,
    "END AS reason",
    `FROM (${splitGroupsSql(pieces, tmp(LOAD_TEMP.MERGE), copies)}) AS g LEFT JOIN ${tmp(LOAD_TEMP.ACC_SPLIT)} AS a ON a.ref = g.old_ref`,
    `LEFT JOIN (${unresolved}) AS u ON u.old_id = g.old_id`,
  ].join(" "));
};

/**
 * The point assignment of the applied splits: an automatic point goes to its suggested piece, a review point to its choice. The raw
 * `reftramo` the point holds before the load is kept as `old_value`, so the revert puts it back by id.
 */
export function buildSplitFinalSql(context: EjesLoadContext): string {
  const access = EJES_TABLE_ROLE.ACCESS_POINT;
  const reference = physicalOf(context, access, ACCESS_POINT_COLUMN.ROAD_SECTION);
  const id = physicalOf(context, access, ACCESS_POINT_COLUMN.ID);
  const oldOf = (column: string): string =>
    `(SELECT a.${column}::text FROM ${qualifiedOf(context, access)} AS a WHERE a.${id} = ${typedAs(context, access, ACCESS_POINT_COLUMN.ID, "p.point_id")})`;
  const wayColumn = physicalOf(context, access, ACCESS_POINT_COLUMN.CIRCULATION_WAY);
  return createTemp(LOAD_TEMP.SPLIT_FINAL, [
    `SELECT p.old_id, p.old_ref, p.point_id, COALESCE(c.new_ref, p.new_ref) AS new_ref, ${oldOf(reference)} AS old_value, ${oldOf(wayColumn)} AS old_way`,
    `FROM ${tmp(LOAD_TEMP.SPLIT_PTS)} AS p JOIN ${tmp(LOAD_TEMP.SPLIT_PLAN)} AS pl ON pl.old_id = p.old_id AND pl.reason IS NULL`,
    `LEFT JOIN ${tmp(LOAD_TEMP.ACC_CHOICE)} AS c ON c.old_ref = p.old_ref AND c.point_id = p.point_id::text`,
    "WHERE p.reason IS NULL OR c.new_ref IS NOT NULL",
  ].join(" "));
}

/**
 * The only write of a split's points: each point of the table moves from its old `reftramo` to its piece, guarded by that old value.
 * The point takes the street of its piece too (`id_circulation_way`), so a piece on another street does not leave it on the old one;
 * a piece with no street keeps the point's own.
 */
export function buildMoveSplitPointsSql(context: EjesLoadContext): string {
  const access = EJES_TABLE_ROLE.ACCESS_POINT;
  const section = EJES_TABLE_ROLE.ROAD_SECTION;
  const reference = physicalOf(context, access, ACCESS_POINT_COLUMN.ROAD_SECTION);
  const wayColumn = physicalOf(context, access, ACCESS_POINT_COLUMN.CIRCULATION_WAY);
  const id = physicalOf(context, access, ACCESS_POINT_COLUMN.ID);
  const pieceWay = [
    `SELECT r.${physicalOf(context, section, ROAD_SECTION_COLUMN.CIRCULATION_WAY)} FROM ${qualifiedOf(context, section)} AS r`,
    `WHERE ${canonicalTextSql(`r.${physicalOf(context, section, ROAD_SECTION_COLUMN.REFTRAMO)}`)} = f.new_ref LIMIT 1`,
  ].join(" ");
  const way = `${wayColumn} = COALESCE((${pieceWay}), a.${wayColumn})`;
  return counted(
    [
      `UPDATE ${qualifiedOf(context, access)} AS a SET ${reference} = ${typedAs(context, access, ACCESS_POINT_COLUMN.ROAD_SECTION, "f.new_ref")}, ${way}`,
      `FROM ${tmp(LOAD_TEMP.SPLIT_FINAL)} AS f WHERE a.${id} = ${typedAs(context, access, ACCESS_POINT_COLUMN.ID, "f.point_id")}`,
      `AND ${accessPointRefMatchSql(context, "f.old_ref")}`,
    ].join(" ")
  );
}
