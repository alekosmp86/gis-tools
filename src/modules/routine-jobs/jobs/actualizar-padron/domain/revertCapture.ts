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
  DELETED: "D",
  REASSIGNED: "R",
  MASTER_DELETED: "M",
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
  ID_PROVINCE: "id_province",
  ID_ADDRESS_MASTER: "id_address_master",
} as const;

/* AP-113 and AP-114: kind R keeps the referencing table, its primary key column and value, and the old id_padron (in id); kind M keeps the
   deleted address master row as jsonb (its id in id). `seq` orders the rows of those kinds, whose id is not unique. */
export const REVERT_EXTRA_COLUMN = {
  SEQ: "seq",
  REF_TABLE: "ref_table",
  REF_KEY_COLUMN: "ref_key_column",
  REF_KEY: "ref_key",
  PAYLOAD: "payload",
} as const;

/* id_province and id_address_master are populated only for kind D rows (AP-106): a deleted row's revert is a full INSERT,
   not a partial restore like U/P, so it needs every column the destination writes plus the address master link. */
const REVERT_COLUMN_ORDER: readonly string[] = [
  REVERT_COLUMN.KIND,
  REVERT_COLUMN.ID,
  REVERT_COLUMN.TYPE_PADRON,
  REVERT_COLUMN.LOCALITY,
  REVERT_COLUMN.NUMBER,
  REVERT_COLUMN.GEOMETRY,
  REVERT_COLUMN.ID_PROVINCE,
  REVERT_COLUMN.ID_ADDRESS_MASTER,
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
    `${q(REVERT_COLUMN.ID_PROVINCE)} integer`,
    `${q(REVERT_COLUMN.ID_ADDRESS_MASTER)} integer`,
    `${q(REVERT_EXTRA_COLUMN.SEQ)} bigint GENERATED ALWAYS AS IDENTITY`,
    `${q(REVERT_EXTRA_COLUMN.REF_TABLE)} text`,
    `${q(REVERT_EXTRA_COLUMN.REF_KEY_COLUMN)} text`,
    `${q(REVERT_EXTRA_COLUMN.REF_KEY)} text`,
    `${q(REVERT_EXTRA_COLUMN.PAYLOAD)} jsonb`,
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

/** The destination's id_address_master column, resolved even when the link option is off (AP-106 needs it to revert a deleted row
    exactly): the catalog role only requires it when linkAddressMaster is on (AP-53), so this falls back to a direct catalog lookup.
    Null only when the destination truly has no such column. */
export function optionalAddressMasterColumn(target: WritableTargetLayout): string | null {
  const resolved = target.columns[PADRON_SUBJECT_SPEC.addressMasterColumn];
  if (resolved !== undefined) return q(resolved);
  const entry = target.catalog.find((column) => column.column_name === PADRON_SUBJECT_SPEC.addressMasterColumn);
  return entry === undefined ? null : q(entry.column_name);
}
