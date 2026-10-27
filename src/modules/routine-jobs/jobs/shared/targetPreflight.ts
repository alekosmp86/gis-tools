import { buildQualifiedTableLabel, resolveSchemaName } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { qualifiedName, type TableLayout } from "../actualizar-padron/domain/layouts";
import { parseSequenceName } from "../actualizar-padron/domain/sequenceReference";
import { readTargetStructure } from "./tableFacts";
import { idSequenceIssues, inheritanceIssues, notNullIssues, relationFactIssues, relationKindIssues } from "./targetIssues";
import type { WritableTargetLayout } from "./tableResolution";

const PRIVILEGE_SQL =
  "SELECT has_table_privilege(current_user, format('%I.%I', $1::text, $2::text), $3::text) AS has_privilege";
const SEQUENCE_PRIVILEGE_SQL = "SELECT has_sequence_privilege(current_user, $1::text, 'UPDATE') AS has_privilege";

const WRITE_PRIVILEGES: readonly string[] = ["INSERT", "UPDATE", "SELECT"];
export const READ_PRIVILEGES: readonly string[] = ["SELECT"];

export const labelOf = (layout: TableLayout): string => buildQualifiedTableLabel(layout.schema, layout.table);

const writtenPhysicalColumns = (target: WritableTargetLayout, logicalColumns: readonly string[]): string[] =>
  logicalColumns.map((logical) => target.columns[logical]).filter((column): column is string => column !== undefined);

export async function targetStructureIssuesOf(
  session: CatalogQuerySession,
  target: WritableTargetLayout,
  writtenLogical: readonly string[],
  title: string
): Promise<string[]> {
  const label = labelOf(target);
  const structure = await readTargetStructure(session, target, label);
  return [
    ...relationKindIssues(title, label, structure.relkind),
    ...inheritanceIssues(title, structure),
    ...relationFactIssues(title, structure),
    ...idSequenceIssues(label, target.idColumn, target.idSequence),
    ...notNullIssues(label, target.catalog, target.identityColumns, writtenPhysicalColumns(target, writtenLogical)),
  ];
}

async function hasTablePrivilege(session: CatalogQuerySession, layout: TableLayout, privilege: string): Promise<boolean> {
  const result = await session.query(PRIVILEGE_SQL, [resolveSchemaName(layout.schema), layout.table, privilege]);
  return Boolean(result.rows[0]?.has_privilege);
}

export async function tablePrivilegeIssues(
  session: CatalogQuerySession,
  layout: TableLayout,
  privileges: readonly string[]
): Promise<string[]> {
  const issues: string[] = [];
  for (const privilege of privileges) {
    if (!(await hasTablePrivilege(session, layout, privilege))) {
      issues.push(`No tiene privilegio ${privilege} sobre la tabla ${labelOf(layout)}.`);
    }
  }
  return issues;
}

async function sequenceIssuesOf(session: CatalogQuerySession, target: WritableTargetLayout): Promise<string[]> {
  if (target.idSequence === null) return [];
  const result = await session.query(SEQUENCE_PRIVILEGE_SQL, [target.idSequence]);
  if (result.rows[0]?.has_privilege) return [];
  const sequence = parseSequenceName(target.idSequence);
  const name = sequence === undefined ? target.idSequence : `${sequence.schema ?? target.schema}.${sequence.name}`;
  return [`No tiene privilegio UPDATE sobre la secuencia ${name}, necesario para ajustar los ids de ${labelOf(target)}.`];
}

export async function writeTargetPrivilegeIssues(
  session: CatalogQuerySession,
  target: WritableTargetLayout
): Promise<string[]> {
  return [
    ...(await tablePrivilegeIssues(session, target, WRITE_PRIVILEGES)),
    ...(await sequenceIssuesOf(session, target)),
  ];
}

export async function hasRows(session: CatalogQuerySession, layout: TableLayout): Promise<boolean> {
  const result = await session.query(`SELECT EXISTS (SELECT 1 FROM ${qualifiedName(layout)}) AS present`);
  return Boolean(result.rows[0]?.present);
}
