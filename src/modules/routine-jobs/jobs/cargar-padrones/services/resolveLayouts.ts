import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import {
  fetchCatalogColumns,
  matchColumns,
  type CatalogQuerySession,
} from "@/core/services/server/tableCatalog/tableCatalog";
import type { DbColumnMetadata } from "@/core/types/db";
import { ColumnStatus, type ResolvedColumn } from "@/core/types/tableCatalog";
import {
  COLUMN,
  MULTIPOLYGON_TYPE,
  POLYGON_TYPE,
  RURAL_REQUIRED_COLUMNS,
  TARGET_REQUIRED_COLUMNS,
  URBANO_REQUIRED_COLUMNS,
} from "../constants";
import type { SourceLayout, TargetLayout } from "../domain/loadSql";
import type { CargarPadronesParams } from "../types";

export interface ResolvedLayouts {
  rural: SourceLayout;
  urbano: SourceLayout;
  target: TargetLayout;
  targetCatalog: DbColumnMetadata[];
}

interface ResolvedTable {
  columns: Record<string, string>;
  dataTypes: Record<string, string>;
  issues: string[];
}

interface GeometryTyping {
  typeName?: string;
  srid: number;
}

type ResolvedEntry = ResolvedColumn & { column: string };

const SOURCE_GEOMETRY_TYPES: readonly string[] = [POLYGON_TYPE, MULTIPOLYGON_TYPE];
const SOURCE_GEOMETRY_TEXT = "Polygon o MultiPolygon";
const TARGET_GEOMETRY_TYPES: readonly string[] = [MULTIPOLYGON_TYPE];
const TARGET_GEOMETRY_TEXT = "MultiPolygon";
const GEOMETRY_TYPE_PATTERN = /^geometry(?:\(\s*([A-Za-z]+)\s*(?:,\s*(\d+)\s*)?\))?$/i;
const GENERIC_GEOMETRY_TYPE = "GEOMETRY";
const DIMENSION_SUFFIX = /(ZM|Z|M)$/i;

const isResolved = (entry: ResolvedColumn): entry is ResolvedEntry =>
  entry.status === ColumnStatus.RESOLVED && entry.column !== undefined;

const recordOf = (pairs: Array<[string, string]>): Record<string, string> => Object.fromEntries(pairs);

export const DISTINCT_TABLES_MESSAGE = "Las tablas rural, urbana y destino deben ser tres tablas distintas.";

export function assertDistinctTables(params: CargarPadronesParams): void {
  const tables = [params.ruralTable, params.urbanoTable, params.targetTable];
  if (new Set(tables).size !== tables.length) {
    throw new Error(DISTINCT_TABLES_MESSAGE);
  }
}

function parseGeometryType(dataType: string): GeometryTyping | undefined {
  const match = GEOMETRY_TYPE_PATTERN.exec(dataType.trim());
  if (!match) return undefined;
  return { typeName: match[1]?.replace(DIMENSION_SUFFIX, "").toUpperCase(), srid: Number(match[2] ?? 0) };
}

function issueOf(label: string, entry: ResolvedColumn): string[] {
  if (entry.status === ColumnStatus.RESOLVED) return [];
  if (entry.status === ColumnStatus.AMBIGUOUS) {
    return [`La columna requerida "${entry.logical}" de la tabla ${label} es ambigua: coincide con más de una columna.`];
  }
  const hint = entry.suggestion ? ` (¿quiso decir "${entry.suggestion}"?)` : "";
  return [`La tabla ${label} no tiene la columna requerida "${entry.logical}"${hint}.`];
}

function resolveTable(label: string, catalog: DbColumnMetadata[], required: readonly string[]): ResolvedTable {
  if (catalog.length === 0) {
    return { columns: {}, dataTypes: {}, issues: [`La tabla ${label} no existe o no tiene columnas.`] };
  }
  const entries = matchColumns(catalog, required);
  const resolved = entries.filter(isResolved);
  return {
    columns: recordOf(resolved.map((entry): [string, string] => [entry.logical, entry.column])),
    dataTypes: recordOf(resolved.map((entry): [string, string] => [entry.logical, entry.dataType ?? ""])),
    issues: entries.flatMap((entry) => issueOf(label, entry)),
  };
}

function geometryIssuesOf(
  label: string,
  table: ResolvedTable,
  allowedTypes: readonly string[],
  allowedText: string
): string[] {
  const dataType = table.dataTypes[COLUMN.GEOM];
  const column = table.columns[COLUMN.GEOM];
  if (dataType === undefined || column === undefined) return [];
  const typing = parseGeometryType(dataType);
  if (!typing) {
    return [`La columna geométrica "${column}" de la tabla ${label} no es de tipo geometría.`];
  }
  if (typing.typeName !== undefined && typing.typeName !== GENERIC_GEOMETRY_TYPE && !allowedTypes.includes(typing.typeName)) {
    return [`La columna geométrica "${column}" de la tabla ${label} es ${typing.typeName}; debe ser ${allowedText}.`];
  }
  return [];
}

export async function resolveLayouts(session: CatalogQuerySession, params: CargarPadronesParams): Promise<ResolvedLayouts> {
  const { schema } = params;
  const ruralLabel = buildQualifiedTableLabel(schema, params.ruralTable);
  const urbanoLabel = buildQualifiedTableLabel(schema, params.urbanoTable);
  const targetLabel = buildQualifiedTableLabel(schema, params.targetTable);
  // One pg client: catalog queries must not overlap.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const ruralCatalog = await fetchCatalogColumns(session, schema, params.ruralTable);
  const rural = resolveTable(ruralLabel, ruralCatalog, RURAL_REQUIRED_COLUMNS);
  // One pg client: catalog queries must not overlap.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const urbanoCatalog = await fetchCatalogColumns(session, schema, params.urbanoTable);
  const urbano = resolveTable(urbanoLabel, urbanoCatalog, URBANO_REQUIRED_COLUMNS);
  // One pg client: catalog queries must not overlap.
  // react-doctor-disable-next-line react-doctor/server-sequential-independent-await
  const targetCatalog = await fetchCatalogColumns(session, schema, params.targetTable);
  const target = resolveTable(targetLabel, targetCatalog, TARGET_REQUIRED_COLUMNS);
  const issues = [
    ...rural.issues,
    ...urbano.issues,
    ...target.issues,
    ...geometryIssuesOf(ruralLabel, rural, SOURCE_GEOMETRY_TYPES, SOURCE_GEOMETRY_TEXT),
    ...geometryIssuesOf(urbanoLabel, urbano, SOURCE_GEOMETRY_TYPES, SOURCE_GEOMETRY_TEXT),
    ...geometryIssuesOf(targetLabel, target, TARGET_GEOMETRY_TYPES, TARGET_GEOMETRY_TEXT),
  ];
  if (issues.length > 0) {
    throw new Error(issues.join(" "));
  }
  return {
    rural: { schema, table: params.ruralTable, columns: rural.columns },
    urbano: { schema, table: params.urbanoTable, columns: urbano.columns },
    target: {
      schema,
      table: params.targetTable,
      columns: target.columns,
      srid: parseGeometryType(target.dataTypes[COLUMN.GEOM] ?? "")?.srid ?? 0,
    },
    targetCatalog,
  };
}
