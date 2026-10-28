import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import { readUnsupportedSridCount } from "./tableFacts";
import type { WritableTargetLayout } from "./tableResolution";
import {
  hasRows,
  labelOf,
  READ_PRIVILEGES,
  tablePrivilegeIssues,
  targetStructureIssuesOf,
  writeTargetPrivilegeIssues,
} from "./targetPreflight";

export interface WriteTargetsSpec {
  targets: readonly WritableTargetLayout[];
  writtenColumns: readonly string[];
  title: string;
  readTables: readonly TableLayout[];
}

export interface SourceTablesSpec {
  withRows: ReadonlyArray<{ layout: TableLayout; description: string }>;
  geometry: { layout: TableLayout; column: string };
}

export function throwIfIssues(issues: readonly string[]): void {
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
}

export function assertConfirmedOrDryRun(params: { dryRun: boolean; confirm: boolean }, message: string): void {
  if (!params.dryRun && !params.confirm) {
    throw new Error(message);
  }
}

async function writeTargetIssues(session: CatalogQuerySession, spec: WriteTargetsSpec): Promise<string[]> {
  const issues: string[] = [];
  for (const target of spec.targets) {
    // One pg client: catalog reads are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await targetStructureIssuesOf(session, target, spec.writtenColumns, spec.title)));
    issues.push(...(await writeTargetPrivilegeIssues(session, target)));
  }
  return issues;
}

async function readTableIssues(session: CatalogQuerySession, tables: readonly TableLayout[]): Promise<string[]> {
  const issues: string[] = [];
  for (const table of tables) {
    // One pg client: privilege checks are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await tablePrivilegeIssues(session, table, READ_PRIVILEGES)));
  }
  return issues;
}

export async function assertWriteTargetsReady(session: CatalogQuerySession, spec: WriteTargetsSpec): Promise<void> {
  throwIfIssues([...(await writeTargetIssues(session, spec)), ...(await readTableIssues(session, spec.readTables))]);
}

async function emptySourceIssues(session: CatalogQuerySession, spec: SourceTablesSpec): Promise<string[]> {
  const issues: string[] = [];
  for (const { layout, description } of spec.withRows) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    if (!(await hasRows(session, layout))) {
      issues.push(`La tabla ${labelOf(layout)} no tiene filas: no hay ${description} de origen.`);
    }
  }
  return issues;
}

export async function assertSourceTablesReady(session: CatalogQuerySession, spec: SourceTablesSpec): Promise<void> {
  const issues = await emptySourceIssues(session, spec);
  // One pg client: reads are awaited in turn, so they never overlap.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const unsupported = await readUnsupportedSridCount(session, spec.geometry.layout, spec.geometry.column);
  if (unsupported > 0) {
    issues.push(
      `La tabla ${labelOf(spec.geometry.layout)} tiene ${unsupported} geometrías con SRID 0 o desconocido: no se pueden transformar al SRID de destino.`
    );
  }
  throwIfIssues(issues);
}
