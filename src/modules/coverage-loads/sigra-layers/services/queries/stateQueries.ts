import { SqlPrivilege } from "../../constants";
import { quoteIdentifier, quoteQualified } from "./identifiers";

export const CAN_CREATE_TEMP_SQL = "SELECT has_database_privilege(current_database(), 'TEMP') AS allowed";

export const AUDIT_AVAILABLE_SQL = `
SELECT COALESCE(
  to_regclass($1::text) IS NOT NULL
  AND has_table_privilege(to_regclass($1::text)::oid, '${SqlPrivilege.SELECT}')
  AND has_table_privilege(to_regclass($1::text)::oid, '${SqlPrivilege.INSERT}')
  AND has_table_privilege(to_regclass($1::text)::oid, '${SqlPrivilege.UPDATE}'),
  false
) AS available
`;

export const SERIAL_SEQUENCES_SQL = `
SELECT quote_ident(namespace.nspname) || '.' || quote_ident(sequence.relname) AS sequence_name,
       has_sequence_privilege(sequence.oid, '${SqlPrivilege.USAGE}') AS granted
FROM pg_depend dependency
INNER JOIN pg_class sequence ON sequence.oid = dependency.objid AND sequence.relkind = 'S'
INNER JOIN pg_namespace namespace ON namespace.oid = sequence.relnamespace
WHERE dependency.refobjid = to_regclass($1::text)::oid
  AND dependency.classid = 'pg_class'::regclass
  AND dependency.refclassid = 'pg_class'::regclass
  AND dependency.deptype IN ('a', 'i')
ORDER BY sequence.relname
`;

export function tableStatsSql(table: string, dateColumn: string): string {
  return `
SELECT count(*)::int AS row_count,
       left(max(${quoteIdentifier(dateColumn)})::text, 10) AS last_updated
FROM ${quoteQualified(table)}
`;
}

export function countRowsSql(table: string): string {
  return `SELECT count(*)::int AS total FROM ${quoteQualified(table)}`;
}
