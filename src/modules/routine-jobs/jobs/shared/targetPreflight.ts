import { buildQualifiedTableLabel, quoteIdentifier, resolveSchemaName } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { qualifiedName, type TableLayout } from "../actualizar-padron/domain/layouts";
import { parseSequenceName } from "../actualizar-padron/domain/sequenceReference";
import { readTargetStructure } from "./tableFacts";
import { idSequenceIssues, inheritanceIssues, notNullIssues, relationFactIssues, relationKindIssues } from "./targetIssues";
import type { WritableTargetLayout } from "./tableResolution";

const PRIVILEGE_SQL =
  "SELECT has_table_privilege(current_user, format('%I.%I', $1::text, $2::text), $3::text) AS has_privilege";
const SEQUENCE_UPDATE_SQL = "SELECT has_sequence_privilege(current_user, $1::text, 'UPDATE') AS has_privilege";
const SEQUENCE_USE_SQL = "SELECT has_sequence_privilege(current_user, $1::text, 'USAGE,UPDATE') AS has_privilege";
const SEQUENCE_STATE_SQL =
  "SELECT has_sequence_privilege(current_user, $1::text, 'USAGE,SELECT') AS readable, CASE WHEN has_sequence_privilege(current_user, $1::text, 'USAGE,SELECT') THEN pg_sequence_last_value($1::text::regclass) END AS last_value";
const SEQUENCE_LOCATION_SQL =
  "SELECT n.nspname AS schema_name, c.relname AS sequence_name, has_sequence_privilege(current_user, c.oid, 'SELECT') AS can_select FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = $1::text::regclass";
const REPAIR_OPTION =`"Ajustar secuencias de destino"`;

const WRITE_PRIVILEGES: readonly string[] = ["INSERT", "UPDATE", "SELECT"];
export const READ_PRIVILEGES: readonly string[] = ["SELECT"];

export const labelOf = (layout: TableLayout): string => buildQualifiedTableLabel(layout.schema, layout.table);

const writtenPhysicalColumns = (target: WritableTargetLayout, logicalColumns: readonly string[]): string[] =>
  logicalColumns.map((logical) => target.columns[logical]).filter((column): column is string => column !== undefined);

export async function tableStructureIssuesOf(
  session: CatalogQuerySession,
  layout: TableLayout,
  title: string
): Promise<string[]> {
  const label = labelOf(layout);
  const structure = await readTargetStructure(session, layout, label);
  return [
    ...relationKindIssues(title, label, structure.relkind),
    ...inheritanceIssues(title, structure),
    ...relationFactIssues(title, structure),
  ];
}

export async function targetStructureIssuesOf(
  session: CatalogQuerySession,
  target: WritableTargetLayout,
  writtenLogical: readonly string[],
  title: string
): Promise<string[]> {
  return [
    ...(await tableStructureIssuesOf(session, target, title)),
    ...idSequenceIssues(labelOf(target), target.idColumn, target.idSequence),
    ...notNullIssues(labelOf(target), target.catalog, target.identityColumns, writtenPhysicalColumns(target, writtenLogical)),
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

const sequenceNameOf = (target: WritableTargetLayout, idSequence: string): string => {
  const sequence = parseSequenceName(idSequence);
  return sequence === undefined ? idSequence : `${sequence.schema ?? target.schema}.${sequence.name}`;
};

async function hasSequencePrivilege(session: CatalogQuerySession, sql: string, idSequence: string): Promise<boolean> {
  const result = await session.query(sql, [idSequence]);
  return Boolean(result.rows[0]?.has_privilege);
}

async function nextValueOfUncalled(session: CatalogQuerySession, idSequence: string): Promise<number> {
  const located = await session.query(SEQUENCE_LOCATION_SQL, [idSequence]);
  const row = located.rows[0];
  if (row === undefined || !row.can_select) return 1;
  const state = await session.query(
    `SELECT last_value, is_called FROM ${quoteIdentifier(String(row.schema_name))}.${quoteIdentifier(String(row.sequence_name))}`
  );
  const current = state.rows[0];
  if (current === undefined) return 1;
  return current.is_called === true ? Number(current.last_value) + 1 : Number(current.last_value);
}

async function sequenceAheadIssues(
  session: CatalogQuerySession,
  target: WritableTargetLayout,
  idSequence: string
): Promise<string[]> {
  const name = sequenceNameOf(target, idSequence);
  const label = labelOf(target);
  try {
    const state = await session.query(SEQUENCE_STATE_SQL, [idSequence]);
    if (!state.rows[0]?.readable) {
      return [`No tiene privilegio USAGE ni SELECT sobre la secuencia ${name}, necesario para comprobar que está por encima de los ids de ${label}.`];
    }
    const lastValue = state.rows[0]?.last_value;
    const next =
      lastValue === null || lastValue === undefined
        ? await nextValueOfUncalled(session, idSequence)
        : Number(lastValue) + 1;
    const maxima = await session.query(`SELECT max(${quoteIdentifier(target.idColumn)}) AS max_id FROM ${qualifiedName(target)}`);
    const maxId = maxima.rows[0]?.max_id;
    if (maxId === null || maxId === undefined || next > Number(maxId)) return [];
    return [
      `La secuencia ${name} está en ${next} y la tabla ${label} ya tiene ids hasta ${Number(maxId)}: active ${REPAIR_OPTION} para ajustarla antes de escribir.`,
    ];
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    return [`No se pudo leer la secuencia ${name} para comprobar los ids de ${label}: ${reason}`];
  }
}

/** With the repair on the job runs setval (UPDATE); with it off it only calls nextval (USAGE or UPDATE); the state check is sequenceStateWarnings, after the classification. */
export async function sequenceIssuesOf(
  session: CatalogQuerySession,
  target: WritableTargetLayout,
  repairSequences: boolean
): Promise<string[]> {
  if (target.idSequence === null) return [];
  const name = sequenceNameOf(target, target.idSequence);
  if (repairSequences) {
    if (await hasSequencePrivilege(session, SEQUENCE_UPDATE_SQL, target.idSequence)) return [];
    return [
      `No tiene privilegio UPDATE sobre la secuencia ${name}, necesario para ajustar los ids de ${labelOf(target)}. Puede desactivar ${REPAIR_OPTION} si la secuencia ya está por encima de los ids, o solicitar el permiso.`,
    ];
  }
  if (!(await hasSequencePrivilege(session, SEQUENCE_USE_SQL, target.idSequence))) {
    return [`No tiene privilegio USAGE ni UPDATE sobre la secuencia ${name}, necesario para asignar los ids de ${labelOf(target)}.`];
  }
  return [];
}

export interface SequenceGuardInput {
  target: WritableTargetLayout;
  inserts: number;
  repairSequences: boolean;
  dryRun: boolean;
}

/** Runs after the classification, before the first write: only for a table that gets inserts and a run that does not repair. Real run throws; analysis returns warnings. */
export async function sequenceStateWarnings(session: CatalogQuerySession, input: SequenceGuardInput): Promise<string[]> {
  const { target, inserts, repairSequences, dryRun } = input;
  if (repairSequences || inserts <= 0 || target.idSequence === null) return [];
  const issues = await sequenceAheadIssues(session, target, target.idSequence);
  if (issues.length > 0 && !dryRun) throw new Error(issues.join(" "));
  return issues;
}

export async function writeTargetPrivilegeIssues(
  session: CatalogQuerySession,
  target: WritableTargetLayout,
  repairSequences: boolean
): Promise<string[]> {
  return [
    ...(await tablePrivilegeIssues(session, target, WRITE_PRIVILEGES)),
    ...(await sequenceIssuesOf(session, target, repairSequences)),
  ];
}

export async function hasRows(session: CatalogQuerySession, layout: TableLayout): Promise<boolean> {
  const result = await session.query(`SELECT EXISTS (SELECT 1 FROM ${qualifiedName(layout)}) AS present`);
  return Boolean(result.rows[0]?.present);
}
