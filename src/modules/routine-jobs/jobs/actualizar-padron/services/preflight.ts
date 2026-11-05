import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { tablePrivilegeIssues } from "../../shared/targetPreflight";
import { assertWriteTargetsReady, throwIfIssues, type SourceTablesSpec, type WriteTargetsSpec } from "../../shared/preflightAsserts";
import { STAGING_COLUMN, DESTINATION_TITLE, DESTINATION_WRITTEN_COLUMNS } from "../constants";
import type { PadronLayouts } from "../types";
import { addressMasterIssuesFor, keyFormatIssuesOf, localityReferenceVerdictOf } from "./preflightIssues";

export { resolveLocalityTypeId } from "./preflightIssues";

export const CONFIRM_REQUIRED_MESSAGE =
  "Confirme la actualización de padrones para escribir en la tabla de destino. Sin confirmación solo se permite el análisis sin cargar.";

const writeTargetsSpecOf = (layouts: PadronLayouts, repairSequences: boolean): WriteTargetsSpec => ({
  targets: [layouts.target],
  writtenColumns: DESTINATION_WRITTEN_COLUMNS,
  title: DESTINATION_TITLE,
  readTables: [layouts.staging, layouts.province, layouts.locality, ...(layouts.type ? [layouts.type] : [])],
  repairSequences,
});

/** AP-106 deletes unreferenced missing padrones: this stage alone needs DELETE on its destination (stage 3 never deletes, so this stays
    out of the shared WRITE_PRIVILEGES). Checked here, not in the shared targetStructureIssuesOf, for that reason. */
const DESTINATION_DELETE_PRIVILEGE: readonly string[] = ["DELETE"];

export const sourceTablesSpecOf = (layouts: PadronLayouts): SourceTablesSpec => ({
  withRows: [{ layout: layouts.staging, description: "padrones" }],
  geometry: { layout: layouts.staging, column: STAGING_COLUMN.GEOM },
});

export async function assertTargetReady(
  session: CatalogQuerySession,
  layouts: PadronLayouts,
  repairSequences: boolean
): Promise<string[]> {
  await assertWriteTargetsReady(session, writeTargetsSpecOf(layouts, repairSequences));
  throwIfIssues(await tablePrivilegeIssues(session, layouts.target, DESTINATION_DELETE_PRIVILEGE));
  throwIfIssues(await keyFormatIssuesOf(session, layouts.target));
  const localityVerdict = await localityReferenceVerdictOf(session, layouts);
  throwIfIssues(localityVerdict.kind === "refuse" ? [localityVerdict.message] : []);
  throwIfIssues(await addressMasterIssuesFor(session, layouts, repairSequences));
  return localityVerdict.kind === "warn" ? [localityVerdict.warning] : [];
}
