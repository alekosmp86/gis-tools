import { physicalColumn, qualifiedName } from "../../actualizar-padron/domain/layouts";
import { DETAIL_LIST_LIMIT, SAMPLE_LIMIT } from "../../shared/limits";
import { cte, jsonArrayOf, literal, q, withClause } from "../../shared/sqlFragments";
import {
  ADDRESS_MASTER_INITIAL_COORDINATE,
  COMPLETAR_ADDRESS_MASTER_COLUMN,
  COMPLETAR_UNIT_COLUMN,
  TERRITORIAL_UNIT_URN_PREFIX,
} from "../constants";
import type { CompletarLayouts } from "../types";

const UNIT_ALIAS = "tu";
const ADDRESS_MASTER_ALIAS = "am";
const CANDIDATE_ALIAS = "c";
const CLASSIFIED_ALIAS = "cl";
const LINK_ALIAS = "lk";
const INSERTED_ALIAS = "ir";
const UPDATED_ALIAS = "ur";

const CTE = {
  CANDIDATES: "candidates",
  MATCHES: "matches",
  CLASSIFIED: "classified",
  INSERTED: "inserted_rows",
  LINKS: "links",
  UPDATED: "updated_rows",
} as const;

const CANDIDATE_CLASS = {
  NEW: "new",
  EXISTING: "existing",
  AMBIGUOUS: "ambiguous",
} as const;

const unitOf = (layouts: CompletarLayouts, logical: string): string =>
  `${UNIT_ALIAS}.${physicalColumn(layouts.unit, logical)}`;
const addressMasterOf = (layouts: CompletarLayouts, logical: string): string =>
  `${ADDRESS_MASTER_ALIAS}.${physicalColumn(layouts.addressMaster, logical)}`;
const classifiedOf = (column: string): string => `${CLASSIFIED_ALIAS}.${q(column)}`;
const classIs = (value: string): string => `${classifiedOf("class")} = ${literal(value)}`;

const unitTableSql = (layouts: CompletarLayouts): string => `${qualifiedName(layouts.unit)} AS ${UNIT_ALIAS}`;
const addressMasterTableSql = (layouts: CompletarLayouts): string =>
  `${qualifiedName(layouts.addressMaster)} AS ${ADDRESS_MASTER_ALIAS}`;

function candidatesCte(layouts: CompletarLayouts): string {
  const unitId = unitOf(layouts, COMPLETAR_UNIT_COLUMN.ID);
  return cte(
    CTE.CANDIDATES,
    [
      `SELECT ${unitId} AS "unit_id", ${unitOf(layouts, COMPLETAR_UNIT_COLUMN.NAME)} AS "name",`,
      `${unitOf(layouts, COMPLETAR_UNIT_COLUMN.ID_PROVINCE)}::text AS "province_id",`,
      `concat(${literal(TERRITORIAL_UNIT_URN_PREFIX)}, ${unitId}) AS "urn"`,
      `FROM ${unitTableSql(layouts)} WHERE ${unitOf(layouts, COMPLETAR_UNIT_COLUMN.ID_ADDRESS_MASTER)} IS NULL`,
    ].join(" ")
  );
}

function matchesCte(layouts: CompletarLayouts): string {
  const addressMasterId = addressMasterOf(layouts, COMPLETAR_ADDRESS_MASTER_COLUMN.ID);
  const groupColumns = ["unit_id", "urn"].map((column) => `${CANDIDATE_ALIAS}.${q(column)}`);
  return cte(
    CTE.MATCHES,
    [
      `SELECT ${groupColumns.join(", ")}, min(${CANDIDATE_ALIAS}."name") AS "name", min(${CANDIDATE_ALIAS}."province_id") AS "province_id",`,
      `count(${addressMasterId}) AS "records", min(${addressMasterId}) AS "address_master_id"`,
      `FROM ${q(CTE.CANDIDATES)} AS ${CANDIDATE_ALIAS}`,
      `LEFT JOIN ${addressMasterTableSql(layouts)} ON ${addressMasterOf(layouts, COMPLETAR_ADDRESS_MASTER_COLUMN.URN)} = ${CANDIDATE_ALIAS}."urn"`,
      `GROUP BY ${groupColumns.join(", ")}`,
    ].join(" ")
  );
}

function classifiedCte(): string {
  return cte(
    CTE.CLASSIFIED,
    [
      `SELECT m.*, CASE WHEN m."records" = 0 THEN ${literal(CANDIDATE_CLASS.NEW)}`,
      `WHEN m."records" = 1 THEN ${literal(CANDIDATE_CLASS.EXISTING)}`,
      `ELSE ${literal(CANDIDATE_CLASS.AMBIGUOUS)} END AS "class"`,
      `FROM ${q(CTE.MATCHES)} AS m`,
    ].join(" ")
  );
}

const classifyCtes = (layouts: CompletarLayouts): string[] => [
  candidatesCte(layouts),
  matchesCte(layouts),
  classifiedCte(),
];

const ambiguousSamplesSql = [
  `SELECT ${classifiedOf("unit_id")} AS "id", ${classifiedOf("name")} AS "name",`,
  `${classifiedOf("province_id")} AS "provinceId", ${classifiedOf("records")} AS "records"`,
  `FROM ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS} WHERE ${classIs(CANDIDATE_CLASS.AMBIGUOUS)}`,
  `ORDER BY ${classifiedOf("unit_id")} LIMIT ${SAMPLE_LIMIT}`,
].join(" ");

export function buildCompletarClassifySql(layouts: CompletarLayouts): string {
  return [
    withClause(classifyCtes(layouts)),
    "SELECT",
    `count(*) AS "without_address_master",`,
    `count(*) FILTER (WHERE ${classIs(CANDIDATE_CLASS.NEW)}) AS "to_create",`,
    `count(*) FILTER (WHERE ${classIs(CANDIDATE_CLASS.EXISTING)}) AS "already_had_record",`,
    `count(*) FILTER (WHERE ${classIs(CANDIDATE_CLASS.AMBIGUOUS)}) AS "ambiguous",`,
    `${jsonArrayOf(ambiguousSamplesSql, "ambiguous_samples")} AS "ambiguous_samples"`,
    `FROM ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
  ].join(" ");
}

function insertCte(layouts: CompletarLayouts): string {
  const columns = [
    COMPLETAR_ADDRESS_MASTER_COLUMN.URN,
    COMPLETAR_ADDRESS_MASTER_COLUMN.LATITUDE,
    COMPLETAR_ADDRESS_MASTER_COLUMN.LONGITUDE,
  ]
    .map((logical) => physicalColumn(layouts.addressMaster, logical))
    .join(", ");
  return cte(
    CTE.INSERTED,
    [
      `INSERT INTO ${qualifiedName(layouts.addressMaster)} (${columns})`,
      `SELECT ${classifiedOf("urn")}, ${ADDRESS_MASTER_INITIAL_COORDINATE}, ${ADDRESS_MASTER_INITIAL_COORDINATE}`,
      `FROM ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
      `WHERE ${classIs(CANDIDATE_CLASS.NEW)} ORDER BY ${classifiedOf("unit_id")}`,
      `RETURNING ${physicalColumn(layouts.addressMaster, COMPLETAR_ADDRESS_MASTER_COLUMN.ID)} AS "address_master_id",`,
      `${physicalColumn(layouts.addressMaster, COMPLETAR_ADDRESS_MASTER_COLUMN.URN)} AS "urn"`,
    ].join(" ")
  );
}

function linksCte(): string {
  return cte(
    CTE.LINKS,
    [
      `SELECT ${classifiedOf("unit_id")} AS "unit_id", ${classifiedOf("address_master_id")} AS "address_master_id", false AS "created"`,
      `FROM ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS} WHERE ${classIs(CANDIDATE_CLASS.EXISTING)}`,
      `UNION ALL`,
      `SELECT ${classifiedOf("unit_id")}, ${INSERTED_ALIAS}."address_master_id", true`,
      `FROM ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
      `INNER JOIN ${q(CTE.INSERTED)} AS ${INSERTED_ALIAS} ON ${INSERTED_ALIAS}."urn" = ${classifiedOf("urn")}`,
      `WHERE ${classIs(CANDIDATE_CLASS.NEW)}`,
    ].join(" ")
  );
}

function updateCte(layouts: CompletarLayouts): string {
  const addressMasterColumn = physicalColumn(layouts.unit, COMPLETAR_UNIT_COLUMN.ID_ADDRESS_MASTER);
  return cte(
    CTE.UPDATED,
    [
      `UPDATE ${unitTableSql(layouts)} SET ${addressMasterColumn} = ${LINK_ALIAS}."address_master_id"`,
      `FROM ${q(CTE.LINKS)} AS ${LINK_ALIAS}`,
      `WHERE ${unitOf(layouts, COMPLETAR_UNIT_COLUMN.ID)} = ${LINK_ALIAS}."unit_id"`,
      `AND ${unitOf(layouts, COMPLETAR_UNIT_COLUMN.ID_ADDRESS_MASTER)} IS NULL`,
      `RETURNING ${unitOf(layouts, COMPLETAR_UNIT_COLUMN.ID)} AS "unit_id", ${unitOf(layouts, COMPLETAR_UNIT_COLUMN.ID_ADDRESS_MASTER)} AS "address_master_id"`,
    ].join(" ")
  );
}

const linkedListSql = [
  `SELECT ${UPDATED_ALIAS}."unit_id" AS "id", ${classifiedOf("name")} AS "name", ${classifiedOf("province_id")} AS "provinceId",`,
  `${UPDATED_ALIAS}."address_master_id" AS "addressMasterId", ${LINK_ALIAS}."created" AS "created"`,
  `FROM ${q(CTE.UPDATED)} AS ${UPDATED_ALIAS}`,
  `INNER JOIN ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS} ON ${classifiedOf("unit_id")} = ${UPDATED_ALIAS}."unit_id"`,
  `INNER JOIN ${q(CTE.LINKS)} AS ${LINK_ALIAS} ON ${LINK_ALIAS}."unit_id" = ${UPDATED_ALIAS}."unit_id"`,
  `ORDER BY ${UPDATED_ALIAS}."unit_id" LIMIT ${DETAIL_LIST_LIMIT}`,
].join(" ");

export function buildCompletarApplySql(layouts: CompletarLayouts): string {
  return [
    withClause([...classifyCtes(layouts), insertCte(layouts), linksCte(), updateCte(layouts)]),
    "SELECT",
    `(SELECT count(*) FROM ${q(CTE.INSERTED)}) AS "created",`,
    `(SELECT count(*) FROM ${q(CTE.UPDATED)}) AS "linked",`,
    `${jsonArrayOf(linkedListSql, "linked_list")} AS "linked_list"`,
  ].join(" ");
}

export function buildCompletarRemainingSql(layouts: CompletarLayouts): string {
  return `SELECT count(*) AS "remaining" FROM ${unitTableSql(layouts)} WHERE ${unitOf(layouts, COMPLETAR_UNIT_COLUMN.ID_ADDRESS_MASTER)} IS NULL`;
}
