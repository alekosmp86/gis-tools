import { literal, q } from "../../shared/sqlFragments";
import { LOAD_CHUNK_SIZE } from "../constants";
import type { EjesAccepted } from "../types";
import { LOAD_TEMP, tmp } from "./loadSelectionSql";

const createAcceptedSql = (name: string): string => `CREATE TEMP TABLE ${q(name)} (ref text) ON COMMIT DROP`;

function insertAcceptedSql(name: string, refs: readonly string[]): string[] {
  const statements: string[] = [];
  for (let start = 0; start < refs.length; start += LOAD_CHUNK_SIZE) {
    const values = refs.slice(start, start + LOAD_CHUNK_SIZE).map((ref) => `(${literal(ref)})`);
    statements.push(`INSERT INTO ${q(name)} (ref) VALUES ${values.join(", ")}`);
  }
  return statements;
}

/** The accepted keys as temp tables, one row per key; the keys are canonical integer text (the request parser canonicalises them). */
export function buildAcceptedTablesSql(accepted: EjesAccepted): string[] {
  return [
    createAcceptedSql(LOAD_TEMP.ACC_MERGE),
    ...insertAcceptedSql(LOAD_TEMP.ACC_MERGE, accepted.merges),
    createAcceptedSql(LOAD_TEMP.ACC_PLAIN),
    ...insertAcceptedSql(LOAD_TEMP.ACC_PLAIN, accepted.plainRemovals),
  ];
}

/** Accepted keys the analysis of this transaction does not hold: the staging or the tables moved since the Revisar analysis. */
export const buildMissingAcceptedSql = (): string =>
  [
    `SELECT (SELECT count(*) FROM ${tmp(LOAD_TEMP.ACC_MERGE)} AS a WHERE a.ref NOT IN (SELECT m.new_ref FROM ${tmp(LOAD_TEMP.MERGE)} AS m))`,
    `+ (SELECT count(*) FROM ${tmp(LOAD_TEMP.ACC_PLAIN)} AS a WHERE a.ref NOT IN (SELECT p.ref FROM ${tmp(LOAD_TEMP.PLAIN)} AS p WHERE p.ref IS NOT NULL)) AS "missing"`,
  ].join(" ");
