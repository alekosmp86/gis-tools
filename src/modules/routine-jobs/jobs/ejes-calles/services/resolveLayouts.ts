import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { GENERIC_SRID } from "../../actualizar-padron/constants";
import { parseGeometryType } from "../../actualizar-padron/domain/geometryType";
import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { literal } from "../../shared/sqlFragments";
import { scopedTable } from "../domain/layoutSql";
import { canonicalTextSql } from "../domain/stagingSql";
import { readIdSequence } from "../../shared/tableFacts";
import { resolveTable, type ResolvedTable, type WritableTargetLayout } from "../../shared/tableResolution";
import {
  ADDRESS_COLUMN,
  DEPARTMENTS_COLUMN,
  EJES_ID_LOGICAL_BY_ROLE,
  EJES_REQUIRED_COLUMNS_BY_ROLE,
  EJES_ROLES,
  EJES_SRID,
  EJES_TABLE_ROLE,
  EJES_WRITE_ROLES,
  LOCALITIES_COLUMN,
  PADRON_COLUMN,
  ROAD_SECTION_COLUMN,
  EJES_STAGING_COLUMN,
  type EjesTableRole,
} from "../constants";
import type { EjesLayouts, EjesParams, EjesResolvedLayouts } from "../types";

const GEOMETRY_LOGICAL_BY_ROLE: Partial<Record<EjesTableRole, string>> = {
  [EJES_TABLE_ROLE.STAGING]: EJES_STAGING_COLUMN.GEOM,
  [EJES_TABLE_ROLE.ROAD_SECTION]: ROAD_SECTION_COLUMN.GEOMETRY,
};

const EXACT_GEOMETRY_BY_ROLE: Partial<Record<EjesTableRole, string>> = {
  [EJES_TABLE_ROLE.LOCALITIES]: LOCALITIES_COLUMN.GEOM,
  [EJES_TABLE_ROLE.DEPARTMENTS]: DEPARTMENTS_COLUMN.GEOM,
  [EJES_TABLE_ROLE.PADRONES]: PADRON_COLUMN.GEOMETRY,
  [EJES_TABLE_ROLE.ADDRESS]: ADDRESS_COLUMN.GEOMETRY,
};

/** The address geometry is needed only by the split points: its SRID is a blocker in a real run and information in a dry run. */
const DEFERRED_GEOMETRY_ROLES: readonly EjesTableRole[] = [EJES_TABLE_ROLE.ADDRESS];
const isDeferredGeometry = (role: EjesTableRole): boolean => DEFERRED_GEOMETRY_ROLES.includes(role);

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
  const exact = EXACT_GEOMETRY_BY_ROLE[role];
  if (exact !== undefined) return sridIssuesOf(resolved, exact, false);
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
  throwIfIssues(entries.flatMap(([role, resolved]) => [...resolved.issues, ...(isDeferredGeometry(role) ? [] : geometryIssuesOf(role, resolved))]));
  const addressIssues = entries.flatMap(([role, resolved]) => (isDeferredGeometry(role) ? geometryIssuesOf(role, resolved) : []));
  const resolvedLayouts = Object.fromEntries(entries.map(([role, resolved]) => [role, resolved.layout])) as EjesLayouts;
  const layouts = params.department ? scopedLayoutsOf(resolvedLayouts, params.department) : resolvedLayouts;
  if (params.department) await assertDepartmentScope(session, layouts, params.department);
  const writeTargets: WritableTargetLayout[] = [];
  for (const [role, resolved] of entries) {
    if (!EJES_WRITE_ROLES.includes(role)) continue;
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    writeTargets.push(await writeTargetOf(session, role, resolved));
  }
  return { layouts, writeTargets, addressIssues };
}

const centreOf = (geometry: string): string => `ST_SetSRID(ST_Centroid(ST_Envelope(${geometry})), ${EJES_SRID})`;

const departmentPolygonSql = (departments: TableLayout, department: string): string =>
  [
    `(SELECT ST_SetSRID(ST_Union(ST_MakeValid(d.${physicalColumn(departments, DEPARTMENTS_COLUMN.GEOM)})), ${EJES_SRID}) FROM ${qualifiedName(departments)} AS d`,
    `WHERE upper(btrim(d.${physicalColumn(departments, DEPARTMENTS_COLUMN.NAME)}::text)) = ${literal(department.toUpperCase())})`,
  ].join(" ");

/**
 * The department scope of a run, by reference: a `reftramo` is in scope when its staging row or its road section has its geometry centre
 * inside the polygon of the department. Both tables are then read for the in-scope references only, so a section and its staging row are
 * always on the same side, a duplicated `reftramo` is read whole, and a row without a geometry follows its reference.
 */
function scopedLayoutsOf(layouts: EjesLayouts, department: string): EjesLayouts {
  const polygon = departmentPolygonSql(layouts[EJES_TABLE_ROLE.DEPARTMENTS], department);
  const staging = layouts[EJES_TABLE_ROLE.STAGING];
  const section = layouts[EJES_TABLE_ROLE.ROAD_SECTION];
  const stagingRef = canonicalTextSql(`ss.${physicalColumn(staging, EJES_STAGING_COLUMN.REFTRAMO)}`);
  const sectionRef = canonicalTextSql(`rr.${physicalColumn(section, ROAD_SECTION_COLUMN.REFTRAMO)}`);
  const stagingGeometry = `ss.${physicalColumn(staging, EJES_STAGING_COLUMN.GEOM)}`;
  const sectionGeometry = `rr.${physicalColumn(section, ROAD_SECTION_COLUMN.GEOMETRY)}`;
  const inside = (geometry: string): string => `${geometry} && ${polygon} AND ST_Intersects(${polygon}, ${centreOf(geometry)})`;
  const scopeRefs = [
    `(SELECT ${stagingRef} FROM ${qualifiedName(staging)} AS ss WHERE ${inside(stagingGeometry)}`,
    `UNION SELECT ${sectionRef} FROM ${qualifiedName(section)} AS rr WHERE ${inside(sectionGeometry)})`,
  ].join(" ");
  const scopeOf = (layout: TableLayout, logical: string): TableLayout => ({
    ...layout,
    scopeWhere: `${canonicalTextSql(physicalColumn(layout, logical))} IN ${scopeRefs}`,
  });
  return {
    ...layouts,
    [EJES_TABLE_ROLE.STAGING]: scopeOf(staging, EJES_STAGING_COLUMN.REFTRAMO),
    [EJES_TABLE_ROLE.ROAD_SECTION]: scopeOf(section, ROAD_SECTION_COLUMN.REFTRAMO),
  };
}

/** A department that names no polygon, or whose scope holds no staging row, would turn every section of it into a removal: the run stops. */
async function assertDepartmentScope(session: CatalogQuerySession, layouts: EjesLayouts, department: string): Promise<void> {
  const departments = layouts[EJES_TABLE_ROLE.DEPARTMENTS];
  const polygon = await session.query(`SELECT count(*) AS n FROM ${qualifiedName(departments)} AS d WHERE upper(btrim(d.${physicalColumn(departments, DEPARTMENTS_COLUMN.NAME)}::text)) = ${literal(department.toUpperCase())} AND d.${physicalColumn(departments, DEPARTMENTS_COLUMN.GEOM)} IS NOT NULL`);
  if (Number(polygon.rows[0]?.n ?? 0) === 0) throw new Error(`El departamento ${department} no está en la tabla de departamentos.`);
  const rows = await session.query(`SELECT count(*) AS n FROM ${scopedTable(layouts, "STAGING")} AS s`);
  if (Number(rows.rows[0]?.n ?? 0) === 0) throw new Error(`El archivo de ejes no tiene tramos del departamento ${department}.`);
}
