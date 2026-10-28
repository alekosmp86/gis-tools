import type { DbColumnMetadata } from "@/core/types/db";
import {
  fetchCatalogColumns,
  matchColumns,
  type CatalogQuerySession,
} from "@/core/services/server/tableCatalog/tableCatalog";
import { ColumnStatus, type ResolvedColumn } from "@/core/types/tableCatalog";
import { GENERIC_GEOMETRY_TYPE, GENERIC_SRID } from "../actualizar-padron/constants";
import type { TableLayout } from "../actualizar-padron/domain/layouts";
import { parseGeometryType } from "../actualizar-padron/domain/geometryType";
import { readIdentityColumns } from "../actualizar-padron/services/catalogFacts";
import { readIdSequence, readSpatialRef } from "./tableFacts";
import { geometryColumnIssues } from "./targetIssues";

const POLYGON_TYPES: readonly string[] = ["POLYGON", "MULTIPOLYGON"];

export interface TableSpec {
  label: string;
  schema: string;
  table: string;
  required: readonly string[];
}

export interface ResolvedTable {
  label: string;
  layout: TableLayout;
  catalog: DbColumnMetadata[];
  dataTypes: Record<string, string>;
  issues: string[];
}

export interface WritableTargetLayout extends TableLayout {
  srid: number;
  idColumn: string;
  idSequence: string | null;
  identityColumns: string[];
  catalog: DbColumnMetadata[];
}

export interface ResolvedWritableTarget {
  target: WritableTargetLayout;
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

export async function resolveTable(session: CatalogQuerySession, spec: TableSpec): Promise<ResolvedTable> {
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

export function polygonalGeometryIssues(resolved: ResolvedTable, logicalGeometry: string): string[] {
  const column = resolved.layout.columns[logicalGeometry];
  const dataType = resolved.dataTypes[logicalGeometry];
  if (column === undefined || dataType === undefined) return [];
  const typing = parseGeometryType(dataType);
  if (typing === undefined) return [`La columna "${column}" de la tabla ${resolved.label} no es de tipo geometría.`];
  const typeName = typing.typeName?.toUpperCase();
  if (typeName === undefined || typeName === GENERIC_GEOMETRY_TYPE || POLYGON_TYPES.includes(typeName)) return [];
  return [`La columna geométrica "${column}" de la tabla ${resolved.label} es ${typing.typeName}; debe ser Polygon o MultiPolygon.`];
}

export async function resolveWritableTarget(session: CatalogQuerySession, spec: TableSpec): Promise<ResolvedWritableTarget> {
  const resolved = await resolveTable(session, spec);
  const column = resolved.layout.columns.geometry;
  const dataType = resolved.dataTypes.geometry;
  const typing = dataType === undefined ? undefined : parseGeometryType(dataType);
  const spatialRef =
    typing === undefined || typing.srid === GENERIC_SRID ? undefined : await readSpatialRef(session, typing.srid);
  const geometryIssues =
    column === undefined || dataType === undefined ? [] : geometryColumnIssues(spec.label, column, typing, spatialRef);
  const idColumn = resolved.layout.columns.id ?? "";
  const idDefault = resolved.catalog.find((entry) => entry.column_name === idColumn)?.column_default ?? null;
  const idSequence = idColumn === "" ? null : await readIdSequence(session, resolved.layout, idColumn, idDefault);
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
