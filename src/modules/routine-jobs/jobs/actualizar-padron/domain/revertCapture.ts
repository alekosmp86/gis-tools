import { ADDRESS_MASTER_COLUMN, PADRON_SUBJECT_SPEC } from "../../shared/addressMasterLinkSpec";
import { literal, q } from "../../shared/sqlFragments";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { DESTINATION_COLUMN } from "../constants";
import { physicalColumn, qualifiedName } from "./layouts";

export const REVERT_KIND = {
  UPDATED: "U",
  PAIRED: "P",
  INSERTED: "I",
  ADDRESS_MASTER_LINK: "A",
} as const;

export type RevertKind = (typeof REVERT_KIND)[keyof typeof REVERT_KIND];

export const REVERT_KINDS: readonly RevertKind[] = Object.values(REVERT_KIND);

export const REVERT_COLUMN = {
  KIND: "kind",
  ID: "id",
  TYPE_PADRON: "type_padron",
  LOCALITY: "id_cadastral_locality",
  NUMBER: "number",
  GEOMETRY: "geometry",
} as const;

const REVERT_COLUMN_ORDER: readonly string[] = [
  REVERT_COLUMN.KIND,
  REVERT_COLUMN.ID,
  REVERT_COLUMN.TYPE_PADRON,
  REVERT_COLUMN.LOCALITY,
  REVERT_COLUMN.NUMBER,
  REVERT_COLUMN.GEOMETRY,
];

const REVERT_TABLE_NAME = "padron_revert";
export const REVERT_TABLE_SQL = `pg_temp.${q(REVERT_TABLE_NAME)}`;

const TARGET_ALIAS = "t";
const ADDRESS_MASTER_ALIAS = "am";

export function buildCreateRevertTableSql(): string {
  const columns = [
    `${q(REVERT_COLUMN.KIND)} char(1) NOT NULL`,
    `${q(REVERT_COLUMN.ID)} integer NOT NULL`,
    `${q(REVERT_COLUMN.TYPE_PADRON)} varchar`,
    `${q(REVERT_COLUMN.LOCALITY)} integer`,
    `${q(REVERT_COLUMN.NUMBER)} varchar`,
    `${q(REVERT_COLUMN.GEOMETRY)} geometry`,
  ];
  return `CREATE TEMP TABLE ${q(REVERT_TABLE_NAME)} (${columns.join(", ")}) ON COMMIT DROP;`;
}

export const revertColumnList = (): string => REVERT_COLUMN_ORDER.map((column) => q(column)).join(", ");

export const buildRevertIndexSql = (): string =>
  `CREATE INDEX ON ${REVERT_TABLE_SQL} (${q(REVERT_COLUMN.KIND)}, ${q(REVERT_COLUMN.ID)});`;

/** Destination rows without an address master record, before the link pass changes them. */
export function buildCaptureAddressMasterSql(target: WritableTargetLayout): string {
  const idColumn = physicalColumn(target, DESTINATION_COLUMN.ID);
  const addressMasterColumn = physicalColumn(target, PADRON_SUBJECT_SPEC.addressMasterColumn);
  return [
    `INSERT INTO ${REVERT_TABLE_SQL} (${q(REVERT_COLUMN.KIND)}, ${q(REVERT_COLUMN.ID)})`,
    `SELECT ${literal(REVERT_KIND.ADDRESS_MASTER_LINK)}, ${TARGET_ALIAS}.${idColumn}`,
    `FROM ${qualifiedName(target)} AS ${TARGET_ALIAS}`,
    `WHERE ${TARGET_ALIAS}.${addressMasterColumn} IS NULL;`,
  ].join(" ");
}

export function buildMaxAddressMasterIdSql(addressMaster: WritableTargetLayout): string {
  const idColumn = physicalColumn(addressMaster, ADDRESS_MASTER_COLUMN.ID);
  return `SELECT COALESCE(max(${ADDRESS_MASTER_ALIAS}.${idColumn}), 0) AS "max_id" FROM ${qualifiedName(addressMaster)} AS ${ADDRESS_MASTER_ALIAS}`;
}
