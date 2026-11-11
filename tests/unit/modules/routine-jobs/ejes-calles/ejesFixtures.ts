import {
  EJES_DEFAULT_TABLES,
  EJES_REQUIRED_COLUMNS_BY_ROLE,
  EJES_ROLES,
  type EjesTableRole,
} from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import type { EjesLayouts, EjesTables } from "@/modules/routine-jobs/jobs/ejes-calles/types";

export const ejesLayouts = (): EjesLayouts =>
  Object.fromEntries(
    EJES_ROLES.map((role) => [
      role,
      {
        ...EJES_DEFAULT_TABLES[role],
        columns: Object.fromEntries(EJES_REQUIRED_COLUMNS_BY_ROLE[role].map((column) => [column, column])),
      },
    ])
  ) as EjesLayouts;

export const ejesTables = (): EjesTables =>
  Object.fromEntries(EJES_ROLES.map((role) => [role, { ...EJES_DEFAULT_TABLES[role] }])) as EjesTables;

export const ejesTablesBody = (): Record<EjesTableRole, { schema: string; table: string }> => ejesTables();
