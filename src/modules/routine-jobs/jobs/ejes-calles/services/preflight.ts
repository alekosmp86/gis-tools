import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { assertSourceTablesReady, throwIfIssues } from "../../shared/preflightAsserts";
import { READ_PRIVILEGES, sequenceIssuesOf, tablePrivilegeIssues, targetStructureIssuesOf } from "../../shared/targetPreflight";
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

/** A real run writes only what slice 1 needs: any missing privilege, sequence or NOT NULL column is a blocker, not information. */
export async function assertEjesLoadReady(session: CatalogQuerySession, context: EjesLoadContext): Promise<void> {
  const issues: string[] = [];
  for (const role of EJES_LOAD_ROLES) {
    const target = context.targets[role];
    // One pg client: checks are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await tablePrivilegeIssues(session, target, LOAD_PRIVILEGES[role])));
    const inserted = INSERTED_COLUMNS[role];
    if (inserted === undefined) continue;
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await sequenceIssuesOf(session, target, true)));
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await targetStructureIssuesOf(session, target, inserted, TITLE_BY_ROLE[role])));
  }
  throwIfIssues(issues);
}
