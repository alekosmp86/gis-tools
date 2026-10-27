import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import type { TableLayout } from "../../actualizar-padron/domain/layouts";
import {
  hasRows,
  labelOf,
  READ_PRIVILEGES,
  tablePrivilegeIssues,
  targetStructureIssuesOf,
  writeTargetPrivilegeIssues,
} from "../../shared/targetPreflight";
import { readUnsupportedSridCount } from "../../shared/tableFacts";
import { STAGING_LOCALITY_COLUMN, TARGET_WRITTEN_COLUMNS } from "../constants";
import type { CargarLocalidadesParams, LocalityLayouts } from "../types";

export const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la carga de localidades para escribir en las tablas de destino. Sin confirmación solo se permite el análisis sin cargar.";

const TARGET_TITLE = "de localidades";

export function assertRunAllowed(params: CargarLocalidadesParams): void {
  if (!params.dryRun && !params.confirm) {
    throw new Error(CONFIRM_REQUIRED_MESSAGE);
  }
}

async function collectTargetIssues(session: CatalogQuerySession, layouts: LocalityLayouts): Promise<string[]> {
  const issues: string[] = [];
  for (const target of layouts.targets) {
    // One pg client: catalog reads are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await targetStructureIssuesOf(session, target, TARGET_WRITTEN_COLUMNS, TARGET_TITLE)));
    issues.push(...(await writeTargetPrivilegeIssues(session, target)));
  }
  return issues;
}

async function sourcePrivilegeIssues(session: CatalogQuerySession, layouts: LocalityLayouts): Promise<string[]> {
  const sources: TableLayout[] = [layouts.padron, layouts.localities, layouts.province];
  const issues: string[] = [];
  for (const source of sources) {
    // One pg client: privilege checks are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await tablePrivilegeIssues(session, source, READ_PRIVILEGES)));
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

export async function assertSourcesReady(session: CatalogQuerySession, layouts: LocalityLayouts): Promise<void> {
  const issues: string[] = [];
  if (!(await hasRows(session, layouts.padron))) {
    issues.push(`La tabla ${labelOf(layouts.padron)} no tiene filas: no hay padrones de origen.`);
  }
  if (!(await hasRows(session, layouts.localities))) {
    issues.push(`La tabla ${labelOf(layouts.localities)} no tiene filas: no hay localidades de origen.`);
  }
  const unsupported = await readUnsupportedSridCount(session, layouts.localities, STAGING_LOCALITY_COLUMN.GEOM);
  if (unsupported > 0) {
    issues.push(
      `La tabla ${labelOf(layouts.localities)} tiene ${unsupported} geometrías con SRID 0 o desconocido: no se pueden transformar al SRID de destino.`
    );
  }
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
}
