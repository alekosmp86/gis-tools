import {
  EJES_DEFAULT_TABLES,
  EJES_LOAD_ROLES,
  EJES_REQUIRED_COLUMNS_BY_ROLE,
  EJES_ROLES,
  EJES_TABLE_ROLE,
  type EjesTableRole,
} from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { ejesLoadContextOf } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadContext";
import type { EjesLayouts, EjesLoadContext, EjesTables } from "@/modules/routine-jobs/jobs/ejes-calles/types";
import type { WritableTargetLayout } from "@/modules/routine-jobs/jobs/shared/tableResolution";

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

type LoadRole = (typeof EJES_LOAD_ROLES)[number];

/** A write target with every required column of the role, all catalog columns integer and no sequence: the shape the load SQL reads. */
const writeTargetOf = (role: LoadRole): WritableTargetLayout => {
  const layout = ejesLayouts()[role];
  const columns = EJES_REQUIRED_COLUMNS_BY_ROLE[role];
  return {
    ...layout,
    srid: 32721,
    idColumn: columns[0],
    idSequence: null,
    identityColumns: [],
    catalog: columns.map((column) => ({ column_name: column, data_type: "integer", is_nullable: true, column_default: null })),
  };
};

/**
 * The load context of the default tables, with the given patches applied to the write targets. A patched schema or table is
 * followed by the tables map, so the context still finds its targets.
 */
export const ejesLoadContextFixture = (...patches: Array<[LoadRole, Partial<WritableTargetLayout>]>): EjesLoadContext => {
  const targets = EJES_LOAD_ROLES.map((role) => {
    const patch = patches
      .filter(([patchRole]) => patchRole === role)
      .reduce<Partial<WritableTargetLayout>>((merged, [, next]) => ({ ...merged, ...next }), {});
    return { ...writeTargetOf(role), ...patch };
  });
  const tables = {
    ...ejesTables(),
    ...Object.fromEntries(targets.map((target, index) => [EJES_LOAD_ROLES[index], { schema: target.schema, table: target.table }])),
  } as EjesTables;
  return ejesLoadContextOf(ejesLayouts(), tables, targets);
};

/** Physical column names of the road section table, for a patch that renames them. */
export const roadColumnsPatch = (columns: Record<string, string>): Partial<WritableTargetLayout> => ({
  columns: { ...ejesLayouts()[EJES_TABLE_ROLE.ROAD_SECTION].columns, ...columns },
});
