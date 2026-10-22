import { quoteIdentifier, resolveSchemaName } from "@/core/services/sqlStatements";

export const STAGE_TABLE = "shp_replace_stage";
export const GEOMETRY_STAGE_COLUMN = "geom_json";

const STAGE_RECORD_COLUMN = "rec";
const STAGE_FIELD_PREFIX = "c";
const MAX_SRID = 998999;
const UNCONSTRAINED_SRID = 0;
const TEXT_LIKE_TYPES: ReadonlySet<string> = new Set([
  "text",
  "character varying",
  "character",
  "varchar",
  "char",
  "bpchar",
  "citext",
  "name",
]);

export const InsertColumnKind = {
  SOURCE: "source",
  GEOMETRY: "geometry",
  DEFAULT: "default",
} as const;

export type InsertColumnPlan =
  | { readonly targetColumn: string; readonly dataType: string; readonly kind: typeof InsertColumnKind.SOURCE; readonly stageColumn: string }
  | { readonly targetColumn: string; readonly dataType: string; readonly kind: typeof InsertColumnKind.GEOMETRY }
  | { readonly targetColumn: string; readonly dataType: string; readonly kind: typeof InsertColumnKind.DEFAULT; readonly defaultSql: string };

export interface GeometryPlan {
  readonly sourceSrid: number;
  readonly targetSrid: number;
  readonly multi: boolean;
}

export const stageColumnName = (index: number): string => `${STAGE_FIELD_PREFIX}${index}`;

const buildStageFieldNames = (fieldCount: number, hasGeometry: boolean): string[] => [
  ...Array.from({ length: fieldCount }, (_entry, index) => stageColumnName(index)),
  ...(hasGeometry ? [GEOMETRY_STAGE_COLUMN] : []),
];

export const buildCreateStageSql = (fieldCount: number, hasGeometry: boolean): string => {
  const columns = [
    `${quoteIdentifier(STAGE_RECORD_COLUMN)} integer`,
    ...buildStageFieldNames(fieldCount, hasGeometry).map((name) => `${quoteIdentifier(name)} text`),
  ];
  return `CREATE TEMP TABLE ${quoteIdentifier(STAGE_TABLE)} (${columns.join(", ")}) ON COMMIT DROP`;
};

export const buildCopySql = (fieldCount: number, hasGeometry: boolean): string => {
  const columns = [STAGE_RECORD_COLUMN, ...buildStageFieldNames(fieldCount, hasGeometry)].map((name) =>
    quoteIdentifier(name)
  );
  return `COPY ${quoteIdentifier(STAGE_TABLE)} (${columns.join(",")}) FROM STDIN`;
};

export const assertSafeSridNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > MAX_SRID) {
    throw new Error(`El SRID debe ser un entero entre 1 y ${MAX_SRID}.`);
  }
  return value;
};

const isTextLikeType = (dataType: string): boolean => TEXT_LIKE_TYPES.has(dataType.trim().toLowerCase());

const buildSourceExpression = (stageColumn: string, dataType: string): string => {
  const stageReference = quoteIdentifier(stageColumn);
  return isTextLikeType(dataType) ? stageReference : `NULLIF(${stageReference},'')::${dataType}`;
};

const assertSafeTargetSridNumber = (value: unknown): number =>
  value === UNCONSTRAINED_SRID ? UNCONSTRAINED_SRID : assertSafeSridNumber(value);

const buildReprojectedGeometry = (sourceGeometry: string, sourceSrid: number, targetSrid: number): string =>
  targetSrid === UNCONSTRAINED_SRID || sourceSrid === targetSrid
    ? sourceGeometry
    : `ST_Transform(${sourceGeometry},${targetSrid})`;

const buildGeometryExpression = (geometry: GeometryPlan): string => {
  const sourceSrid = assertSafeSridNumber(geometry.sourceSrid);
  const targetSrid = assertSafeTargetSridNumber(geometry.targetSrid);
  const geoJsonInput = `NULLIF(${quoteIdentifier(GEOMETRY_STAGE_COLUMN)},'')`;
  const sourceGeometry = `ST_SetSRID(ST_GeomFromGeoJSON(${geoJsonInput}),${sourceSrid})`;
  const reprojected = buildReprojectedGeometry(sourceGeometry, sourceSrid, targetSrid);
  return geometry.multi ? `ST_Multi(${reprojected})` : reprojected;
};

const requireGeometryPlan = (geometry: GeometryPlan | undefined): GeometryPlan => {
  if (!geometry) {
    throw new Error("Falta el plan de geometría para la columna geométrica.");
  }
  return geometry;
};

const buildSelectExpression = (column: InsertColumnPlan, geometry: GeometryPlan | undefined): string => {
  switch (column.kind) {
    case InsertColumnKind.SOURCE:
      return buildSourceExpression(column.stageColumn, column.dataType);
    case InsertColumnKind.GEOMETRY:
      return buildGeometryExpression(requireGeometryPlan(geometry));
    case InsertColumnKind.DEFAULT:
      return column.defaultSql;
  }
};

export const buildInsertSelectSql = (
  schema: string | null | undefined,
  table: string,
  columns: ReadonlyArray<InsertColumnPlan>,
  geometry?: GeometryPlan
): string => {
  const targetTable = `${quoteIdentifier(resolveSchemaName(schema))}.${quoteIdentifier(table)}`;
  const targetColumns = columns.map((column) => quoteIdentifier(column.targetColumn)).join(",");
  const selectList = columns.map((column) => buildSelectExpression(column, geometry)).join(", ");
  return `INSERT INTO ${targetTable} (${targetColumns}) SELECT ${selectList} FROM ${quoteIdentifier(STAGE_TABLE)} ORDER BY ${quoteIdentifier(STAGE_RECORD_COLUMN)}`;
};
