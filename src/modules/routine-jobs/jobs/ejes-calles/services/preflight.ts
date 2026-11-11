import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { assertSourceTablesReady, throwIfIssues } from "../../shared/preflightAsserts";
import { READ_PRIVILEGES, sequenceIssuesOf, tablePrivilegeIssues } from "../../shared/targetPreflight";
import { EJES_READ_ROLES, EJES_TABLE_ROLE, STAGING_COLUMN } from "../constants";
import type { EjesLayouts, EjesResolvedLayouts } from "../types";

export const EJES_WRITE_PRIVILEGES: readonly string[] = ["SELECT", "INSERT", "UPDATE", "DELETE"];

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
    geometry: { layout: staging, column: STAGING_COLUMN.GEOM },
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
