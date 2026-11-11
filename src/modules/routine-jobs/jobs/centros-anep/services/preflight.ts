import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { READ_PRIVILEGES, sequenceIssuesOf, tablePrivilegeIssues } from "../../shared/targetPreflight";
import { CENTROS_FINAL_PRIVILEGES } from "../constants";
import type { CentrosResolved } from "../types";

export async function centrosPrivilegeIssues(session: CatalogQuerySession, resolved: CentrosResolved): Promise<string[]> {
  const issues = [
    ...(await tablePrivilegeIssues(session, resolved.staging.layout, READ_PRIVILEGES)),
    ...(await tablePrivilegeIssues(session, resolved.final, CENTROS_FINAL_PRIVILEGES)),
  ];
  for (const target of resolved.defaultSequenceTargets) {
    // One pg client: privilege checks are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    issues.push(...(await sequenceIssuesOf(session, target, false)));
  }
  return issues;
}
