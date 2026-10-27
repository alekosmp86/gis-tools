import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import {
  polygonalGeometryIssues,
  resolveTable,
  resolveWritableTarget,
  type ResolvedWritableTarget,
  type TableSpec,
} from "../../shared/tableResolution";
import {
  LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE,
  LOCALIDADES_TABLE_ROLE,
  STAGING_LOCALITY_COLUMN,
} from "../constants";
import type { CargarLocalidadesParams, LocalityLayouts } from "../types";

function specsOf(params: CargarLocalidadesParams): {
  padron: TableSpec;
  localities: TableSpec;
  province: TableSpec;
  targets: TableSpec[];
} {
  return {
    padron: {
      label: buildQualifiedTableLabel(params.stagingSchema, params.padronTable),
      schema: params.stagingSchema,
      table: params.padronTable,
      required: LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE[LOCALIDADES_TABLE_ROLE.STAGING_PADRON],
    },
    localities: {
      label: buildQualifiedTableLabel(params.stagingSchema, params.localityStagingTable),
      schema: params.stagingSchema,
      table: params.localityStagingTable,
      required: LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE[LOCALIDADES_TABLE_ROLE.STAGING_LOCALIDAD],
    },
    province: {
      label: buildQualifiedTableLabel(params.provinceSchema, params.provinceTable),
      schema: params.provinceSchema,
      table: params.provinceTable,
      required: LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE[LOCALIDADES_TABLE_ROLE.PROVINCE],
    },
    targets: params.targets.map((target) => ({
      label: buildQualifiedTableLabel(target.schema, target.table),
      schema: target.schema,
      table: target.table,
      required: LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE[LOCALIDADES_TABLE_ROLE.TARGET],
    })),
  };
}

export async function resolveLocalityLayouts(
  session: CatalogQuerySession,
  params: CargarLocalidadesParams
): Promise<LocalityLayouts> {
  const specs = specsOf(params);
  // One pg client: catalog reads are awaited in turn, so they never overlap.
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const padron = await resolveTable(session, specs.padron);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const localities = await resolveTable(session, specs.localities);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const province = await resolveTable(session, specs.province);
  const targets: ResolvedWritableTarget[] = [];
  for (const spec of specs.targets) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    targets.push(await resolveWritableTarget(session, spec));
  }
  const issues = [
    ...padron.issues,
    ...localities.issues,
    ...polygonalGeometryIssues(localities, STAGING_LOCALITY_COLUMN.GEOM),
    ...province.issues,
    ...targets.flatMap((resolved) => resolved.issues),
  ];
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
  return {
    padron: padron.layout,
    localities: localities.layout,
    province: province.layout,
    targets: targets.map((resolved) => resolved.target),
  };
}
