import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { addressMasterIssuesOf } from "../../shared/addressMasterLinkPreflight";
import { UNIT_SUBJECT_SPEC } from "../../shared/addressMasterLinkSpec";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { READ_PRIVILEGES, tablePrivilegeIssues, tableStructureIssuesOf } from "../../shared/targetPreflight";
import type { CompletarLayouts } from "../types";

export const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la creación y el enlace de direcciones maestras para escribir en las tablas de destino. Sin confirmación solo se permite el análisis sin cargar.";

const UNIT_PRIVILEGES: readonly string[] = [...READ_PRIVILEGES, "UPDATE"];

export async function assertTargetsReady(session: CatalogQuerySession, layouts: CompletarLayouts): Promise<void> {
  const issues = [
    ...(await tableStructureIssuesOf(session, layouts.unit, UNIT_SUBJECT_SPEC.texts.structureTitle)),
    ...(await tablePrivilegeIssues(session, layouts.unit, UNIT_PRIVILEGES)),
    ...(await addressMasterIssuesOf(session, layouts.addressMaster)),
  ];
  throwIfIssues(issues);
}
