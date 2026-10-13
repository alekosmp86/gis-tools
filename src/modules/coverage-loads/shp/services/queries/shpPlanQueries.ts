import type { Queryable } from "../../../shared/pgClient";
import { findPrivilegeShortfalls } from "../../../shared/tablePrivileges";
import {
  ADVISORY_LOCK_ID_BY_TABLE,
  ADVISORY_LOCK_NAMESPACE,
  SCHEMA_PRIVILEGE_REQUIRED,
  TABLE_PRIVILEGES_REQUIRED,
  TARGET_SCHEMA,
} from "../../constants";
import { stageTableName, workTableName } from "../../job/constants.ts";
import type { ShpTable } from "../../job/types.ts";

/** Fixed statements. Table names come from the closed `ShpTable` set, never from the request. */

const SCHEMA_CREATE_SQL = "SELECT has_schema_privilege(current_user, $1::text, $2::text) AS granted";
const POSTGIS_SQL = "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') AS available";
const LEFTOVERS_SQL = `
SELECT c.relname
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1::text AND c.relname = ANY($2::text[]) AND c.relkind IN ('r', 'p')
ORDER BY c.relname
`;
/** Looks at the lock table only: it never takes the lock, so nothing is held or released. */
const ADVISORY_LOCK_HELD_SQL = `
SELECT EXISTS (
  SELECT 1 FROM pg_locks
  WHERE locktype = 'advisory' AND objsubid = 2 AND granted
    AND classid = $1::int::oid AND objid = $2::int::oid
    AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
) AS held
`;

function firstRow(rows: ReadonlyArray<unknown>): Record<string, unknown> {
  return (rows[0] ?? {}) as Record<string, unknown>;
}

function qualified(table: ShpTable): string {
  return `${TARGET_SCHEMA}.${table}`;
}

export async function readMissingTablePrivileges(queryable: Queryable, table: ShpTable) {
  const shortfalls = await findPrivilegeShortfalls(queryable, [
    { table: qualified(table), privileges: TABLE_PRIVILEGES_REQUIRED },
  ]);
  const shortfall = shortfalls[0];
  return { tableExists: shortfall?.tableExists ?? true, missing: shortfall?.missing ?? [] };
}

export async function readSchemaCreateGranted(queryable: Queryable): Promise<boolean> {
  const result = await queryable.query(SCHEMA_CREATE_SQL, [TARGET_SCHEMA, SCHEMA_PRIVILEGE_REQUIRED]);
  return firstRow(result.rows).granted === true;
}

export async function readPostgisAvailable(queryable: Queryable): Promise<boolean> {
  const result = await queryable.query(POSTGIS_SQL, []);
  return firstRow(result.rows).available === true;
}

export async function readLeftovers(queryable: Queryable, table: ShpTable): Promise<string[]> {
  const names = [stageTableName(table), workTableName(table)];
  const result = await queryable.query(LEFTOVERS_SQL, [TARGET_SCHEMA, names]);
  return result.rows.map((row) => String((row as Record<string, unknown>).relname));
}

export async function readAdvisoryLockHeld(queryable: Queryable, table: ShpTable): Promise<boolean> {
  const result = await queryable.query(ADVISORY_LOCK_HELD_SQL, [ADVISORY_LOCK_NAMESPACE, ADVISORY_LOCK_ID_BY_TABLE[table]]);
  return firstRow(result.rows).held === true;
}

/** A plain count: no geometry scan, no vertex count. */
export async function readRowCount(queryable: Queryable, table: ShpTable): Promise<number> {
  const result = await queryable.query(`SELECT count(*)::text AS total FROM ${qualified(table)}`, []);
  return Number(firstRow(result.rows).total ?? 0);
}
