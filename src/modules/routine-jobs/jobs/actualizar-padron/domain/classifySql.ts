import { quoteIdentifier } from "@/core/services/sqlStatements";
import { PADRON_UNIT } from "../../cargar-padrones/constants";
import {
  LOCALITY_COLUMN,
  LOCALITY_TYPE_COLUMN,
  PROVINCE_COLUMN,
  SKIP_REASON,
  STAGING_COLUMN,
  STAGING_GEOMETRY_TYPES,
  WORK_COLUMN,
} from "../constants";
import { assertTargetSrid, physicalColumn, qualifiedName, type PopulateLayouts, type TableLayout } from "./layouts";
import { unitTypeIdSubquery } from "./unitTypeSql";

export type ClassifyMode = "populate" | "report";

export const DECIDED_CTE = "decided";
const ROW_ID_COLUMN = "row_id";
export const SKIP_REASON_COLUMN = "skip_reason";
export const REPAIRED_COLUMN = "repaired";
const REASON_COLUMN = "reason";
const PRE_REASON_COLUMN = "pre_reason";
const KEY_ROWS_COLUMN = "key_rows";
const NO_GEOMETRY_COLUMN = "no_geometry";
const GEOM_COLUMN = STAGING_COLUMN.GEOM;
const GEOM_FIXED_COLUMN = "geom_fixed";
const GEOMETRY_COLUMN = WORK_COLUMN.GEOMETRY;

const STAGED = "staged";
const PROVINCE_PICK = "province_pick";
const WITH_PROVINCE = "with_province";
const LOCALITY_PICK = "locality_pick";
const LOCATED = "located";
const VALIDATED = "validated";
const FIXED = "fixed";
const SHAPED = "shaped";
const CLASSIFIED = "classified";
const KEYED = "keyed";

const LOCATED_ATTRIBUTES = [
  STAGING_COLUMN.UNIDADCAT,
  STAGING_COLUMN.NOMDEPTO,
  STAGING_COLUMN.NOMLOCCAT,
  STAGING_COLUMN.PADRON,
  WORK_COLUMN.ID_PROVINCE,
  WORK_COLUMN.ID_CADASTRAL_LOCALITY,
  REASON_COLUMN,
];
const VALIDATED_ATTRIBUTES = [...LOCATED_ATTRIBUTES, REPAIRED_COLUMN];
const CLASSIFIED_ATTRIBUTES = [
  STAGING_COLUMN.NOMDEPTO,
  STAGING_COLUMN.NOMLOCCAT,
  STAGING_COLUMN.PADRON,
  WORK_COLUMN.ID_PROVINCE,
  WORK_COLUMN.ID_CADASTRAL_LOCALITY,
  REPAIRED_COLUMN,
];
const NATURAL_KEY_COLUMNS = [WORK_COLUMN.TYPE_PADRON, WORK_COLUMN.NUMBER];

const q = (identifier: string): string => quoteIdentifier(identifier);
const col = (alias: string, column: string): string => `${q(alias)}.${q(column)}`;
const literal = (value: string): string => `'${value}'`;
const carried = (alias: string, columns: readonly string[]): string[] => columns.map((column) => col(alias, column));

const projection = (layout: TableLayout, logicals: readonly string[]): string =>
  logicals.map((logical) => `${physicalColumn(layout, logical)} AS ${q(logical)}`).join(", ");

const URBANO = literal(PADRON_UNIT.URBANO);
const RURAL = literal(PADRON_UNIT.RURAL);
const reasonLiteral = (reason: string): string => literal(reason);
const polygonalTypeList = (): string => STAGING_GEOMETRY_TYPES.map(literal).join(", ");

function stagedSql({ staging }: PopulateLayouts): string {
  const columns = projection(staging, Object.values(STAGING_COLUMN));
  return `SELECT row_number() OVER () AS ${q(ROW_ID_COLUMN)}, ${columns} FROM ${qualifiedName(staging)}`;
}

function provinceSourceSql({ province }: PopulateLayouts): string {
  const columns = projection(province, [PROVINCE_COLUMN.ID, PROVINCE_COLUMN.NAME]);
  return `SELECT ${columns} FROM ${qualifiedName(province)}`;
}

function localitySourceSql({ locality, unitType }: PopulateLayouts): string {
  const logicals = [
    LOCALITY_COLUMN.ID,
    LOCALITY_COLUMN.NAME,
    LOCALITY_COLUMN.ID_PROVINCE,
    ...(unitType ? [LOCALITY_TYPE_COLUMN.ID_TERRITORIAL_UNIT_TYPE] : []),
  ];
  const columns = projection(locality, logicals);
  return `SELECT ${columns} FROM ${qualifiedName(locality)}`;
}

function localityTypeFilterSql({ unitType }: PopulateLayouts): string[] {
  if (!unitType) return [];
  return [`AND ${col("loc", LOCALITY_TYPE_COLUMN.ID_TERRITORIAL_UNIT_TYPE)} = ${unitTypeIdSubquery(unitType)}`];
}

function provincePickSql(layouts: PopulateLayouts): string {
  return [
    `SELECT ${col(STAGED, ROW_ID_COLUMN)}, count(${col("prov", "id")}) AS ${q("province_matches")}, min(${col("prov", "id")}) AS ${q("id")}`,
    `FROM ${q(STAGED)} LEFT JOIN (${provinceSourceSql(layouts)}) AS ${q("prov")} ON upper(${q(STAGING_COLUMN.NOMDEPTO)}) = upper(${q("name")})`,
    `GROUP BY ${col(STAGED, ROW_ID_COLUMN)}`,
  ].join(" ");
}

function withProvinceSql(): string {
  const attributes = [STAGING_COLUMN.UNIDADCAT, STAGING_COLUMN.NOMDEPTO, STAGING_COLUMN.NOMLOCCAT, STAGING_COLUMN.PADRON];
  const columns = [
    col(STAGED, ROW_ID_COLUMN),
    ...attributes.map((attribute) => col(STAGED, attribute)),
    col(PROVINCE_PICK, "province_matches"),
    col(PROVINCE_PICK, "id"),
  ];
  return [
    `SELECT ${columns.join(", ")} FROM ${q(STAGED)}`,
    `JOIN ${q(PROVINCE_PICK)} ON ${col(PROVINCE_PICK, ROW_ID_COLUMN)} = ${col(STAGED, ROW_ID_COLUMN)}`,
  ].join(" ");
}

function localityPickSql(layouts: PopulateLayouts): string {
  return [
    `SELECT ${col("wp", ROW_ID_COLUMN)}, count(${col("loc", "id")}) AS ${q("locality_matches")}, min(${col("loc", "id")}) AS ${q("id_cadastral_locality")}`,
    `FROM ${q(WITH_PROVINCE)} AS ${q("wp")}`,
    `LEFT JOIN (${localitySourceSql(layouts)}) AS ${q("loc")}`,
    `ON ${col("loc", LOCALITY_COLUMN.ID_PROVINCE)} = ${col("wp", "id")}`,
    `AND ${col("wp", STAGING_COLUMN.UNIDADCAT)} = ${URBANO}`,
    `AND upper(${q(STAGING_COLUMN.NOMLOCCAT)}) = upper(${q(LOCALITY_COLUMN.NAME)})`,
    ...localityTypeFilterSql(layouts),
    `GROUP BY ${col("wp", ROW_ID_COLUMN)}`,
  ].join(" ");
}

function resolutionReasonSql(): string {
  const unidad = col("wp", STAGING_COLUMN.UNIDADCAT);
  const nomloccat = col("wp", STAGING_COLUMN.NOMLOCCAT);
  const provinceMatches = col("wp", "province_matches");
  const localityMatches = col("lp", "locality_matches");
  return [
    "CASE",
    `WHEN ${unidad} IS NULL OR ${unidad} NOT IN (${RURAL}, ${URBANO}) OR ${col("wp", STAGING_COLUMN.NOMDEPTO)} IS NULL OR ${col("wp", STAGING_COLUMN.PADRON)} IS NULL THEN ${reasonLiteral(SKIP_REASON.CLAVE_NULA)}`,
    `WHEN ${unidad} = ${URBANO} AND ${nomloccat} IS NULL THEN ${reasonLiteral(SKIP_REASON.CLAVE_NULA)}`,
    `WHEN ${provinceMatches} = 0 THEN ${reasonLiteral(SKIP_REASON.PROVINCIA_NO_ENCONTRADA)}`,
    `WHEN ${provinceMatches} > 1 THEN ${reasonLiteral(SKIP_REASON.PROVINCIA_AMBIGUA)}`,
    `WHEN ${unidad} = ${URBANO} AND ${localityMatches} = 0 THEN ${reasonLiteral(SKIP_REASON.LOCALIDAD_NO_ENCONTRADA)}`,
    `WHEN ${unidad} = ${URBANO} AND ${localityMatches} > 1 THEN ${reasonLiteral(SKIP_REASON.LOCALIDAD_AMBIGUA)}`,
    "END",
  ].join(" ");
}

function locatedSql(): string {
  const columns = [
    col("wp", ROW_ID_COLUMN),
    ...carried("wp", [STAGING_COLUMN.UNIDADCAT, STAGING_COLUMN.NOMDEPTO, STAGING_COLUMN.NOMLOCCAT, STAGING_COLUMN.PADRON]),
    `${col("wp", "id")} AS ${q(WORK_COLUMN.ID_PROVINCE)}`,
    col("lp", WORK_COLUMN.ID_CADASTRAL_LOCALITY),
    `${resolutionReasonSql()} AS ${q(REASON_COLUMN)}`,
  ];
  return [
    `SELECT ${columns.join(", ")} FROM ${q(WITH_PROVINCE)} AS ${q("wp")}`,
    `JOIN ${q(LOCALITY_PICK)} AS ${q("lp")} ON ${col("lp", ROW_ID_COLUMN)} = ${col("wp", ROW_ID_COLUMN)}`,
  ].join(" ");
}

/* ST_IsValid is evaluated once here; later stages read the flag, so no row is validated twice. */
function validatedSql(): string {
  const columns = [
    ...carried(LOCATED, LOCATED_ATTRIBUTES),
    col(STAGED, GEOM_COLUMN),
    `NOT ST_IsValid(${q(GEOM_COLUMN)}) AS ${q(REPAIRED_COLUMN)}`,
  ];
  return [
    `SELECT ${columns.join(", ")}`,
    `FROM ${q(LOCATED)} JOIN ${q(STAGED)} ON ${col(STAGED, ROW_ID_COLUMN)} = ${col(LOCATED, ROW_ID_COLUMN)}`,
  ].join(" ");
}

function fixedSql(): string {
  const geom = q(GEOM_COLUMN);
  const fixedGeometry = [
    "CASE",
    `WHEN ${q(REPAIRED_COLUMN)} THEN ST_CollectionExtract(ST_MakeValid(${geom}), 3)`,
    `WHEN GeometryType(${geom}) NOT IN (${polygonalTypeList()}) THEN ST_CollectionExtract(${geom}, 3)`,
    `ELSE ${geom} END AS ${q(GEOM_FIXED_COLUMN)}`,
  ].join(" ");
  const columns = [...carried(VALIDATED, [...VALIDATED_ATTRIBUTES, GEOM_COLUMN]), fixedGeometry];
  return `SELECT ${columns.join(", ")} FROM ${q(VALIDATED)}`;
}

function populatedGeometrySql(srid: number): string {
  const geom = q(GEOM_COLUMN);
  const fixed = q(GEOM_FIXED_COLUMN);
  const multi = `ST_Multi(CASE WHEN ST_SRID(${geom}) <> ${srid} THEN ST_Transform(${fixed}, ${srid}) ELSE ${fixed} END)`;
  return `ST_Force2D(${multi}) AS ${q(GEOMETRY_COLUMN)}`;
}

function noGeometryFlagSql(): string {
  const fixed = q(GEOM_FIXED_COLUMN);
  return `(${fixed} IS NULL OR ST_IsEmpty(${fixed})) AS ${q(NO_GEOMETRY_COLUMN)}`;
}

function shapedSql(mode: ClassifyMode, srid: number): string {
  const payload = mode === "populate" ? populatedGeometrySql(srid) : noGeometryFlagSql();
  const columns = [...carried(FIXED, VALIDATED_ATTRIBUTES), payload];
  return `SELECT ${columns.join(", ")} FROM ${q(FIXED)}`;
}

/* The geometry travels past shaped only in populate mode; report mode carries the boolean flag instead. */
function geometryPayload(mode: ClassifyMode, alias: string): string[] {
  return mode === "populate" ? carried(alias, [GEOMETRY_COLUMN]) : [];
}

function noGeometryPredicate(mode: ClassifyMode): string {
  if (mode === "report") return q(NO_GEOMETRY_COLUMN);
  const geometry = q(GEOMETRY_COLUMN);
  return `${geometry} IS NULL OR ST_IsEmpty(${geometry})`;
}

function classifiedSql(mode: ClassifyMode): string {
  const preReason = `CASE WHEN ${q(REASON_COLUMN)} IS NOT NULL THEN ${q(REASON_COLUMN)} WHEN ${noGeometryPredicate(mode)} THEN ${reasonLiteral(SKIP_REASON.SIN_GEOMETRIA)} END AS ${q(PRE_REASON_COLUMN)}`;
  const columns = [
    ...carried(SHAPED, CLASSIFIED_ATTRIBUTES),
    ...geometryPayload(mode, SHAPED),
    preReason,
    `${col(SHAPED, STAGING_COLUMN.UNIDADCAT)} AS ${q(WORK_COLUMN.TYPE_PADRON)}`,
    `trunc(${q(STAGING_COLUMN.PADRON)})::text AS ${q(WORK_COLUMN.NUMBER)}`,
  ];
  return `SELECT ${columns.join(", ")} FROM ${q(SHAPED)}`;
}

function keyedSql(mode: ClassifyMode): string {
  const key = (column: string): string => col(CLASSIFIED, column);
  const keyRows = [
    `count(*) OVER (PARTITION BY (${key(PRE_REASON_COLUMN)} IS NULL), ${key(WORK_COLUMN.TYPE_PADRON)}, ${key(WORK_COLUMN.ID_PROVINCE)}, ${key(WORK_COLUMN.ID_CADASTRAL_LOCALITY)}, ${key(WORK_COLUMN.NUMBER)})`,
    `AS ${q(KEY_ROWS_COLUMN)}`,
  ].join(" ");
  const columns = [
    ...carried(CLASSIFIED, [...CLASSIFIED_ATTRIBUTES, PRE_REASON_COLUMN, ...NATURAL_KEY_COLUMNS]),
    ...geometryPayload(mode, CLASSIFIED),
    keyRows,
  ];
  return `SELECT ${columns.join(", ")} FROM ${q(CLASSIFIED)}`;
}

function decidedSql(mode: ClassifyMode): string {
  const preReason = col(KEYED, PRE_REASON_COLUMN);
  const duplicate = `${preReason} IS NULL AND ${col(KEYED, KEY_ROWS_COLUMN)} > 1`;
  const columns = [
    ...carried(KEYED, [...CLASSIFIED_ATTRIBUTES, ...NATURAL_KEY_COLUMNS]),
    ...geometryPayload(mode, KEYED),
    `CASE WHEN ${duplicate} THEN ${reasonLiteral(SKIP_REASON.CLAVE_DUPLICADA)} ELSE ${preReason} END AS ${q(SKIP_REASON_COLUMN)}`,
  ];
  return `SELECT ${columns.join(", ")} FROM ${q(KEYED)}`;
}

/* One CTE chain per statement: each row is staged once, then resolved, validated, shaped, keyed and decided. */
export function buildClassifyWith(layouts: PopulateLayouts, mode: ClassifyMode = "populate"): string {
  assertTargetSrid(layouts.work.srid);
  const definitions: Array<[string, string]> = [
    [STAGED, stagedSql(layouts)],
    [PROVINCE_PICK, provincePickSql(layouts)],
    [WITH_PROVINCE, withProvinceSql()],
    [LOCALITY_PICK, localityPickSql(layouts)],
    [LOCATED, locatedSql()],
    [VALIDATED, validatedSql()],
    [FIXED, fixedSql()],
    [SHAPED, shapedSql(mode, layouts.work.srid)],
    [CLASSIFIED, classifiedSql(mode)],
    [KEYED, keyedSql(mode)],
    [DECIDED_CTE, decidedSql(mode)],
  ];
  return `WITH ${definitions.map(([name, body]) => `${q(name)} AS (${body})`).join(", ")}`;
}
