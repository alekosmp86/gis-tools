import { ADDRESS_MASTER_COLUMN } from "../../shared/addressMasterLinkSpec";
import { cte, literal, q, withClause } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { DESTINATION_COLUMN } from "../constants";
import type { PadronLayouts } from "../types";
import { DELETE_IDS_ID_COLUMN, DELETE_IDS_TABLE_SQL } from "./deleteIdsTable";
import { physicalColumn, qualifiedName } from "./layouts";
import { removedListSql } from "./removedListSql";
import {
  optionalAddressMasterColumn,
  REVERT_COLUMN,
  REVERT_EXTRA_COLUMN,
  REVERT_KIND,
  REVERT_TABLE_SQL,
  revertColumnList,
} from "./revertCapture";
import { referenceCountCtes, referenceJoinSql, referenceTotalColumnSql, type ReferenceTable } from "./replacementSql";

/* AP-106's own statement: the real run's delete of delete-eligible padrones. Kept apart from targetSql.ts so the
   stage's blanket "no DELETE" guard can name this one file as its only exception, next to the revert script. */

const TARGET_ALIAS = "tgt";

const DELETE_CTE = {
  CANDIDATES: "delete_candidates",
  REFS: "delete_refs",
  SURVIVING: "surviving_candidates",
  DELETED: "deleted_rows",
  REVERT: "delete_revert_rows",
  MASTER_CANDIDATES: "master_candidates",
  MASTER_DELETED: "master_deleted_rows",
  MASTER_REVERT: "master_revert_rows",
} as const;

const DELETE_RETURNING_COLUMNS: readonly string[] = [
  DESTINATION_COLUMN.ID,
  DESTINATION_COLUMN.TYPE_PADRON,
  DESTINATION_COLUMN.ID_CADASTRAL_LOCALITY,
  DESTINATION_COLUMN.NUMBER,
  DESTINATION_COLUMN.GEOMETRY,
  DESTINATION_COLUMN.ID_PROVINCE,
];

const ADDRESS_MASTER_RETURNING_COLUMN = "id_address_master";

const targetOf = (target: WritableTargetLayout, logical: string): string => `${TARGET_ALIAS}.${physicalColumn(target, logical)}`;
const targetTableSql = (target: WritableTargetLayout): string => `${qualifiedName(target)} AS ${TARGET_ALIAS}`;

/* Only condition (c) of AP-103 is re-checked here: a fresh grouped reference count over the candidate ids. (a) and (b) are
   already covered by the classification matching the plan's digest (AP-90), so they are not re-derived in this statement. */
function survivingCandidatesCte(): string {
  return cte(
    DELETE_CTE.SURVIVING,
    [
      `SELECT dc."old_id" AS "old_id" FROM ${q(DELETE_CTE.CANDIDATES)} AS dc`,
      referenceJoinSql(DELETE_CTE.REFS, `dc."old_id"`),
      `WHERE ${referenceTotalColumnSql(DELETE_CTE.REFS)} = 0`,
    ].join(" ")
  );
}

/* The only write of this statement: an id whose refs.total is no longer zero is skipped here, not a run failure (AP-106). */
function deletedRowsCte(target: WritableTargetLayout, addressMasterColumn: string | null): string {
  const addressMasterReturning = addressMasterColumn === null ? "NULL" : `${TARGET_ALIAS}.${addressMasterColumn}`;
  const returningColumns = [
    ...DELETE_RETURNING_COLUMNS.map((logical) => `${targetOf(target, logical)} AS ${q(logical)}`),
    `${addressMasterReturning} AS ${q(ADDRESS_MASTER_RETURNING_COLUMN)}`,
  ];
  return cte(
    DELETE_CTE.DELETED,
    [
      `DELETE FROM ${targetTableSql(target)}`,
      `WHERE ${targetOf(target, DESTINATION_COLUMN.ID)} IN (SELECT "old_id" FROM ${q(DELETE_CTE.SURVIVING)})`,
      `RETURNING ${returningColumns.join(", ")}`,
    ].join(" ")
  );
}

/* A deleted row's revert is a full INSERT, not a partial restore like U/P (AP-106): capture every column the destination
   writes plus id_province and id_address_master, in the same capture pass as AP-69. */
function deleteRevertRowsCte(addressMasterColumn: string | null): string {
  const addressMasterValue = addressMasterColumn === null ? "NULL" : `dr.${q(ADDRESS_MASTER_RETURNING_COLUMN)}`;
  return cte(
    DELETE_CTE.REVERT,
    [
      `INSERT INTO ${REVERT_TABLE_SQL} (${revertColumnList()})`,
      `SELECT ${literal(REVERT_KIND.DELETED)}, dr."id", dr."type_padron", dr."id_cadastral_locality", dr."number", dr."geometry",`,
      `dr."id_province", ${addressMasterValue}`,
      `FROM ${q(DELETE_CTE.DELETED)} AS dr`,
      `RETURNING ${q(REVERT_COLUMN.KIND)}`,
    ].join(" ")
  );
}

const MASTER_COLUMN = { ID: "master_id", PAYLOAD: "payload" } as const;

/* AP-114: the master rows of the deleted padrones that no other destination row still points to. The destination is read at the
   statement's snapshot, so the deleted rows are excluded by id. */
function masterCandidatesCte(target: WritableTargetLayout, addressMasterColumn: string): string {
  return cte(
    DELETE_CTE.MASTER_CANDIDATES,
    [
      `SELECT DISTINCT dr.${q(ADDRESS_MASTER_RETURNING_COLUMN)} AS ${q(MASTER_COLUMN.ID)} FROM ${q(DELETE_CTE.DELETED)} AS dr`,
      `WHERE dr.${q(ADDRESS_MASTER_RETURNING_COLUMN)} IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ${qualifiedName(target)} AS other`,
      `WHERE other.${addressMasterColumn} = dr.${q(ADDRESS_MASTER_RETURNING_COLUMN)}`,
      `AND other.${physicalColumn(target, DESTINATION_COLUMN.ID)} NOT IN (SELECT ${q(DESTINATION_COLUMN.ID)} FROM ${q(DELETE_CTE.DELETED)}))`,
    ].join(" ")
  );
}

function masterDeletedCte(addressMaster: WritableTargetLayout): string {
  const idColumn = physicalColumn(addressMaster, ADDRESS_MASTER_COLUMN.ID);
  return cte(
    DELETE_CTE.MASTER_DELETED,
    [
      `DELETE FROM ${qualifiedName(addressMaster)} AS am`,
      `WHERE am.${idColumn} IN (SELECT ${q(MASTER_COLUMN.ID)} FROM ${q(DELETE_CTE.MASTER_CANDIDATES)})`,
      `RETURNING am.${idColumn} AS ${q(REVERT_COLUMN.ID)}, to_jsonb(am) AS ${q(MASTER_COLUMN.PAYLOAD)}`,
    ].join(" ")
  );
}

/* Kind M: the whole master row as jsonb, restored with jsonb_populate_record before the padrón it belonged to. */
function masterRevertCte(): string {
  return cte(
    DELETE_CTE.MASTER_REVERT,
    [
      `INSERT INTO ${REVERT_TABLE_SQL} (${q(REVERT_COLUMN.KIND)}, ${q(REVERT_COLUMN.ID)}, ${q(REVERT_EXTRA_COLUMN.PAYLOAD)})`,
      `SELECT ${literal(REVERT_KIND.MASTER_DELETED)}, mr.${q(REVERT_COLUMN.ID)}, mr.${q(MASTER_COLUMN.PAYLOAD)}`,
      `FROM ${q(DELETE_CTE.MASTER_DELETED)} AS mr RETURNING ${q(REVERT_COLUMN.KIND)}`,
    ].join(" ")
  );
}

function masterCtes(layouts: PadronLayouts, addressMasterColumn: string | null): string[] {
  if (layouts.addressMaster === undefined || addressMasterColumn === null) return [];
  return [masterCandidatesCte(layouts.target, addressMasterColumn), masterDeletedCte(layouts.addressMaster), masterRevertCte()];
}

const masterCountsSql = (withMaster: boolean): string[] =>
  withMaster
    ? [
        `(SELECT count(*) FROM ${q(DELETE_CTE.MASTER_DELETED)}) AS "master_deleted",`,
        `(SELECT count(*) FROM ${q(DELETE_CTE.MASTER_REVERT)}) AS "master_revert_rows",`,
      ]
    : [`0 AS "master_deleted",`, `0 AS "master_revert_rows",`];

/** AP-106: its own statement, run after buildPadronApplySql, real run only, never a CTE inside that statement's WITH chain. By
    the time it runs, the inserts, geometry updates and applied pairs have already happened in the same transaction, so a row
    an applied pair just consumed already carries its new key. The candidates are the digest-verified delete-eligible ids the
    persist classify wrote into the session's temp table; `references` is the same AP-102 table list, re-scanned for
    staleness only (condition (c)). */
export function buildPadronDeleteSql(layouts: PadronLayouts, references: readonly ReferenceTable[]): string {
  const { target } = layouts;
  const addressMasterColumn = optionalAddressMasterColumn(target);
  const withMaster = layouts.addressMaster !== undefined && addressMasterColumn !== null;
  return [
    withClause([
      cte(DELETE_CTE.CANDIDATES, `SELECT ${q(DELETE_IDS_ID_COLUMN)} AS "old_id" FROM ${DELETE_IDS_TABLE_SQL}`),
      ...referenceCountCtes(DELETE_CTE.REFS, DELETE_CTE.CANDIDATES, "old_id", references),
      survivingCandidatesCte(),
      deletedRowsCte(target, addressMasterColumn),
      deleteRevertRowsCte(addressMasterColumn),
      ...masterCtes(layouts, addressMasterColumn),
    ]),
    "SELECT",
    `(SELECT count(*) FROM ${q(DELETE_CTE.SURVIVING)}) AS "surviving",`,
    `(SELECT count(*) FROM ${q(DELETE_CTE.DELETED)}) AS "deleted",`,
    `(SELECT count(*) FROM ${q(DELETE_CTE.REVERT)}) AS "revert_rows",`,
    ...masterCountsSql(withMaster),
    `${removedListSql(layouts, `SELECT dr.* FROM ${q(DELETE_CTE.DELETED)} AS dr`)} AS "removed_list"`,
  ].join(" ");
}
