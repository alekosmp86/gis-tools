import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import {
  hasRows,
  labelOf,
  READ_PRIVILEGES,
  tablePrivilegeIssues,
  targetStructureIssuesOf,
  writeTargetPrivilegeIssues,
} from "../../shared/targetPreflight";
import { readUnsupportedSridCount } from "../../shared/tableFacts";
import { UNIT_SOURCE_COLUMN, UNIT_TARGET_TITLE, UNIT_TARGET_WRITTEN_COLUMNS, UNIT_TYPE_COLUMN } from "../constants";
import type { UnitLayouts, UnitParams } from "../types";

export const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la actualización de unidades territoriales para escribir en la tabla de destino. Sin confirmación solo se permite el análisis sin cargar.";

export function assertRunAllowed(params: UnitParams): void {
  if (!params.dryRun && !params.confirm) {
    throw new Error(CONFIRM_REQUIRED_MESSAGE);
  }
}

export async function resolveUnitTypeId(
  session: CatalogQuerySession,
  type: TableLayout,
  typeName: string
): Promise<number> {
  const label = labelOf(type);
  const result = await session.query(
    `SELECT count(*) AS "matches", min(${physicalColumn(type, UNIT_TYPE_COLUMN.ID)}) AS "id" FROM ${qualifiedName(type)} WHERE ${physicalColumn(type, UNIT_TYPE_COLUMN.NAME)} = $1`,
    [typeName]
  );
  const matches = Number(result.rows[0]?.matches ?? 0);
  if (matches !== 1) {
    throw new Error(
      `El tipo "${typeName}" aparece ${matches} veces en ${label}: debe aparecer exactamente una vez.`
    );
  }
  const unitTypeId = Number(result.rows[0]?.id);
  if (!Number.isSafeInteger(unitTypeId)) {
    throw new Error(`El id del tipo "${typeName}" en ${label} no es un entero válido.`);
  }
  return unitTypeId;
}

export async function assertTargetsReady(session: CatalogQuerySession, layouts: UnitLayouts): Promise<void> {
  const issues = [
    ...(await targetStructureIssuesOf(session, layouts.target, UNIT_TARGET_WRITTEN_COLUMNS, UNIT_TARGET_TITLE)),
    ...(await writeTargetPrivilegeIssues(session, layouts.target)),
    ...(await tablePrivilegeIssues(session, layouts.locality, READ_PRIVILEGES)),
    ...(await tablePrivilegeIssues(session, layouts.type, READ_PRIVILEGES)),
  ];
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
}

export async function assertSourcesReady(session: CatalogQuerySession, layouts: UnitLayouts): Promise<void> {
  const issues: string[] = [];
  if (!(await hasRows(session, layouts.locality))) {
    issues.push(`La tabla ${labelOf(layouts.locality)} no tiene filas: no hay localidades de origen.`);
  }
  const unsupported = await readUnsupportedSridCount(session, layouts.locality, UNIT_SOURCE_COLUMN.GEOMETRY);
  if (unsupported > 0) {
    issues.push(
      `La tabla ${labelOf(layouts.locality)} tiene ${unsupported} geometrías con SRID 0 o desconocido: no se pueden transformar al SRID de destino.`
    );
  }
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
}
