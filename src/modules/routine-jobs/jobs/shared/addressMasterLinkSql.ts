import { physicalColumn, qualifiedName, type TableLayout } from "../actualizar-padron/domain/layouts";
import { cte, jsonArrayOf, literal, q, withClause } from "./sqlFragments";
import { DETAIL_LIST_LIMIT, SAMPLE_LIMIT } from "./limits";
import {
  ADDRESS_MASTER_COLUMN,
  ADDRESS_MASTER_INITIAL_COORDINATE,
  type AddressMasterSubjectSpec,
} from "./addressMasterLinkSpec";

export interface AddressMasterLinkLayouts {
  subject: TableLayout;
  addressMaster: TableLayout;
}

interface LinkPass {
  layouts: AddressMasterLinkLayouts;
  spec: AddressMasterSubjectSpec;
}

const SUBJECT_ALIAS = "sj";
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

const subjectOf = (pass: LinkPass, logical: string): string =>
  `${SUBJECT_ALIAS}.${physicalColumn(pass.layouts.subject, logical)}`;
const addressMasterOf = (pass: LinkPass, logical: string): string =>
  `${ADDRESS_MASTER_ALIAS}.${physicalColumn(pass.layouts.addressMaster, logical)}`;
const classifiedOf = (column: string): string => `${CLASSIFIED_ALIAS}.${q(column)}`;
const classIs = (value: string): string => `${classifiedOf("class")} = ${literal(value)}`;

const subjectTableSql = (pass: LinkPass): string => `${qualifiedName(pass.layouts.subject)} AS ${SUBJECT_ALIAS}`;
const addressMasterTableSql = (pass: LinkPass): string =>
  `${qualifiedName(pass.layouts.addressMaster)} AS ${ADDRESS_MASTER_ALIAS}`;

const nameSqlOf = (pass: LinkPass): string =>
  pass.spec.nameColumn === null ? "NULL::text" : subjectOf(pass, pass.spec.nameColumn);
const provinceSqlOf = (pass: LinkPass): string =>
  pass.spec.provinceColumn === null ? "NULL::text" : `${subjectOf(pass, pass.spec.provinceColumn)}::text`;

function candidatesCte(pass: LinkPass): string {
  const subjectId = subjectOf(pass, pass.spec.idColumn);
  return cte(
    CTE.CANDIDATES,
    [
      `SELECT ${subjectId} AS "subject_id", ${nameSqlOf(pass)} AS "name", ${provinceSqlOf(pass)} AS "province_id",`,
      `concat(${literal(pass.spec.urnPrefix)}, ${subjectId}) AS "urn"`,
      `FROM ${subjectTableSql(pass)} WHERE ${subjectOf(pass, pass.spec.addressMasterColumn)} IS NULL`,
    ].join(" ")
  );
}

function matchesCte(pass: LinkPass): string {
  const addressMasterId = addressMasterOf(pass, ADDRESS_MASTER_COLUMN.ID);
  const groupColumns = ["subject_id", "urn"].map((column) => `${CANDIDATE_ALIAS}.${q(column)}`);
  return cte(
    CTE.MATCHES,
    [
      `SELECT ${groupColumns.join(", ")}, min(${CANDIDATE_ALIAS}."name") AS "name", min(${CANDIDATE_ALIAS}."province_id") AS "province_id",`,
      `count(${addressMasterId}) AS "records", min(${addressMasterId}) AS "address_master_id"`,
      `FROM ${q(CTE.CANDIDATES)} AS ${CANDIDATE_ALIAS}`,
      `LEFT JOIN ${addressMasterTableSql(pass)} ON ${addressMasterOf(pass, ADDRESS_MASTER_COLUMN.URN)} = ${CANDIDATE_ALIAS}."urn"`,
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

const classifyCtes = (pass: LinkPass): string[] => [candidatesCte(pass), matchesCte(pass), classifiedCte()];

const ambiguousSamplesSql = [
  `SELECT ${classifiedOf("subject_id")} AS "id", ${classifiedOf("name")} AS "name",`,
  `${classifiedOf("province_id")} AS "provinceId", ${classifiedOf("records")} AS "records"`,
  `FROM ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS} WHERE ${classIs(CANDIDATE_CLASS.AMBIGUOUS)}`,
  `ORDER BY ${classifiedOf("subject_id")} LIMIT ${SAMPLE_LIMIT}`,
].join(" ");

export function buildAddressMasterClassifySql(
  layouts: AddressMasterLinkLayouts,
  spec: AddressMasterSubjectSpec
): string {
  return [
    withClause(classifyCtes({ layouts, spec })),
    "SELECT",
    `count(*) AS "without_address_master",`,
    `count(*) FILTER (WHERE ${classIs(CANDIDATE_CLASS.NEW)}) AS "to_create",`,
    `count(*) FILTER (WHERE ${classIs(CANDIDATE_CLASS.EXISTING)}) AS "already_had_record",`,
    `count(*) FILTER (WHERE ${classIs(CANDIDATE_CLASS.AMBIGUOUS)}) AS "ambiguous",`,
    `${jsonArrayOf(ambiguousSamplesSql, "ambiguous_samples")} AS "ambiguous_samples"`,
    `FROM ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
  ].join(" ");
}

function insertCte(pass: LinkPass): string {
  const columns = [ADDRESS_MASTER_COLUMN.URN, ADDRESS_MASTER_COLUMN.LATITUDE, ADDRESS_MASTER_COLUMN.LONGITUDE]
    .map((logical) => physicalColumn(pass.layouts.addressMaster, logical))
    .join(", ");
  return cte(
    CTE.INSERTED,
    [
      `INSERT INTO ${qualifiedName(pass.layouts.addressMaster)} (${columns})`,
      `SELECT ${classifiedOf("urn")}, ${ADDRESS_MASTER_INITIAL_COORDINATE}, ${ADDRESS_MASTER_INITIAL_COORDINATE}`,
      `FROM ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
      `WHERE ${classIs(CANDIDATE_CLASS.NEW)} ORDER BY ${classifiedOf("subject_id")}`,
      `RETURNING ${physicalColumn(pass.layouts.addressMaster, ADDRESS_MASTER_COLUMN.ID)} AS "address_master_id",`,
      `${physicalColumn(pass.layouts.addressMaster, ADDRESS_MASTER_COLUMN.URN)} AS "urn"`,
    ].join(" ")
  );
}

function linksCte(): string {
  return cte(
    CTE.LINKS,
    [
      `SELECT ${classifiedOf("subject_id")} AS "subject_id", ${classifiedOf("address_master_id")} AS "address_master_id", false AS "created"`,
      `FROM ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS} WHERE ${classIs(CANDIDATE_CLASS.EXISTING)}`,
      `UNION ALL`,
      `SELECT ${classifiedOf("subject_id")}, ${INSERTED_ALIAS}."address_master_id", true`,
      `FROM ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS}`,
      `INNER JOIN ${q(CTE.INSERTED)} AS ${INSERTED_ALIAS} ON ${INSERTED_ALIAS}."urn" = ${classifiedOf("urn")}`,
      `WHERE ${classIs(CANDIDATE_CLASS.NEW)}`,
    ].join(" ")
  );
}

function updateCte(pass: LinkPass): string {
  const addressMasterColumn = physicalColumn(pass.layouts.subject, pass.spec.addressMasterColumn);
  return cte(
    CTE.UPDATED,
    [
      `UPDATE ${subjectTableSql(pass)} SET ${addressMasterColumn} = ${LINK_ALIAS}."address_master_id"`,
      `FROM ${q(CTE.LINKS)} AS ${LINK_ALIAS}`,
      `WHERE ${subjectOf(pass, pass.spec.idColumn)} = ${LINK_ALIAS}."subject_id"`,
      `AND ${subjectOf(pass, pass.spec.addressMasterColumn)} IS NULL`,
      `RETURNING ${subjectOf(pass, pass.spec.idColumn)} AS "subject_id", ${subjectOf(pass, pass.spec.addressMasterColumn)} AS "address_master_id"`,
    ].join(" ")
  );
}

const linkedListSql = [
  `SELECT ${UPDATED_ALIAS}."subject_id" AS "id", ${classifiedOf("name")} AS "name", ${classifiedOf("province_id")} AS "provinceId",`,
  `${UPDATED_ALIAS}."address_master_id" AS "addressMasterId", ${LINK_ALIAS}."created" AS "created"`,
  `FROM ${q(CTE.UPDATED)} AS ${UPDATED_ALIAS}`,
  `INNER JOIN ${q(CTE.CLASSIFIED)} AS ${CLASSIFIED_ALIAS} ON ${classifiedOf("subject_id")} = ${UPDATED_ALIAS}."subject_id"`,
  `INNER JOIN ${q(CTE.LINKS)} AS ${LINK_ALIAS} ON ${LINK_ALIAS}."subject_id" = ${UPDATED_ALIAS}."subject_id"`,
  `ORDER BY ${UPDATED_ALIAS}."subject_id" LIMIT ${DETAIL_LIST_LIMIT}`,
].join(" ");

export function buildAddressMasterApplySql(layouts: AddressMasterLinkLayouts, spec: AddressMasterSubjectSpec): string {
  const pass: LinkPass = { layouts, spec };
  return [
    withClause([...classifyCtes(pass), insertCte(pass), linksCte(), updateCte(pass)]),
    "SELECT",
    `(SELECT count(*) FROM ${q(CTE.INSERTED)}) AS "created",`,
    `(SELECT count(*) FROM ${q(CTE.UPDATED)}) AS "linked",`,
    `${jsonArrayOf(linkedListSql, "linked_list")} AS "linked_list"`,
  ].join(" ");
}

export function buildAddressMasterRemainingSql(layouts: AddressMasterLinkLayouts, spec: AddressMasterSubjectSpec): string {
  const pass: LinkPass = { layouts, spec };
  return `SELECT count(*) AS "remaining" FROM ${subjectTableSql(pass)} WHERE ${subjectOf(pass, spec.addressMasterColumn)} IS NULL`;
}
