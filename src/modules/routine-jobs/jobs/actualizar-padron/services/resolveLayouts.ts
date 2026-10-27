import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import {
  fetchCatalogColumns,
  matchColumns,
  type CatalogQuerySession,
} from "@/core/services/server/tableCatalog/tableCatalog";
import type { DbColumnMetadata } from "@/core/types/db";
import { ColumnStatus, type ResolvedColumn } from "@/core/types/tableCatalog";
import {
  DEFAULT_LOCALITY_TYPE,
  GENERIC_GEOMETRY_TYPE,
  GENERIC_SRID,
  LOCALITY_REQUIRED_COLUMNS,
  LOCALITY_TYPED_REQUIRED_COLUMNS,
  NUMERIC_TYPE_NAMES,
  PADRON_COLUMN,
  PADRON_REQUIRED_COLUMNS,
  PROVINCE_REQUIRED_COLUMNS,
  STAGING_COLUMN,
  STAGING_GEOMETRY_TYPES,
  STAGING_REQUIRED_COLUMNS,
  TABLE_LABEL,
  TYPE_REQUIRED_COLUMNS,
  WORK_COLUMN,
  WORK_GEOMETRY_TYPES,
  WORK_REQUIRED_COLUMNS,
} from "../constants";
import { parseGeometryType } from "../domain/geometryType";
import type { PopulateLayouts, TableLayout } from "../domain/layouts";
import { relationFactIssues, relationKindIssues } from "../domain/workTableIssues";
import type { ActualizarPadronParams, WorkCatalogColumn } from "../types";
import { readIdentityColumns, readPadronIdSequence, readRelationKind, readTriggerAndRuleFacts } from "./catalogFacts";

export interface ResolvedActualizarLayouts extends PopulateLayouts {
  padron: TableLayout;
  padronIdSequence: string | null;
  workCatalog: WorkCatalogColumn[];
  padronCatalog: DbColumnMetadata[];
}

interface TableSpec {
  schema: string;
  table: string;
  required: readonly string[];
}

interface ResolvedTable {
  label: string;
  layout: TableLayout;
  dataTypes: Record<string, string>;
  catalog: DbColumnMetadata[];
  issues: string[];
}

interface GeometryRule {
  allowedTypes?: readonly string[];
  allowedText: string;
  requireSrid: boolean;
}

type ResolvedEntry = ResolvedColumn & { column: string };

const STAGING_GEOMETRY_RULE: GeometryRule = {
  allowedTypes: STAGING_GEOMETRY_TYPES,
  allowedText: "Polygon o MultiPolygon",
  requireSrid: false,
};
const WORK_GEOMETRY_RULE: GeometryRule = { allowedTypes: WORK_GEOMETRY_TYPES, allowedText: "MultiPolygon", requireSrid: false };
const PADRON_GEOMETRY_RULE: GeometryRule = { allowedText: "", requireSrid: true };

const isResolved = (entry: ResolvedColumn): entry is ResolvedEntry =>
  entry.status === ColumnStatus.RESOLVED && entry.column !== undefined;

const recordOf = (pairs: Array<[string, string]>): Record<string, string> => Object.fromEntries(pairs);

const selectedTypeTable = (params: ActualizarPadronParams): string | undefined =>
  params.typeTable?.trim() ? params.typeTable : undefined;

export function assertDistinctTables(params: ActualizarPadronParams): void {
  const cartoLabel = (table: string): string => buildQualifiedTableLabel(params.cartoSchema, table);
  const roles: Array<[string, string]> = [
    [TABLE_LABEL.STAGING, buildQualifiedTableLabel(params.stagingSchema, params.stagingTable)],
    [TABLE_LABEL.WORK, buildQualifiedTableLabel(params.workSchema, params.workTable)],
    [TABLE_LABEL.PADRON, cartoLabel(params.padronTable)],
    [TABLE_LABEL.PROVINCE, cartoLabel(params.provinceTable)],
    [TABLE_LABEL.LOCALITY, cartoLabel(params.localityTable)],
  ];
  const typeTable = selectedTypeTable(params);
  if (typeTable !== undefined) roles.push([TABLE_LABEL.TYPE, cartoLabel(typeTable)]);
  const seen = new Map<string, string>();
  for (const [role, label] of roles) {
    const earlier = seen.get(label);
    if (earlier !== undefined) {
      throw new Error(`Las tablas de ${earlier} y ${role} no pueden ser la misma tabla (${label}). Elija tablas distintas.`);
    }
    seen.set(label, role);
  }
}

function issueOf(label: string, entry: ResolvedColumn): string[] {
  if (entry.status === ColumnStatus.RESOLVED) return [];
  if (entry.status === ColumnStatus.AMBIGUOUS) {
    return [`La columna requerida "${entry.logical}" de la tabla ${label} es ambigua: coincide con más de una columna.`];
  }
  const hint = entry.suggestion ? ` (¿quiso decir "${entry.suggestion}"?)` : "";
  return [`La tabla ${label} no tiene la columna requerida "${entry.logical}"${hint}.`];
}

function resolveTable(label: string, spec: TableSpec, catalog: DbColumnMetadata[]): ResolvedTable {
  if (catalog.length === 0) {
    return {
      label,
      layout: { schema: spec.schema, table: spec.table, columns: {} },
      dataTypes: {},
      catalog,
      issues: [`La tabla ${label} no existe o no tiene columnas.`],
    };
  }
  const entries = matchColumns(catalog, spec.required);
  const resolved = entries.filter(isResolved);
  return {
    label,
    layout: {
      schema: spec.schema,
      table: spec.table,
      columns: recordOf(resolved.map((entry): [string, string] => [entry.logical, entry.column])),
    },
    dataTypes: recordOf(resolved.map((entry): [string, string] => [entry.logical, entry.dataType ?? ""])),
    catalog,
    issues: entries.flatMap((entry) => issueOf(label, entry)),
  };
}

interface ActualizarSpecs {
  staging: TableSpec;
  work: TableSpec;
  padron: TableSpec;
  province: TableSpec;
  locality: TableSpec;
  type?: TableSpec;
}

interface SourceTables {
  staging: ResolvedTable;
  work: ResolvedTable;
}

interface ReferenceTables {
  padron: ResolvedTable;
  province: ResolvedTable;
  locality: ResolvedTable;
  type?: ResolvedTable;
}

const labelOfSpec = (spec: TableSpec): string => buildQualifiedTableLabel(spec.schema, spec.table);

// One pg client: catalog queries must not overlap, so every read is awaited in turn.
async function readSourceTables(session: CatalogQuerySession, specs: ActualizarSpecs): Promise<SourceTables> {
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const stagingCatalog = await fetchCatalogColumns(session, specs.staging.schema, specs.staging.table);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const workCatalog = await fetchCatalogColumns(session, specs.work.schema, specs.work.table);
  return {
    staging: resolveTable(labelOfSpec(specs.staging), specs.staging, stagingCatalog),
    work: resolveTable(labelOfSpec(specs.work), specs.work, workCatalog),
  };
}

async function readTypeTable(session: CatalogQuerySession, spec: TableSpec | undefined): Promise<ResolvedTable | undefined> {
  if (!spec) return undefined;
  const catalog = await fetchCatalogColumns(session, spec.schema, spec.table);
  return resolveTable(labelOfSpec(spec), spec, catalog);
}

async function readReferenceTables(session: CatalogQuerySession, specs: ActualizarSpecs): Promise<ReferenceTables> {
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const padronCatalog = await fetchCatalogColumns(session, specs.padron.schema, specs.padron.table);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const provinceCatalog = await fetchCatalogColumns(session, specs.province.schema, specs.province.table);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const localityCatalog = await fetchCatalogColumns(session, specs.locality.schema, specs.locality.table);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const type = await readTypeTable(session, specs.type);
  return {
    padron: resolveTable(labelOfSpec(specs.padron), specs.padron, padronCatalog),
    province: resolveTable(labelOfSpec(specs.province), specs.province, provinceCatalog),
    locality: resolveTable(labelOfSpec(specs.locality), specs.locality, localityCatalog),
    type,
  };
}

function geometryIssuesOf(table: ResolvedTable, logical: string, rule: GeometryRule): string[] {
  const dataType = table.dataTypes[logical];
  const column = table.layout.columns[logical];
  if (dataType === undefined || column === undefined) return [];
  const typing = parseGeometryType(dataType);
  if (!typing) {
    return [`La columna "${column}" de la tabla ${table.label} no es de tipo geometría.`];
  }
  const typeName = typing.typeName?.toUpperCase();
  if (typeName !== undefined && typeName !== GENERIC_GEOMETRY_TYPE && rule.allowedTypes && !rule.allowedTypes.includes(typeName)) {
    return [`La columna geométrica "${column}" de la tabla ${table.label} es ${typing.typeName}; debe ser ${rule.allowedText}.`];
  }
  if (rule.requireSrid && typing.srid === GENERIC_SRID) {
    return [`La columna geométrica "${column}" de la tabla ${table.label} no tiene SRID: no se puede determinar el SRID de destino.`];
  }
  return [];
}

const baseTypeOf = (dataType: string): string => dataType.toLowerCase().replace(/\(.*\)$/, "").trim();

function stagingPadronTypeIssues(staging: ResolvedTable): string[] {
  const column = staging.layout.columns[STAGING_COLUMN.PADRON];
  const dataType = staging.dataTypes[STAGING_COLUMN.PADRON];
  if (column === undefined || dataType === undefined || NUMERIC_TYPE_NAMES.has(baseTypeOf(dataType))) return [];
  return [`La columna "${column}" de la tabla ${staging.label} debe ser numérica (numeric), pero es ${dataType}.`];
}

function specsOf(params: ActualizarPadronParams): ActualizarSpecs {
  const typeTable = selectedTypeTable(params);
  return {
    staging: { schema: params.stagingSchema, table: params.stagingTable, required: STAGING_REQUIRED_COLUMNS },
    work: { schema: params.workSchema, table: params.workTable, required: WORK_REQUIRED_COLUMNS },
    padron: { schema: params.cartoSchema, table: params.padronTable, required: PADRON_REQUIRED_COLUMNS },
    province: { schema: params.cartoSchema, table: params.provinceTable, required: PROVINCE_REQUIRED_COLUMNS },
    locality: {
      schema: params.cartoSchema,
      table: params.localityTable,
      required: typeTable === undefined ? LOCALITY_REQUIRED_COLUMNS : LOCALITY_TYPED_REQUIRED_COLUMNS,
    },
    type: typeTable === undefined ? undefined : { schema: params.cartoSchema, table: typeTable, required: TYPE_REQUIRED_COLUMNS },
  };
}

function structuralIssues(tables: SourceTables & ReferenceTables, workRelkind: string | undefined): string[] {
  const { staging, work, padron, province, locality, type } = tables;
  return [
    ...staging.issues,
    ...work.issues,
    ...padron.issues,
    ...province.issues,
    ...locality.issues,
    ...(type?.issues ?? []),
    ...relationKindIssues(work.label, workRelkind),
    ...stagingPadronTypeIssues(staging),
    ...geometryIssuesOf(staging, STAGING_COLUMN.GEOM, STAGING_GEOMETRY_RULE),
    ...geometryIssuesOf(work, WORK_COLUMN.GEOMETRY, WORK_GEOMETRY_RULE),
    ...geometryIssuesOf(padron, PADRON_COLUMN.GEOMETRY, PADRON_GEOMETRY_RULE),
  ];
}

export async function resolveActualizarLayouts(
  session: CatalogQuerySession,
  params: ActualizarPadronParams
): Promise<ResolvedActualizarLayouts> {
  const specs = specsOf(params);
  // One pg client: catalog reads are awaited in turn, the source catalogs first.
  // react-doctor-disable-next-line react-doctor/async-parallel
  const { staging, work } = await readSourceTables(session, specs);
  // react-doctor-disable-next-line react-doctor/async-parallel, react-doctor/server-sequential-independent-await
  const { padron, province, locality, type } = await readReferenceTables(session, specs);
  const workRelkind = await readRelationKind(session, specs.work);
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const workFacts = await readTriggerAndRuleFacts(session, specs.work);
  const issues = [
    ...structuralIssues({ staging, work, padron, province, locality, type }, workRelkind),
    ...relationFactIssues(labelOfSpec(specs.work), workFacts),
  ];
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
  const identityColumns = new Set(await readIdentityColumns(session, specs.work));
  const padronIdSequence = await readPadronIdSequence(session, specs.padron, padron.layout.columns[PADRON_COLUMN.ID]);
  const padronTyping = parseGeometryType(padron.dataTypes[PADRON_COLUMN.GEOMETRY] ?? "");
  return {
    staging: staging.layout,
    work: { ...work.layout, srid: padronTyping?.srid ?? GENERIC_SRID },
    province: province.layout,
    locality: locality.layout,
    padron: padron.layout,
    padronIdSequence,
    workCatalog: work.catalog.map((entry) => ({ ...entry, is_identity: identityColumns.has(entry.column_name) })),
    padronCatalog: padron.catalog,
    unitType: type ? { layout: type.layout, localityType: params.options.localityType ?? DEFAULT_LOCALITY_TYPE } : undefined,
  };
}
