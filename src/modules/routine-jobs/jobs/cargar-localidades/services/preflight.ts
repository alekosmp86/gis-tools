import { buildQualifiedTableLabel, resolveSchemaName } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { parseSequenceName } from "../../actualizar-padron/domain/sequenceReference";
import { TARGET_WRITTEN_COLUMNS } from "../constants";
import {
  idSequenceIssues,
  inheritanceIssues,
  notNullIssues,
  relationFactIssues,
  relationKindIssues,
} from "../domain/targetIssues";
import type { CargarLocalidadesParams, LocalityLayouts, LocalityTargetLayout } from "../types";
import { readTargetStructure, readUnsupportedSridCount } from "./tableFacts";

export const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la carga de localidades para escribir en las tablas de destino. Sin confirmación solo se permite el análisis sin cargar.";

const PRIVILEGE_SQL =
  "SELECT has_table_privilege(current_user, format('%I.%I', $1::text, $2::text), $3::text) AS has_privilege";
const SEQUENCE_PRIVILEGE_SQL = "SELECT has_sequence_privilege(current_user, $1::text, 'UPDATE') AS has_privilege";

const TARGET_PRIVILEGES: readonly string[] = ["INSERT", "UPDATE", "SELECT"];
const SOURCE_PRIVILEGES: readonly string[] = ["SELECT"];

const labelOf = (layout: TableLayout): string => buildQualifiedTableLabel(layout.schema, layout.table);

export function assertRunAllowed(params: CargarLocalidadesParams): void {
  if (!params.dryRun && !params.confirm) {
    throw new Error(CONFIRM_REQUIRED_MESSAGE);
  }
}

function writtenPhysicalColumns(target: LocalityTargetLayout): string[] {
  return TARGET_WRITTEN_COLUMNS.map((logical) => target.columns[logical]).filter(
    (column): column is string => column !== undefined
  );
}

async function targetStructureIssuesOf(session: CatalogQuerySession, target: LocalityTargetLayout): Promise<string[]> {
  const label = labelOf(target);
  const structure = await readTargetStructure(session, target, label);
  return [
    ...relationKindIssues(label, structure.relkind),
    ...inheritanceIssues(structure),
    ...relationFactIssues(structure),
    ...idSequenceIssues(label, target.idColumn, target.idSequence),
    ...notNullIssues(label, target.catalog, target.identityColumns, writtenPhysicalColumns(target)),
  ];
}

async function hasTablePrivilege(session: CatalogQuerySession, layout: TableLayout, privilege: string): Promise<boolean> {
  const result = await session.query(PRIVILEGE_SQL, [resolveSchemaName(layout.schema), layout.table, privilege]);
  return Boolean(result.rows[0]?.has_privilege);
}

async function tablePrivilegeIssues(
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

async function sequenceIssuesOf(session: CatalogQuerySession, target: LocalityTargetLayout): Promise<string[]> {
  if (target.idSequence === null) return [];
  const result = await session.query(SEQUENCE_PRIVILEGE_SQL, [target.idSequence]);
  if (result.rows[0]?.has_privilege) return [];
  const sequence = parseSequenceName(target.idSequence);
  const name = sequence === undefined ? target.idSequence : `${sequence.schema ?? target.schema}.${sequence.name}`;
  return [`No tiene privilegio UPDATE sobre la secuencia ${name}, necesario para ajustar los ids de ${labelOf(target)}.`];
}

async function targetPrivilegeIssues(session: CatalogQuerySession, target: LocalityTargetLayout): Promise<string[]> {
  return [
    ...(await tablePrivilegeIssues(session, target, TARGET_PRIVILEGES)),
    ...(await sequenceIssuesOf(session, target)),
  ];
}

async function sourcePrivilegeIssues(session: CatalogQuerySession, layouts: LocalityLayouts): Promise<string[]> {
  const sources = [layouts.padron, layouts.localities, layouts.province];
  const issues: string[] = [];
  for (const source of sources) {
    issues.push(...(await tablePrivilegeIssues(session, source, SOURCE_PRIVILEGES)));
  }
  return issues;
}

async function collectTargetIssues(session: CatalogQuerySession, layouts: LocalityLayouts): Promise<string[]> {
  const issues: string[] = [];
  for (const target of layouts.targets) {
    issues.push(...(await targetStructureIssuesOf(session, target)));
    issues.push(...(await targetPrivilegeIssues(session, target)));
  }
  return issues;
}

export async function assertTargetsReady(session: CatalogQuerySession, layouts: LocalityLayouts): Promise<void> {
  const issues = [
    ...(await collectTargetIssues(session, layouts)),
    ...(await sourcePrivilegeIssues(session, layouts)),
  ];
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
}

async function hasRows(session: CatalogQuerySession, layout: TableLayout): Promise<boolean> {
  const result = await session.query(`SELECT EXISTS (SELECT 1 FROM ${qualifiedName(layout)}) AS present`);
  return Boolean(result.rows[0]?.present);
}

export async function assertSourcesReady(session: CatalogQuerySession, layouts: LocalityLayouts): Promise<void> {
  const issues: string[] = [];
  if (!(await hasRows(session, layouts.padron))) {
    issues.push(`La tabla ${labelOf(layouts.padron)} no tiene filas: no hay padrones de origen.`);
  }
  if (!(await hasRows(session, layouts.localities))) {
    issues.push(`La tabla ${labelOf(layouts.localities)} no tiene filas: no hay localidades de origen.`);
  }
  const unsupported = await readUnsupportedSridCount(session, layouts.localities);
  if (unsupported > 0) {
    issues.push(
      `La tabla ${labelOf(layouts.localities)} tiene ${unsupported} geometrías con SRID 0 o desconocido: no se pueden transformar al SRID de destino.`
    );
  }
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
}
