import { buildQualifiedTableLabel, resolveSchemaName } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { assertSourceTablesReady, throwIfIssues } from "../../shared/preflightAsserts";
import {
  READ_PRIVILEGES,
  sequenceIssuesOf,
  tableAnyPrivilegeIssues,
  tablePrivilegeIssues,
  targetStructureIssuesOf,
} from "../../shared/targetPreflight";
import {
  ADDRESS_MASTER_COLUMN,
  CIRCULATION_WAY_COLUMN,
  EJES_LOAD_ROLES,
  EJES_READ_ROLES,
  EJES_TABLE_ROLE,
  ROAD_SECTION_COLUMN,
  EJES_STAGING_COLUMN,
} from "../constants";
import type { EjesLayouts, EjesLoadContext, EjesLoadRole, EjesResolvedLayouts } from "../types";

const EJES_WRITE_PRIVILEGES: readonly string[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

/** LOCK ... IN SHARE ROW EXCLUSIVE MODE needs one of these on each locked table. */
const LOCK_PRIVILEGES: readonly string[] = ["UPDATE", "DELETE", "TRUNCATE"];

const OWNER_SQL =
  "SELECT pg_has_role(current_user, c.relowner, 'MEMBER') AS is_owner FROM pg_class AS c JOIN pg_namespace AS n ON n.oid = c.relnamespace WHERE n.nspname = $1::text AND c.relname = $2::text";

export async function assertEjesReadable(session: CatalogQuerySession, layouts: EjesLayouts): Promise<void> {
  const issues: string[] = [];
  for (const role of EJES_READ_ROLES) {
    // One pg client: privilege checks are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await tablePrivilegeIssues(session, layouts[role], READ_PRIVILEGES)));
  }
  throwIfIssues(issues);
}

export async function assertEjesStagingReady(session: CatalogQuerySession, layouts: EjesLayouts): Promise<void> {
  const staging = layouts[EJES_TABLE_ROLE.STAGING];
  await assertSourceTablesReady(session, {
    withRows: [{ layout: staging, description: "ejes de vía de circulación" }],
    geometry: { layout: staging, column: EJES_STAGING_COLUMN.GEOM },
  });
}

export async function ejesWritePrivilegeInfo(session: CatalogQuerySession, resolved: EjesResolvedLayouts): Promise<string[]> {
  const info: string[] = [];
  for (const target of resolved.writeTargets) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    info.push(...(await tablePrivilegeIssues(session, target, EJES_WRITE_PRIVILEGES)));
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    info.push(...(await sequenceIssuesOf(session, target, false)));
  }
  return info;
}

const LOAD_PRIVILEGES: Record<EjesLoadRole, readonly string[]> = {
  [EJES_TABLE_ROLE.ROAD_SECTION]: ["SELECT", "INSERT", "UPDATE"],
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: ["SELECT", "INSERT"],
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: ["SELECT", "INSERT"],
  [EJES_TABLE_ROLE.ACCESS_POINT]: ["SELECT", "UPDATE"],
};

const INSERTED_COLUMNS: Partial<Record<EjesLoadRole, readonly string[]>> = {
  [EJES_TABLE_ROLE.ROAD_SECTION]: [
    ROAD_SECTION_COLUMN.ID,
    ROAD_SECTION_COLUMN.REFTRAMO,
    ROAD_SECTION_COLUMN.CIRCULATION_WAY,
    ROAD_SECTION_COLUMN.TYPE,
    ROAD_SECTION_COLUMN.FONT,
    ROAD_SECTION_COLUMN.ADDRESS_MASTER,
    ROAD_SECTION_COLUMN.DISTANCE,
    ROAD_SECTION_COLUMN.GEOMETRY,
  ],
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: Object.values(CIRCULATION_WAY_COLUMN),
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: Object.values(ADDRESS_MASTER_COLUMN),
};

const TITLE_BY_ROLE: Record<EjesLoadRole, string> = {
  [EJES_TABLE_ROLE.ROAD_SECTION]: "La tabla de tramos de calle",
  [EJES_TABLE_ROLE.CIRCULATION_WAY]: "La tabla de vías de circulación",
  [EJES_TABLE_ROLE.ADDRESS_MASTER]: "La tabla de direcciones maestras",
  [EJES_TABLE_ROLE.ACCESS_POINT]: "La tabla de puntos de acceso",
};

async function analyzeOwnershipWarning(session: CatalogQuerySession, schema: string, table: string): Promise<string[]> {
  const result = await session.query(OWNER_SQL, [resolveSchemaName(schema), table]);
  if (result.rows[0]?.is_owner !== false) return [];
  const label = buildQualifiedTableLabel(schema, table);
  return [`ANALYZE de ${label} se omitiría: el usuario no es propietario de la tabla. Es solo una advertencia y la carga continúa.`];
}

/** ANALYZE by a non-owner is skipped with a warning by the server: reported here, never a blocker. */
export async function ejesAnalyzeWarnings(session: CatalogQuerySession, context: EjesLoadContext): Promise<string[]> {
  const warnings: string[] = [];
  for (const role of EJES_LOAD_ROLES) {
    const target = context.targets[role];
    // One pg client: ownership checks are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    warnings.push(...(await analyzeOwnershipWarning(session, target.schema, target.table)));
  }
  return warnings;
}

/** A real run writes only what slice 1 needs: any missing privilege, sequence or NOT NULL column is a blocker, not information. */
export async function assertEjesLoadReady(session: CatalogQuerySession, context: EjesLoadContext): Promise<string[]> {
  const issues: string[] = [];
  for (const role of EJES_LOAD_ROLES) {
    const target = context.targets[role];
    // One pg client: checks are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await tablePrivilegeIssues(session, target, LOAD_PRIVILEGES[role])));
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await tableAnyPrivilegeIssues(session, target, LOCK_PRIVILEGES, "para bloquear la tabla en la carga")));
    const inserted = INSERTED_COLUMNS[role];
    if (inserted === undefined) continue;
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await sequenceIssuesOf(session, target, true)));
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await targetStructureIssuesOf(session, target, inserted, TITLE_BY_ROLE[role])));
  }
  throwIfIssues(issues);
  return ejesAnalyzeWarnings(session, context);
}
