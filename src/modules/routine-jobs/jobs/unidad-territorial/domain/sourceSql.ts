import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { repairedGeometrySql, usableGeometrySql, wasInvalidSql } from "../../shared/geometryCompare";
import { SAMPLE_LIMIT } from "../../shared/limits";
import { cte, jsonArrayOf, q, withClause } from "../../shared/sqlFragments";
import { UNIT_SKIP_REASON, UNIT_SOURCE_COLUMN } from "../constants";

export interface UnitSourceLayouts {
  locality: TableLayout;
}

export const CTE = {
  ROWS: "unit_rows",
  FIXED: "unit_fixed",
  LOCATED: "unit_located",
  KEY_VARIANTS: "unit_key_variants",
  DECIDED: "unit_decided",
  ACCEPTED: "unit_accepted",
  SOURCE_KEYS: "unit_source_keys",
} as const;

function rowsSql({ locality }: UnitSourceLayouts): string {
  const sourceOf = (logical: string): string => `l.${physicalColumn(locality, logical)}`;
  return [
    "SELECT",
    `${sourceOf(UNIT_SOURCE_COLUMN.NAME)} AS "name",`,
    `${sourceOf(UNIT_SOURCE_COLUMN.ID_FONT_TYPE)} AS "id_font",`,
    `${sourceOf(UNIT_SOURCE_COLUMN.ID_PROVINCE)} AS "id_province",`,
    `${sourceOf(UNIT_SOURCE_COLUMN.GEOMETRY)} AS "geom"`,
    `FROM ${qualifiedName(locality)} AS l`,
  ].join(" ");
}

const FIXED_SQL = [
  `SELECT v."name", v."id_font", v."id_province", ${repairedGeometrySql('v."geom"', 'v."was_invalid"')} AS "geom"`,
  `FROM (SELECT r.*, ${wasInvalidSql('r."geom"')} AS "was_invalid" FROM ${q(CTE.ROWS)} AS r) AS v`,
].join(" ");

const LOCATED_SQL = [
  `SELECT g.*, CASE`,
  `WHEN g."name" IS NULL THEN '${UNIT_SKIP_REASON.NOMBRE_NULO}'`,
  `WHEN g."id_province" IS NULL THEN '${UNIT_SKIP_REASON.PROVINCIA_NULA}'`,
  `WHEN g."id_font" IS NULL THEN '${UNIT_SKIP_REASON.FUENTE_NULA}'`,
  `WHEN NOT g."usable" THEN '${UNIT_SKIP_REASON.SIN_GEOMETRIA}'`,
  `END AS "reason"`,
  `FROM (SELECT f.*, ${usableGeometrySql('f."geom"')} AS "usable" FROM ${q(CTE.FIXED)} AS f) AS g`,
].join(" ");

const KEY_VARIANTS_SQL = [
  `SELECT c."id_province", c."name", count(*) AS "key_rows"`,
  `FROM ${q(CTE.LOCATED)} AS c WHERE c."reason" IS NULL GROUP BY c."id_province", c."name"`,
].join(" ");

const DECIDED_SQL = [
  `SELECT l.*, COALESCE(l."reason", CASE WHEN kv."key_rows" > 1 THEN '${UNIT_SKIP_REASON.CLAVE_DUPLICADA}' END) AS "skip_reason"`,
  `FROM ${q(CTE.LOCATED)} AS l`,
  `LEFT JOIN ${q(CTE.KEY_VARIANTS)} AS kv ON kv."id_province" = l."id_province" AND kv."name" = l."name"`,
].join(" ");

const ACCEPTED_SQL = `SELECT d."id_province", d."name", d."id_font", d."geom" FROM ${q(CTE.DECIDED)} AS d WHERE d."skip_reason" IS NULL`;

const SOURCE_KEYS_SQL = `SELECT DISTINCT l."id_province", l."name" FROM ${q(CTE.LOCATED)} AS l WHERE l."id_province" IS NOT NULL AND l."name" IS NOT NULL`;

export function unitSourceCtes(layouts: UnitSourceLayouts): string[] {
  return [
    cte(CTE.ROWS, rowsSql(layouts)),
    cte(CTE.FIXED, FIXED_SQL),
    cte(CTE.LOCATED, LOCATED_SQL),
    cte(CTE.KEY_VARIANTS, KEY_VARIANTS_SQL),
    cte(CTE.DECIDED, DECIDED_SQL),
    cte(CTE.ACCEPTED, ACCEPTED_SQL),
    cte(CTE.SOURCE_KEYS, SOURCE_KEYS_SQL),
  ];
}

const SAMPLES_SQL = [
  `SELECT ranked."name", ranked."province_id", ranked."reason" FROM (`,
  `SELECT d."name" AS "name", d."id_province"::text AS "province_id", d."skip_reason" AS "reason",`,
  `row_number() OVER (PARTITION BY d."skip_reason" ORDER BY d."name", d."id_province") AS "position"`,
  `FROM ${q(CTE.DECIDED)} AS d WHERE d."skip_reason" IS NOT NULL) AS ranked`,
  `WHERE ranked."position" <= ${SAMPLE_LIMIT} ORDER BY ranked."reason", ranked."position"`,
].join(" ");

export function buildUnitSourceReportSql(layouts: UnitSourceLayouts): string {
  return [
    withClause(unitSourceCtes(layouts)),
    "SELECT",
    `(SELECT count(*) FROM ${q(CTE.ROWS)}) AS "rows_read",`,
    `(SELECT count(*) FROM ${q(CTE.ACCEPTED)}) AS "candidates",`,
    `(SELECT COALESCE(json_object_agg(reasons."skip_reason", reasons."count"), '{}'::json)`,
    `FROM (SELECT d."skip_reason", count(*) AS "count" FROM ${q(CTE.DECIDED)} AS d`,
    `WHERE d."skip_reason" IS NOT NULL GROUP BY d."skip_reason") AS reasons) AS "by_reason",`,
    `${jsonArrayOf(SAMPLES_SQL, "samples")} AS "samples"`,
  ].join(" ");
}
