import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import {
  fetchCatalogColumns,
  matchColumns,
  type CatalogQuerySession,
} from "@/core/services/server/tableCatalog/tableCatalog";
import type { DbColumnMetadata } from "@/core/types/db";
import { ColumnStatus, type ResolvedColumn } from "@/core/types/tableCatalog";
import { GENERIC_GEOMETRY_TYPE, GENERIC_SRID } from "../../actualizar-padron/constants";
import type { TableLayout } from "../../actualizar-padron/domain/layouts";
import { parseGeometryType } from "../../actualizar-padron/domain/geometryType";
import { readIdentityColumns } from "../../actualizar-padron/services/catalogFacts";
import {
  LOCALIDADES_REQUIRED_COLUMNS_BY_ROLE,
  LOCALIDADES_TABLE_ROLE,
  POLYGON_TYPES,
  STAGING_LOCALITY_COLUMN,
  TARGET_COLUMN,
} from "../constants";
import { geometryColumnIssues } from "../domain/targetIssues";
import type { CargarLocalidadesParams, LocalityLayouts, LocalityTargetLayout } from "../types";
import { readIdSequence, readSpatialRef } from "./tableFacts";

interface TableSpec {
  label: string;
  schema: string;
  table: string;
  required: readonly string[];
}

interface ResolvedTable {
  label: string;
  layout: TableLayout;
  catalog: DbColumnMetadata[];
  dataTypes: Record<string, string>;
  issues: string[];
}

interface ResolvedTarget {
  target: LocalityTargetLayout;
  issues: string[];
}

type ResolvedEntry = ResolvedColumn & { column: string };

const isResolved = (entry: ResolvedColumn): entry is ResolvedEntry =>
  entry.status === ColumnStatus.RESOLVED && entry.column !== undefined;

function issuesOfColumn(label: string, entry: ResolvedColumn): string[] {
  if (entry.status === ColumnStatus.RESOLVED) return [];
  if (entry.status === ColumnStatus.AMBIGUOUS) {
    return [`La columna requerida "${entry.logical}" de la tabla ${label} es ambigua: coincide con más de una columna.`];
  }
  const hint = entry.suggestion ? ` (¿quiso decir "${entry.suggestion}"?)` : "";
  return [`La tabla ${label} no tiene la columna requerida "${entry.logical}"${hint}.`];
}

async function resolveTable(session: CatalogQuerySession, spec: TableSpec): Promise<ResolvedTable> {
  const catalog = await fetchCatalogColumns(session, spec.schema, spec.table);
  const emptyLayout: TableLayout = { schema: spec.schema, table: spec.table, columns: {} };
  if (catalog.length === 0) {
    return {
      label: spec.label,
      layout: emptyLayout,
      catalog,
      dataTypes: {},
      issues: [`La tabla ${spec.label} no existe o no tiene columnas.`],
    };
  }
  const entries = matchColumns(catalog, spec.required);
  const resolved = entries.filter(isResolved);
  return {
    label: spec.label,
    layout: {
      schema: spec.schema,
      table: spec.table,
      columns: Object.fromEntries(resolved.map((entry): [string, string] => [entry.logical, entry.column])),
    },
    catalog,
    dataTypes: Object.fromEntries(resolved.map((entry): [string, string] => [entry.logical, entry.dataType ?? ""])),
    issues: entries.flatMap((entry) => issuesOfColumn(spec.label, entry)),
  };
}

function localityGeometryIssues(staging: ResolvedTable): string[] {
  const column = staging.layout.columns[STAGING_LOCALITY_COLUMN.GEOM];
  const dataType = staging.dataTypes[STAGING_LOCALITY_COLUMN.GEOM];
  if (column === undefined || dataType === undefined) return [];
  const typing = parseGeometryType(dataType);
  if (typing === undefined) return [`La columna "${column}" de la tabla ${staging.label} no es de tipo geometría.`];
  const typeName = typing.typeName?.toUpperCase();
  if (typeName === undefined || typeName === GENERIC_GEOMETRY_TYPE || POLYGON_TYPES.includes(typeName)) return [];
  return [`La columna geométrica "${column}" de la tabla ${staging.label} es ${typing.typeName}; debe ser Polygon o MultiPolygon.`];
}

async function resolveTarget(session: CatalogQuerySession, spec: TableSpec): Promise<ResolvedTarget> {
  const resolved = await resolveTable(session, spec);
  const column = resolved.layout.columns[TARGET_COLUMN.GEOMETRY];
  const dataType = resolved.dataTypes[TARGET_COLUMN.GEOMETRY];
  const typing = dataType === undefined ? undefined : parseGeometryType(dataType);
  const spatialRef =
    typing === undefined || typing.srid === GENERIC_SRID ? undefined : await readSpatialRef(session, typing.srid);
  const geometryIssues =
    column === undefined || dataType === undefined ? [] : geometryColumnIssues(spec.label, column, typing, spatialRef);
  const idColumn = resolved.layout.columns[TARGET_COLUMN.ID] ?? "";
  const idSequence = idColumn === "" ? null : await readIdSequence(session, resolved.layout, idColumn);
  const identityColumns = resolved.catalog.length === 0 ? [] : await readIdentityColumns(session, resolved.layout);
  return {
    target: {
      ...resolved.layout,
      srid: typing?.srid ?? GENERIC_SRID,
      idColumn,
      idSequence,
      identityColumns,
      catalog: resolved.catalog,
    },
    issues: [...resolved.issues, ...geometryIssues],
  };
}

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
  const targets: ResolvedTarget[] = [];
  for (const spec of specs.targets) {
    // react-doctor-disable-next-line react-doctor/async-await-in-loop
    targets.push(await resolveTarget(session, spec));
  }
  const issues = [
    ...padron.issues,
    ...localities.issues,
    ...localityGeometryIssues(localities),
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
