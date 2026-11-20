import { literal, q, withClause } from "../../shared/sqlFragments";
import { GEO_TWIN_ROLE, INVALID_CHOICE_REFS_LIMIT, INVALID_TWIN_PICK_REFS_LIMIT, LOAD_CHUNK_SIZE } from "../constants";
import type { EjesAccepted, EjesLayouts } from "../types";
import { copyRawCte } from "./analysisSql";
import { LOAD_TEMP, tmp } from "./loadSelectionSql";
import { shortUnheldCte } from "./stagingSql";
import { pickNamesCopySql } from "./twinPickSql";

const createTableSql = (name: string, columns: string): string => `CREATE TEMP TABLE ${q(name)} (${columns}) ON COMMIT DROP`;

function insertRowsSql(name: string, rows: readonly (readonly string[])[]): string[] {
  const statements: string[] = [];
  for (let start = 0; start < rows.length; start += LOAD_CHUNK_SIZE) {
    const values = rows.slice(start, start + LOAD_CHUNK_SIZE).map((row) => `(${row.map(literal).join(", ")})`);
    statements.push(`INSERT INTO ${q(name)} VALUES ${values.join(", ")}`);
  }
  return statements;
}

/** The old `reftramo`s accepted as splits, each once: the split rows and the manual splits (a manual split is accepted by its old `reftramo`). */
const acceptedSplitRefsOf = (accepted: EjesAccepted): string[] => [
  ...new Set([...accepted.splits.map((split) => split.oldRef), ...accepted.manualSplits.map((split) => split.oldRef)]),
];

/** With `autoPlainRemovals`, every plain removal of the analysis with no access point (by `reftramo` and by id) is accepted. Runs after `readAnalysisForLoad` fills `ej_plain`. */
const autoPlainStatementsOf = (accepted: EjesAccepted): string[] =>
  accepted.autoPlainRemovals
    ? [`INSERT INTO ${q(LOAD_TEMP.ACC_PLAIN)} SELECT p.ref FROM ${tmp(LOAD_TEMP.PLAIN)} AS p WHERE p.points = 0 AND p.ref IS NOT NULL`]
    : [];

/** The accepted keys and split choices as temp tables; the keys are canonical integer text (the request parser canonicalises them). */
export function buildAcceptedTablesSql(accepted: EjesAccepted): string[] {
  const choices = accepted.splits.flatMap((split) => split.choices.map((choice) => [split.oldRef, choice.pointId, choice.newRef]));
  return [
    createTableSql(LOAD_TEMP.ACC_MERGE, "ref text"),
    ...insertRowsSql(LOAD_TEMP.ACC_MERGE, accepted.merges.map((ref) => [ref])),
    createTableSql(LOAD_TEMP.ACC_PLAIN, "ref text"),
    ...insertRowsSql(LOAD_TEMP.ACC_PLAIN, accepted.plainRemovals.map((ref) => [ref])),
    ...autoPlainStatementsOf(accepted),
    createTableSql(LOAD_TEMP.ACC_TWIN, "ref text"),
    ...insertRowsSql(LOAD_TEMP.ACC_TWIN, accepted.twinRemovals.map((ref) => [ref])),
    createTableSql(LOAD_TEMP.ACC_TWIN_PICK, "ref text, department text, locality text"),
    ...insertRowsSql(LOAD_TEMP.ACC_TWIN_PICK, accepted.twinPicks.map((pick) => [pick.ref, pick.department, pick.locality])),
    createTableSql(LOAD_TEMP.ACC_SPLIT, "ref text"),
    ...insertRowsSql(LOAD_TEMP.ACC_SPLIT, acceptedSplitRefsOf(accepted).map((ref) => [ref])),
    createTableSql(LOAD_TEMP.ACC_CHOICE, "old_ref text, point_id text, new_ref text"),
    ...insertRowsSql(LOAD_TEMP.ACC_CHOICE, choices),
  ];
}

/** Accepted keys the analysis of this transaction does not hold: the staging or the tables moved since the Revisar analysis. */
export const buildMissingAcceptedSql = (): string =>
  [
    `SELECT (SELECT count(*) FROM ${tmp(LOAD_TEMP.ACC_MERGE)} AS a WHERE a.ref NOT IN (SELECT m.new_ref FROM ${tmp(LOAD_TEMP.MERGE)} AS m))`,
    `+ (SELECT count(*) FROM ${tmp(LOAD_TEMP.ACC_PLAIN)} AS a WHERE a.ref NOT IN (SELECT p.ref FROM ${tmp(LOAD_TEMP.PLAIN)} AS p WHERE p.ref IS NOT NULL))`,
    `+ (SELECT count(*) FROM ${tmp(LOAD_TEMP.ACC_TWIN)} AS a WHERE a.ref NOT IN (SELECT t.ref FROM ${tmp(LOAD_TEMP.GEO_TWIN)} AS t WHERE t.role = '${GEO_TWIN_ROLE.LOSER}' AND t.in_carto))`,
    `+ (SELECT count(*) FROM ${tmp(LOAD_TEMP.ACC_SPLIT)} AS a WHERE a.ref NOT IN (SELECT s.old_ref FROM ${tmp(LOAD_TEMP.SPLIT)} AS s WHERE s.old_ref IS NOT NULL)) AS "missing"`,
  ].join(" ");

/** The old `reftramo`s of up to `INVALID_TWIN_PICK_REFS_LIMIT` picks that name no copy of the staging (ET-28, fail closed). */
export const buildInvalidTwinPickRefsSql = (layouts: EjesLayouts): string =>
  [
    withClause([shortUnheldCte(layouts), copyRawCte(layouts)]),
    `SELECT DISTINCT p.ref FROM ${tmp(LOAD_TEMP.ACC_TWIN_PICK)} AS p`,
    `WHERE NOT EXISTS (SELECT 1 FROM ${q("copy_raw")} AS r WHERE ${pickNamesCopySql("p", "r")})`,
    `ORDER BY p.ref LIMIT ${INVALID_TWIN_PICK_REFS_LIMIT}`,
  ].join(" ");

/**
 * Choices that name a point which is not a review point of its split, a piece that is not one of its split's pieces, or a split the
 * plan holds. Runs after `ej_split_plan` exists. Any such choice aborts the load (fail closed), never a skipped row.
 */
/** The old `reftramo`s of up to `INVALID_CHOICE_REFS_LIMIT` invalid choices, for the abort message. Empty when every choice is valid. */
export const buildInvalidChoiceRefsSql = (): string =>
  [
    `SELECT DISTINCT c.old_ref FROM ${tmp(LOAD_TEMP.ACC_CHOICE)} AS c`,
    `WHERE NOT EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.SPLIT_PTS)} AS p WHERE p.old_ref = c.old_ref AND p.point_id::text = c.point_id AND p.reason IS NOT NULL)`,
    `OR NOT EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.SPLIT)} AS s WHERE s.old_ref = c.old_ref AND s.new_ref = c.new_ref)`,
    `OR NOT EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.SPLIT_PLAN)} AS pl WHERE pl.old_ref = c.old_ref AND pl.reason IS NULL)`,
    `ORDER BY c.old_ref LIMIT ${INVALID_CHOICE_REFS_LIMIT}`,
  ].join(" ");
