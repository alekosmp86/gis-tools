import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { ADDRESS_MASTER_TITLE, ADDRESS_MASTER_WRITTEN_COLUMNS } from "./addressMasterLinkSpec";
import {
  READ_PRIVILEGES,
  sequenceIssuesOf,
  tablePrivilegeIssues,
  targetStructureIssuesOf,
} from "./targetPreflight";
import type { WritableTargetLayout } from "./tableResolution";

const ADDRESS_MASTER_PRIVILEGES: readonly string[] = [...READ_PRIVILEGES, "INSERT"];

export async function addressMasterIssuesOf(
  session: CatalogQuerySession,
  addressMaster: WritableTargetLayout
): Promise<string[]> {
  return [
    ...(await targetStructureIssuesOf(session, addressMaster, ADDRESS_MASTER_WRITTEN_COLUMNS, ADDRESS_MASTER_TITLE)),
    ...(await tablePrivilegeIssues(session, addressMaster, ADDRESS_MASTER_PRIVILEGES)),
    ...(await sequenceIssuesOf(session, addressMaster)),
  ];
}
