import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { throwIfIssues } from "../../shared/preflightAsserts";
import {
  READ_PRIVILEGES,
  sequenceIssuesOf,
  tablePrivilegeIssues,
  tableStructureIssuesOf,
  targetStructureIssuesOf,
} from "../../shared/targetPreflight";
import {
  COMPLETAR_ADDRESS_MASTER_TITLE,
  COMPLETAR_ADDRESS_MASTER_WRITTEN_COLUMNS,
  COMPLETAR_UNIT_TITLE,
} from "../constants";
import type { CompletarLayouts } from "../types";

export const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la creación y el enlace de direcciones maestras para escribir en las tablas de destino. Sin confirmación solo se permite el análisis sin cargar.";

const UNIT_PRIVILEGES: readonly string[] = [...READ_PRIVILEGES, "UPDATE"];
const ADDRESS_MASTER_PRIVILEGES: readonly string[] = [...READ_PRIVILEGES, "INSERT"];

export async function assertTargetsReady(session: CatalogQuerySession, layouts: CompletarLayouts): Promise<void> {
  const issues = [
    ...(await tableStructureIssuesOf(session, layouts.unit, COMPLETAR_UNIT_TITLE)),
    ...(await tablePrivilegeIssues(session, layouts.unit, UNIT_PRIVILEGES)),
    ...(await targetStructureIssuesOf(
      session,
      layouts.addressMaster,
      COMPLETAR_ADDRESS_MASTER_WRITTEN_COLUMNS,
      COMPLETAR_ADDRESS_MASTER_TITLE
    )),
    ...(await tablePrivilegeIssues(session, layouts.addressMaster, ADDRESS_MASTER_PRIVILEGES)),
    ...(await sequenceIssuesOf(session, layouts.addressMaster)),
  ];
  throwIfIssues(issues);
}
