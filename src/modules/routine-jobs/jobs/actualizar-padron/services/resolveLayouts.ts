import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import {
  ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE,
  ACTUALIZAR_TABLE_ROLE,
  DEFAULT_LOCALITY_TYPE,
  NUMERIC_TYPE_NAMES,
  STAGING_COLUMN,
  type ActualizarTableRole,
} from "../constants";
import {
  polygonalGeometryIssues,
  resolveTable,
  resolveWritableTarget,
  type ResolvedTable,
  type TableSpec,
} from "../../shared/tableResolution";
import { ADDRESS_MASTER_COLUMN } from "../../shared/addressMasterLinkSpec";
import type { ActualizarPadronParams, PadronLayouts } from "../types";
import { resolveLocalityTypeId } from "./preflight";

interface PadronSpecs {
  staging: TableSpec;
  target: TableSpec;
  province: TableSpec;
  locality: TableSpec;
  type?: TableSpec;
  addressMaster?: TableSpec;
}

const specOf = (schema: string, table: string, role: ActualizarTableRole): TableSpec => ({
  label: buildQualifiedTableLabel(schema, table),
  schema,
  table,
  required: ACTUALIZAR_REQUIRED_COLUMNS_BY_ROLE[role],
});

function specsOf(params: ActualizarPadronParams): PadronSpecs {
  const cartoSpec = (table: string, role: ActualizarTableRole): TableSpec => specOf(params.cartoSchema, table, role);
  return {
    staging: specOf(params.stagingSchema, params.stagingTable, ACTUALIZAR_TABLE_ROLE.STAGING),
    target: cartoSpec(
      params.targetTable,
      params.addressMasterTable === undefined ? ACTUALIZAR_TABLE_ROLE.TARGET : ACTUALIZAR_TABLE_ROLE.TARGET_LINKED
    ),
    province: cartoSpec(params.provinceTable, ACTUALIZAR_TABLE_ROLE.PROVINCE),
    locality: cartoSpec(
      params.localityTable,
      params.typeTable === undefined ? ACTUALIZAR_TABLE_ROLE.LOCALITY : ACTUALIZAR_TABLE_ROLE.LOCALITY_TYPED
    ),
    type: params.typeTable === undefined ? undefined : cartoSpec(params.typeTable, ACTUALIZAR_TABLE_ROLE.TYPE),
    addressMaster: addressMasterSpecOf(params),
  };
}

function addressMasterSpecOf(params: ActualizarPadronParams): TableSpec | undefined {
  if (params.addressMasterTable === undefined) return undefined;
  return {
    ...specOf(params.cartoSchema, params.addressMasterTable, ACTUALIZAR_TABLE_ROLE.ADDRESS_MASTER),
    idLogical: ADDRESS_MASTER_COLUMN.ID,
  };
}

const baseTypeOf = (dataType: string): string => dataType.toLowerCase().replace(/\(.*\)$/, "").trim();

function stagingPadronTypeIssues(staging: ResolvedTable): string[] {
  const column = staging.layout.columns[STAGING_COLUMN.PADRON];
  const dataType = staging.dataTypes[STAGING_COLUMN.PADRON];
  if (column === undefined || dataType === undefined || NUMERIC_TYPE_NAMES.has(baseTypeOf(dataType))) return [];
  return [`La columna "${column}" de la tabla ${staging.label} debe ser numérica (numeric), pero es ${dataType}.`];
}

export async function resolvePadronLayouts(session: CatalogQuerySession, params: ActualizarPadronParams): Promise<PadronLayouts> {
  const specs = specsOf(params);
  // One pg client: catalog reads are awaited in turn, so they never overlap.
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const staging = await resolveTable(session, specs.staging);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const target = await resolveWritableTarget(session, specs.target);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const province = await resolveTable(session, specs.province);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const locality = await resolveTable(session, specs.locality);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const type = specs.type === undefined ? undefined : await resolveTable(session, specs.type);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const addressMaster = specs.addressMaster === undefined ? undefined : await resolveWritableTarget(session, specs.addressMaster);
  const issues = [
    ...staging.issues,
    ...polygonalGeometryIssues(staging, STAGING_COLUMN.GEOM),
    ...stagingPadronTypeIssues(staging),
    ...target.issues,
    ...province.issues,
    ...locality.issues,
    ...(type?.issues ?? []),
    ...(addressMaster?.issues ?? []),
  ];
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
  const localityTypeId =
    type === undefined
      ? undefined
      : await resolveLocalityTypeId(session, type.layout, params.options.localityType ?? DEFAULT_LOCALITY_TYPE);
  return {
    staging: staging.layout,
    target: target.target,
    province: province.layout,
    locality: locality.layout,
    type: type?.layout,
    localityTypeId,
    addressMaster: addressMaster?.target,
  };
}
