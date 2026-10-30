import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { ADDRESS_MASTER_COLUMN, ADDRESS_MASTER_REQUIRED_COLUMNS } from "../../shared/addressMasterLinkSpec";
import {
  polygonalGeometryIssues,
  resolveTable,
  resolveWritableTarget,
  type TableSpec,
} from "../../shared/tableResolution";
import { UNIT_REQUIRED_COLUMNS_BY_ROLE, UNIT_SOURCE_COLUMN, UNIT_TABLE_ROLE } from "../constants";
import { linksAddressMasterOf } from "../domain/tableRoles";
import type { UnitLayouts, UnitParams } from "../types";
import { resolveUnitTypeId } from "./preflight";

const specOf = (schema: string, table: string, role: keyof typeof UNIT_TABLE_ROLE): TableSpec => ({
  label: buildQualifiedTableLabel(schema, table),
  schema,
  table,
  required: UNIT_REQUIRED_COLUMNS_BY_ROLE[UNIT_TABLE_ROLE[role]],
});

const addressMasterSpecOf = (params: UnitParams): TableSpec | undefined =>
  params.addressMasterTable === undefined
    ? undefined
    : {
        label: buildQualifiedTableLabel(params.addressMasterTable.schema, params.addressMasterTable.table),
        schema: params.addressMasterTable.schema,
        table: params.addressMasterTable.table,
        required: ADDRESS_MASTER_REQUIRED_COLUMNS,
        idLogical: ADDRESS_MASTER_COLUMN.ID,
      };

export async function resolveUnitLayouts(session: CatalogQuerySession, params: UnitParams): Promise<UnitLayouts> {
  const linked = linksAddressMasterOf(params);
  // One pg client: catalog reads are awaited in turn, so they never overlap.
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const locality = await resolveTable(session, specOf(params.localitySchema, params.localityTable, "SOURCE"));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const type = await resolveTable(session, specOf(params.typeSchema, params.typeTable, "TYPE"));
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const target = await resolveWritableTarget(
    session,
    specOf(params.targetSchema, params.targetTable, linked ? "TARGET_LINKED" : "TARGET")
  );
  const addressMasterSpec = addressMasterSpecOf(params);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const addressMaster = addressMasterSpec === undefined ? undefined : await resolveWritableTarget(session, addressMasterSpec);
  const issues = [
    ...locality.issues,
    ...polygonalGeometryIssues(locality, UNIT_SOURCE_COLUMN.GEOMETRY),
    ...type.issues,
    ...target.issues,
    ...(addressMaster?.issues ?? []),
  ];
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
  const unitTypeId = await resolveUnitTypeId(session, type.layout, params.options.localityTypeName);
  return {
    locality: locality.layout,
    type: type.layout,
    target: target.target,
    unitTypeId,
    addressMaster: addressMaster?.target,
  };
}
