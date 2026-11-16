import { quoteIdentifier, resolveSchemaName } from "@/core/services/sqlStatements";
import { parseSequenceName } from "../../actualizar-padron/domain/sequenceReference";
import type { WritableTargetLayout } from "../../shared/tableResolution";
import { EJES_TABLE_ROLE } from "../constants";
import type { EjesLayouts, EjesLoadContext, EjesLoadRole, EjesTables } from "../types";

const GEOMETRY_TYPE_PREFIX = "geometry";

export function ejesLoadContextOf(
  layouts: EjesLayouts,
  tables: EjesTables,
  writeTargets: readonly WritableTargetLayout[]
): EjesLoadContext {
  const targetOf = (role: EjesLoadRole): WritableTargetLayout => {
    const ref = tables[role];
    const target = writeTargets.find((entry) => entry.schema === ref.schema && entry.table === ref.table);
    if (target === undefined) throw new Error(`Falta la tabla de escritura ${ref.schema}.${ref.table}.`);
    return target;
  };
  return {
    layouts,
    targets: {
      [EJES_TABLE_ROLE.ROAD_SECTION]: targetOf(EJES_TABLE_ROLE.ROAD_SECTION),
      [EJES_TABLE_ROLE.CIRCULATION_WAY]: targetOf(EJES_TABLE_ROLE.CIRCULATION_WAY),
      [EJES_TABLE_ROLE.ADDRESS_MASTER]: targetOf(EJES_TABLE_ROLE.ADDRESS_MASTER),
      [EJES_TABLE_ROLE.ACCESS_POINT]: targetOf(EJES_TABLE_ROLE.ACCESS_POINT),
      [EJES_TABLE_ROLE.VERTICES]: targetOf(EJES_TABLE_ROLE.VERTICES),
    },
  };
}

const sqlTypeOf = (target: WritableTargetLayout, logical: string): string | undefined => {
  const physical = target.columns[logical];
  const dataType = target.catalog.find((entry) => entry.column_name === physical)?.data_type;
  if (dataType === undefined || dataType === "" || dataType.toLowerCase().startsWith(GEOMETRY_TYPE_PREFIX)) return undefined;
  if (dataType.toUpperCase() === "USER-DEFINED") return undefined;
  return dataType;
};

const INTEGER_TYPE_RANGE: Partial<Record<string, readonly [string, string]>> = {
  smallint: ["-32768", "32767"],
  integer: ["-2147483648", "2147483647"],
  bigint: ["-9223372036854775808", "9223372036854775807"],
};

export interface IntegerColumn {
  type: string;
  min: string;
  max: string;
}

/** The real integer type of a target column and its bounds; undefined when the column is not an integer type. */
export function integerColumnOf(context: EjesLoadContext, role: EjesLoadRole, logical: string): IntegerColumn | undefined {
  const type = sqlTypeOf(context.targets[role], logical);
  const range = type === undefined ? undefined : INTEGER_TYPE_RANGE[type.toLowerCase()];
  return type === undefined || range === undefined ? undefined : { type, min: range[0], max: range[1] };
}

/** Casts a value to the real type of a target column, so text values land in integer or numeric columns. */
export function typedAs(context: EjesLoadContext, role: EjesLoadRole, logical: string, expression: string): string {
  const type = sqlTypeOf(context.targets[role], logical);
  return type === undefined ? `(${expression})` : `(${expression})::${type}`;
}

export const physicalOf = (context: EjesLoadContext, role: EjesLoadRole, logical: string): string => {
  const physical = context.targets[role].columns[logical];
  if (physical === undefined) throw new Error(`Falta la columna resuelta "${logical}".`);
  return quoteIdentifier(physical);
};

/** The physical name as written in the catalog, unquoted: for the text arguments of pgRouting functions. */
export const rawOf = (context: EjesLoadContext, role: EjesLoadRole, logical: string): string => {
  const physical = context.targets[role].columns[logical];
  if (physical === undefined) throw new Error(`Falta la columna resuelta "${logical}".`);
  return physical;
};

export const qualifiedOf = (context: EjesLoadContext, role: EjesLoadRole): string => {
  const target = context.targets[role];
  return `${quoteIdentifier(resolveSchemaName(target.schema))}.${quoteIdentifier(target.table)}`;
};

export function nextvalSql(context: EjesLoadContext, role: EjesLoadRole): string {
  const target = context.targets[role];
  const sequence = parseSequenceName(target.idSequence);
  if (sequence === undefined) throw new Error(`La tabla ${target.schema}.${target.table} no tiene secuencia para asignar ids.`);
  const name = `${quoteIdentifier(sequence.schema ?? resolveSchemaName(target.schema))}.${quoteIdentifier(sequence.name)}`;
  return `nextval('${name.replace(/'/g, "''")}'::regclass)`;
}
