import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { resolveTable, resolveWritableTarget, type TableSpec } from "../../shared/tableResolution";
import {
  COMPLETAR_ADDRESS_MASTER_COLUMN,
  COMPLETAR_REQUIRED_COLUMNS_BY_ROLE,
  COMPLETAR_TABLE_ROLE,
} from "../constants";
import type { CompletarLayouts, CompletarParams } from "../types";

const specOf = (schema: string, table: string, role: keyof typeof COMPLETAR_TABLE_ROLE): TableSpec => ({
  label: buildQualifiedTableLabel(schema, table),
  schema,
  table,
  required: COMPLETAR_REQUIRED_COLUMNS_BY_ROLE[COMPLETAR_TABLE_ROLE[role]],
});

export async function resolveCompletarLayouts(
  session: CatalogQuerySession,
  params: CompletarParams
): Promise<CompletarLayouts> {
  // One pg client: catalog reads are awaited in turn, so they never overlap.
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const unit = await resolveTable(session, specOf(params.unitSchema, params.unitTable, "UNIT"));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const addressMaster = await resolveWritableTarget(session, {
    ...specOf(params.addressMasterSchema, params.addressMasterTable, "ADDRESS_MASTER"),
    idLogical: COMPLETAR_ADDRESS_MASTER_COLUMN.ID,
  });
  const issues = [...unit.issues, ...addressMaster.issues];
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
  return { unit: unit.layout, addressMaster: addressMaster.target };
}
