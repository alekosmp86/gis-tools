import type { Queryable } from "./pgClient";

export interface PrivilegeRequirement {
  /** Schema-qualified table name. */
  readonly table: string;
  /** Privilege names as `has_table_privilege` spells them: SELECT, INSERT, UPDATE, DELETE... */
  readonly privileges: ReadonlyArray<string>;
}

export interface PrivilegeShortfall {
  readonly table: string;
  readonly tableExists: boolean;
  /** Privileges the current user lacks; empty when the table does not exist. */
  readonly missing: ReadonlyArray<string>;
}

export const TABLE_PRIVILEGE_SQL = `
SELECT to_regclass($1::text) IS NOT NULL AS table_exists,
       COALESCE(has_table_privilege(to_regclass($1::text)::oid, $2::text), false) AS granted
`;

async function checkPrivilege(queryable: Queryable, table: string, privilege: string) {
  const result = await queryable.query(TABLE_PRIVILEGE_SQL, [table, privilege]);
  const row = (result.rows[0] ?? {}) as Record<string, unknown>;
  return { tableExists: row.table_exists === true, granted: row.granted === true };
}

async function checkRequirement(
  queryable: Queryable,
  requirement: PrivilegeRequirement
): Promise<PrivilegeShortfall | null> {
  const missing: string[] = [];
  let tableExists = true;
  for (const privilege of requirement.privileges) {
    const outcome = await checkPrivilege(queryable, requirement.table, privilege);
    tableExists = outcome.tableExists;
    if (!tableExists) break;
    if (!outcome.granted) missing.push(privilege);
  }
  if (tableExists && missing.length === 0) return null;
  return { table: requirement.table, tableExists, missing: tableExists ? missing : [] };
}

/** Everything the current user is not allowed to do, up front, so a load fails before writing anything. */
export async function findPrivilegeShortfalls(
  queryable: Queryable,
  requirements: ReadonlyArray<PrivilegeRequirement>
): Promise<PrivilegeShortfall[]> {
  const shortfalls: PrivilegeShortfall[] = [];
  for (const requirement of requirements) {
    const shortfall = await checkRequirement(queryable, requirement);
    if (shortfall) shortfalls.push(shortfall);
  }
  return shortfalls;
}

export function describeShortfall(shortfall: PrivilegeShortfall): string {
  if (!shortfall.tableExists) return `La tabla ${shortfall.table} no existe en esta base de datos.`;
  return `Faltan privilegios sobre ${shortfall.table}: ${shortfall.missing.join(", ")}.`;
}
