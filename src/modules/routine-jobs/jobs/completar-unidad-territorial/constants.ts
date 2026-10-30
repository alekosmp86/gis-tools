import { ADDRESS_MASTER_REQUIRED_COLUMNS, UNIT_SUBJECT_SPEC } from "../shared/addressMasterLinkSpec";

export const TERRITORIAL_UNIT_VIEW_NAME = "mv_territorial_unit_full";

export const COMPLETAR_TABLE_ROLE = {
  UNIT: "completar-unidades",
  ADDRESS_MASTER: "completar-direcciones-maestras",
} as const;

export type CompletarTableRole = (typeof COMPLETAR_TABLE_ROLE)[keyof typeof COMPLETAR_TABLE_ROLE];

export const COMPLETAR_REQUIRED_COLUMNS_BY_ROLE: Record<CompletarTableRole, readonly string[]> = {
  [COMPLETAR_TABLE_ROLE.UNIT]: UNIT_SUBJECT_SPEC.requiredColumns,
  [COMPLETAR_TABLE_ROLE.ADDRESS_MASTER]: ADDRESS_MASTER_REQUIRED_COLUMNS,
};
