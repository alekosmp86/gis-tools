import type { CatalogQuerySession } from "@/core/services/server/tableCatalog/tableCatalog";
import { GENERIC_SRID } from "../../actualizar-padron/constants";
import { parseGeometryType, type GeometryTyping } from "../../actualizar-padron/domain/geometryType";
import { readIdentityColumns } from "../../actualizar-padron/services/catalogFacts";
import { throwIfIssues } from "../../shared/preflightAsserts";
import { readIdSequence } from "../../shared/tableFacts";
import { resolveTable, type ResolvedTable, type WritableTargetLayout } from "../../shared/tableResolution";
import { tableStructureIssuesOf } from "../../shared/targetPreflight";
import { CENTROS_COLUMN, CENTROS_REQUIRED_COLUMNS_BY_ROLE, CENTROS_TABLE_ROLE, type CentrosTableRole } from "../constants";
import { columnPlanBlockers, isDefaultFilled, planColumns } from "../domain/columnPlan";
import { geometrySridIssues } from "../domain/geometryIssues";
import { labelOfCentrosTable } from "../domain/tableRoles";
import type { CentrosFinalLayout, CentrosParams, CentrosResolved, CentrosStagingLayout } from "../types";

const STRUCTURE_TITLE = "final";

const typingOf = (resolved: ResolvedTable): GeometryTyping | undefined => {
  const dataType = resolved.dataTypes[CENTROS_COLUMN.GEOM];
  return dataType === undefined ? undefined : parseGeometryType(dataType);
};

const geometryColumnOf = (resolved: ResolvedTable): string => resolved.layout.columns[CENTROS_COLUMN.GEOM] ?? "";

const resolveRole = (session: CatalogQuerySession, params: CentrosParams, role: CentrosTableRole): Promise<ResolvedTable> =>
  resolveTable(session, {
    label: labelOfCentrosTable(params.tables, role),
    schema: params.tables[role].schema,
    table: params.tables[role].table,
    required: CENTROS_REQUIRED_COLUMNS_BY_ROLE[role],
  });

async function defaultSequenceTargetsOf(
  session: CatalogQuerySession,
  final: CentrosFinalLayout
): Promise<WritableTargetLayout[]> {
  const targets: WritableTargetLayout[] = [];
  for (const entry of final.catalog) {
    if (!isDefaultFilled(entry, final.identityColumns)) continue;
    // One pg client: catalog reads are awaited in turn, so they never overlap.
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    const idSequence = await readIdSequence(session, final, entry.column_name, entry.column_default);
    targets.push({ ...final, idColumn: entry.column_name, idSequence });
  }
  return targets;
}

export async function resolveCentrosLayouts(session: CatalogQuerySession, params: CentrosParams): Promise<CentrosResolved> {
  // One pg client: catalog reads are awaited in turn, so they never overlap.
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const stagingTable = await resolveRole(session, params, CENTROS_TABLE_ROLE.STAGING);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const finalTable = await resolveRole(session, params, CENTROS_TABLE_ROLE.FINAL);
  throwIfIssues([...stagingTable.issues, ...finalTable.issues]);
  const stagingTyping = typingOf(stagingTable);
  const finalTyping = typingOf(finalTable);
  const identityColumns = await readIdentityColumns(session, finalTable.layout);
  const final: CentrosFinalLayout = {
    ...finalTable.layout,
    srid: finalTyping?.srid ?? GENERIC_SRID,
    idColumn: "",
    idSequence: null,
    identityColumns,
    catalog: finalTable.catalog,
  };
  const staging: CentrosStagingLayout = {
    layout: stagingTable.layout,
    catalog: stagingTable.catalog,
    srid: stagingTyping?.srid,
  };
  const plan = planColumns({
    stagingCatalog: stagingTable.catalog,
    finalCatalog: finalTable.catalog,
    stagingGeometry: geometryColumnOf(stagingTable),
    finalGeometry: geometryColumnOf(finalTable),
    identityColumns,
  });
  const structureIssues = await tableStructureIssuesOf(session, final, STRUCTURE_TITLE);
  const schemaBlockers = [
    ...geometrySridIssues(stagingTable.label, geometryColumnOf(stagingTable), stagingTyping),
    ...geometrySridIssues(finalTable.label, geometryColumnOf(finalTable), finalTyping),
    ...columnPlanBlockers(plan, finalTable.label, stagingTable.label),
    ...structureIssues,
  ];
  return { staging, final, defaultSequenceTargets: await defaultSequenceTargetsOf(session, final), plan, schemaBlockers };
}
