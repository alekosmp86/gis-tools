import { AREA_DECIMALS, GEOGRAPHIC_SRID, SOURCE_LABEL, SOURCE_SRID, STAGING_TABLE } from "../../constants";
import {
  ComputedKind,
  type ComputedColumn,
  type LayerColumns,
  type MappedFeature,
  type SigraLayerDefinition,
} from "../../types";
import { quoteIdentifier } from "./identifiers";

const STAGING = quoteIdentifier(STAGING_TABLE);
const PAGE_ROWS = "page_rows";
const GEOMETRY_VALUE = "geometry_value";
const GEOJSON_COLUMN = "geojson";

/** The final table is a bind parameter, so reading its column types never names it in the statement text. */
export const FINAL_TYPES_SQL = `
SELECT attribute.attname AS column_name, format_type(attribute.atttypid, attribute.atttypmod) AS column_type
FROM pg_attribute attribute
WHERE attribute.attrelid = to_regclass($1::text)
  AND attribute.attnum > 0
  AND NOT attribute.attisdropped
`;

const EXTRA_COLUMN_TYPE = "text";

/** Types of the staging columns: those of the final table, and text for the layer's extra columns. */
export function stagingColumnTypes(
  layer: SigraLayerDefinition,
  columns: LayerColumns,
  finalTypes: Readonly<Record<string, string>>,
): Record<string, string> {
  const extraColumns = new Set(layer.extraStagingColumns);
  const entries = columns.stagingColumns.map((column) => {
    const type = extraColumns.has(column) ? EXTRA_COLUMN_TYPE : finalTypes[column];
    if (type === undefined) {
      throw new Error(`La tabla ${layer.finalTable} no tiene la columna ${column}.`);
    }
    return [column, type] as const;
  });
  return Object.fromEntries(entries);
}

export function createStagingSql(columns: LayerColumns, types: Readonly<Record<string, string>>): string {
  const definitions = columns.stagingColumns.map((column) => `${quoteIdentifier(column)} ${types[column]}`).join(", ");
  return `CREATE TEMP TABLE ${STAGING} (${definitions}) ON COMMIT DROP`;
}

export function createStagingKeyIndexSql(layer: SigraLayerDefinition): string {
  return `CREATE UNIQUE INDEX ${quoteIdentifier(`${STAGING_TABLE}_key`)} ON ${STAGING} (${quoteIdentifier(layer.keyColumn)})`;
}

const usesSourceParameter = (columns: LayerColumns): boolean =>
  columns.computed.some((entry) => entry.kind === ComputedKind.SOURCE);

const valueAlias = (index: number): string => `value_${index}`;

function computedExpression(kind: ComputedKind, sourceParameter: string): string {
  const geometry = `${PAGE_ROWS}.${GEOMETRY_VALUE}`;
  switch (kind) {
    case ComputedKind.LOAD_DATE:
      return "now()";
    case ComputedKind.SOURCE:
      return `${sourceParameter}::text`;
    case ComputedKind.AREA:
      return `ST_Area(${geometry})`;
    case ComputedKind.ROUNDED_AREA:
      return `ROUND(ST_Area(${geometry})::numeric, ${AREA_DECIMALS})`;
    case ComputedKind.LATITUDE:
      return `ST_Y(ST_Transform(${geometry}, ${GEOGRAPHIC_SRID}))`;
    case ComputedKind.LONGITUDE:
      return `ST_X(ST_Transform(${geometry}, ${GEOGRAPHIC_SRID}))`;
  }
}

function typeOf(columnTypes: Readonly<Record<string, string>>, column: string): string {
  const type = columnTypes[column];
  if (type === undefined) throw new Error(`La tabla temporal no tiene la columna ${column}.`);
  return type;
}

function selectionFor(
  column: string,
  columns: LayerColumns,
  geomColumn: string,
  columnTypes: Readonly<Record<string, string>>,
  sourceParameter: string,
): string {
  if (column === geomColumn) return `${PAGE_ROWS}.${GEOMETRY_VALUE}`;
  const computed: ComputedColumn | undefined = columns.computed.find((entry) => entry.column === column);
  const expression = computed
    ? computedExpression(computed.kind, sourceParameter)
    : `${PAGE_ROWS}.${valueAlias(columns.valueColumns.indexOf(column))}`;
  return `CAST(${expression} AS ${typeOf(columnTypes, column)})`;
}

export function pageInsertSql(
  layer: SigraLayerDefinition,
  columns: LayerColumns,
  columnTypes: Readonly<Record<string, string>>,
): string {
  const arrayCount = columns.valueColumns.length + 1;
  const sourceParameter = `$${arrayCount + 1}`;
  const arrays = Array.from({ length: arrayCount }, (_unused, index) => `$${index + 1}::text[]`).join(", ");
  const aliases = [...columns.valueColumns.map((_column, index) => valueAlias(index)), GEOJSON_COLUMN].join(", ");
  const selection = columns.stagingColumns
    .map((column) => selectionFor(column, columns, layer.geomColumn, columnTypes, sourceParameter))
    .join(", ");
  const targets = columns.stagingColumns.map(quoteIdentifier).join(", ");
  return `WITH inserted AS (
  INSERT INTO ${STAGING} (${targets})
  SELECT ${selection}
  FROM (
    SELECT ${PAGE_ROWS}.*, ST_SetSRID(ST_GeomFromGeoJSON(${PAGE_ROWS}.${GEOJSON_COLUMN}), ${SOURCE_SRID}) AS ${GEOMETRY_VALUE}
    FROM unnest(${arrays}) AS ${PAGE_ROWS}(${aliases})
  ) AS ${PAGE_ROWS}
  ON CONFLICT (${quoteIdentifier(layer.keyColumn)}) DO NOTHING
  RETURNING 1
)
SELECT count(*)::int AS inserted FROM inserted`;
}

function asText(value: string | number | null | undefined): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function pageParameters(columns: LayerColumns, rows: ReadonlyArray<MappedFeature>): unknown[] {
  const valueArrays = columns.valueColumns.map((column) => rows.map((row) => asText(row.values[column])));
  const geometries = rows.map((row) => row.geometryJson);
  return [...valueArrays, geometries, ...(usesSourceParameter(columns) ? [SOURCE_LABEL] : [])];
}
