import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { GENERIC_SRID } from "../../actualizar-padron/constants";
import { parseGeometryType } from "../../actualizar-padron/domain/geometryType";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { readIdSequence } from "../../shared/tableFacts";
import { resolveTable, type ResolvedTable, type WritableTargetLayout } from "../../shared/tableResolution";
import {
  EJES_ID_LOGICAL_BY_ROLE,
  EJES_REQUIRED_COLUMNS_BY_ROLE,
  EJES_ROLES,
  EJES_SRID,
  EJES_TABLE_ROLE,
  EJES_WRITE_ROLES,
  LOCALITIES_COLUMN,
  PADRON_COLUMN,
  ROAD_SECTION_COLUMN,
  STAGING_COLUMN,
  type EjesTableRole,
} from "../constants";
import type { EjesLayouts, EjesParams, EjesResolvedLayouts } from "../types";

const GEOMETRY_LOGICAL_BY_ROLE: Partial<Record<EjesTableRole, string>> = {
  [EJES_TABLE_ROLE.STAGING]: STAGING_COLUMN.GEOM,
  [EJES_TABLE_ROLE.ROAD_SECTION]: ROAD_SECTION_COLUMN.GEOMETRY,
  [EJES_TABLE_ROLE.LOCALITIES]: LOCALITIES_COLUMN.GEOM,
};

export function sridIssuesOf(resolved: ResolvedTable, logicalGeometry: string, allowGeneric = true): string[] {
  const column = resolved.layout.columns[logicalGeometry];
  const dataType = resolved.dataTypes[logicalGeometry];
  if (column === undefined || dataType === undefined) return [];
  const typing = parseGeometryType(dataType);
  if (typing === undefined) return [`La columna "${column}" de la tabla ${resolved.label} no es de tipo geometría.`];
  if (typing.srid === EJES_SRID || (allowGeneric && typing.srid === GENERIC_SRID)) return [];
  return [`La columna "${column}" de la tabla ${resolved.label} tiene SRID ${typing.srid}; debe ser ${EJES_SRID}.`];
}

export const padronSridIssuesOf = (resolved: ResolvedTable): string[] => sridIssuesOf(resolved, PADRON_COLUMN.GEOMETRY, false);

function geometryIssuesOf(role: EjesTableRole, resolved: ResolvedTable): string[] {
  if (role === EJES_TABLE_ROLE.PADRONES) return padronSridIssuesOf(resolved);
  const logical = GEOMETRY_LOGICAL_BY_ROLE[role];
  return logical === undefined ? [] : sridIssuesOf(resolved, logical);
}

async function writeTargetOf(
  session: CatalogQuerySession,
  role: EjesTableRole,
  resolved: ResolvedTable
): Promise<WritableTargetLayout> {
  const idLogical = EJES_ID_LOGICAL_BY_ROLE[role];
  const idColumn = idLogical === undefined ? "" : (resolved.layout.columns[idLogical] ?? "");
  const idDefault = resolved.catalog.find((entry) => entry.column_name === idColumn)?.column_default ?? null;
  const idSequence = idColumn === "" ? null : await readIdSequence(session, resolved.layout, idColumn, idDefault);
  return { ...resolved.layout, srid: EJES_SRID, idColumn, idSequence, identityColumns: [], catalog: resolved.catalog };
}

async function resolveAllRoles(
  session: CatalogQuerySession,
  params: EjesParams
): Promise<Array<[EjesTableRole, ResolvedTable]>> {
  const entries: Array<[EjesTableRole, ResolvedTable]> = [];
  for (const role of EJES_ROLES) {
    const { schema, table } = params.tables[role];
    // One pg client: catalog reads are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    const resolved = await resolveTable(session, {
      label: buildQualifiedTableLabel(schema, table),
      schema,
      table,
      required: EJES_REQUIRED_COLUMNS_BY_ROLE[role],
    });
    entries.push([role, resolved]);
  }
  return entries;
}

export async function resolveEjesLayouts(session: CatalogQuerySession, params: EjesParams): Promise<EjesResolvedLayouts> {
  const entries = await resolveAllRoles(session, params);
  throwIfIssues(entries.flatMap(([role, resolved]) => [...resolved.issues, ...geometryIssuesOf(role, resolved)]));
  const layouts = Object.fromEntries(entries.map(([role, resolved]) => [role, resolved.layout])) as EjesLayouts;
  const writeTargets: WritableTargetLayout[] = [];
  for (const [role, resolved] of entries) {
    if (!EJES_WRITE_ROLES.includes(role)) continue;
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    writeTargets.push(await writeTargetOf(session, role, resolved));
  }
  return { layouts, writeTargets };
}
