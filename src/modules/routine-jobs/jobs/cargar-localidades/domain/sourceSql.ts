import { physicalColumn, qualifiedName, type TableLayout } from "../../actualizar-padron/domain/layouts";
import { PADRON_UNIT } from "../../cargar-padrones/constants";
import {
  PROVINCE_SOURCE_COLUMN,
  SAMPLE_LIMIT,
  LOCALITY_SKIP_REASON,
  STAGING_LOCALITY_COLUMN,
  STAGING_PADRON_COLUMN,
} from "../constants";
import { cte, jsonArrayOf, literal, q, withClause } from "./sqlFragments";

export interface SourceLayouts {
  padron: TableLayout;
  localities: TableLayout;
  province: TableLayout;
}

export const CTE = {
  JOINED: "joined",
  PRE_GROUPED: "pre_grouped",
  FIXED: "fixed",
  GROUPED: "grouped",
  PROVINCES: "provinces",
  PROVINCE_NAMES: "province_names",
  LOCATED: "located",
  DECIDED: "decided",
  CANDIDATES: "candidates",
  KEY_VARIANTS: "key_variants",
  ACCEPTED: "accepted",
  SOURCE_KEYS: "source_keys",
} as const;

function joinedSql({ padron, localities }: SourceLayouts): string {
  const padronOf = (logical: string): string => `p.${physicalColumn(padron, logical)}`;
  const localityOf = (logical: string): string => `l.${physicalColumn(localities, logical)}`;
  return [
    "SELECT",
    `${padronOf(STAGING_PADRON_COLUMN.NOMDEPTO)} AS "nomdepto",`,
    `${padronOf(STAGING_PADRON_COLUMN.CODDEPTO)} AS "coddepto",`,
    `${padronOf(STAGING_PADRON_COLUMN.NOMLOCCAT)} AS "nomloccat",`,
    `${padronOf(STAGING_PADRON_COLUMN.CODLOCCAT)} AS "codloccat",`,
    `${padronOf(STAGING_PADRON_COLUMN.NOMOFIDEL)} AS "nomofidel",`,
    `${localityOf(STAGING_LOCALITY_COLUMN.LOCALIDAD)} AS "localidad",`,
    `${localityOf(STAGING_LOCALITY_COLUMN.GEOM)} AS "geom"`,
    `FROM ${qualifiedName(padron)} AS p`,
    `INNER JOIN ${qualifiedName(localities)} AS l`,
    `ON ${localityOf(STAGING_LOCALITY_COLUMN.CODDEPTO)} = ${padronOf(STAGING_PADRON_COLUMN.CODDEPTO)}`,
    `AND ${localityOf(STAGING_LOCALITY_COLUMN.LOCALIDAD)} = ${padronOf(STAGING_PADRON_COLUMN.NOMLOCCAT)}`,
    `WHERE ${padronOf(STAGING_PADRON_COLUMN.UNIDADCAT)} = ${literal(PADRON_UNIT.URBANO)}`,
    `AND ${padronOf(STAGING_PADRON_COLUMN.NOMOFIDEL)} IS NOT NULL`,
  ].join(" ");
}

const PRE_GROUPED_SQL = [
  `SELECT j."nomdepto", j."coddepto", j."localidad", j."nomloccat", j."codloccat", j."nomofidel", j."geom"`,
  `FROM ${q(CTE.JOINED)} AS j`,
  `GROUP BY j."nomdepto", j."coddepto", j."localidad", j."nomloccat", j."codloccat", j."nomofidel", j."geom"`,
].join(" ");

const FIXED_SQL = [
  `SELECT v.*, CASE WHEN v."was_invalid" THEN ST_Multi(ST_CollectionExtract(ST_MakeValid(v."geom"), 3)) ELSE ST_Multi(v."geom") END AS "geom_fixed"`,
  `FROM (SELECT p.*, (p."geom" IS NOT NULL AND NOT ST_IsValid(p."geom")) AS "was_invalid" FROM ${q(CTE.PRE_GROUPED)} AS p) AS v`,
].join(" ");

const GROUPED_SQL = [
  `SELECT f."nomdepto", f."coddepto", f."localidad", f."nomloccat", f."codloccat", f."nomofidel",`,
  `f."geom_fixed" AS "geom", bool_or(f."was_invalid") AS "repaired"`,
  `FROM ${q(CTE.FIXED)} AS f`,
  `GROUP BY f."nomdepto", f."coddepto", f."localidad", f."nomloccat", f."codloccat", f."nomofidel", f."geom_fixed"`,
].join(" ");

const USABLE_GEOMETRY = `COALESCE(g."geom" IS NOT NULL AND NOT ST_IsEmpty(g."geom") AND ST_GeometryType(g."geom") = 'ST_MultiPolygon', false)`;

const LOCATED_SQL = [
  `SELECT g.*, pn."matches", CASE WHEN pn."matches" = 1 THEN pn."id" END AS "id_province",`,
  `CASE`,
  `WHEN NOT g."usable" THEN '${LOCALITY_SKIP_REASON.SIN_GEOMETRIA}'`,
  `WHEN pn."matches" IS NULL THEN '${LOCALITY_SKIP_REASON.PROVINCIA_NO_ENCONTRADA}'`,
  `WHEN pn."matches" > 1 THEN '${LOCALITY_SKIP_REASON.PROVINCIA_AMBIGUA}'`,
  `WHEN g."codloccat" IS NULL THEN '${LOCALITY_SKIP_REASON.CODIGO_NULO}'`,
  `END AS "reason"`,
  `FROM (SELECT g.*, ${USABLE_GEOMETRY} AS "usable" FROM ${q(CTE.GROUPED)} AS g) AS g`,
  `LEFT JOIN ${q(CTE.PROVINCE_NAMES)} AS pn ON pn."name" = g."nomdepto"`,
].join(" ");

const CANDIDATES_SQL = [
  `SELECT DISTINCT l."id_province", l."nomdepto", l."localidad", l."codloccat", l."geom"`,
  `FROM ${q(CTE.LOCATED)} AS l WHERE l."reason" IS NULL`,
].join(" ");

const KEY_VARIANTS_SQL = [
  `SELECT c."id_province", c."localidad", count(*) AS "key_rows"`,
  `FROM ${q(CTE.CANDIDATES)} AS c GROUP BY c."id_province", c."localidad"`,
].join(" ");

const DECIDED_SQL = [
  `SELECT l.*, COALESCE(l."reason", CASE WHEN kv."key_rows" > 1 THEN '${LOCALITY_SKIP_REASON.CLAVE_DUPLICADA}' END) AS "skip_reason"`,
  `FROM ${q(CTE.LOCATED)} AS l`,
  `LEFT JOIN ${q(CTE.KEY_VARIANTS)} AS kv ON kv."id_province" = l."id_province" AND kv."localidad" = l."localidad"`,
].join(" ");

const ACCEPTED_SQL = [
  `SELECT c.* FROM ${q(CTE.CANDIDATES)} AS c`,
  `INNER JOIN ${q(CTE.KEY_VARIANTS)} AS kv ON kv."id_province" = c."id_province" AND kv."localidad" = c."localidad"`,
  `WHERE kv."key_rows" = 1`,
].join(" ");

const SOURCE_KEYS_SQL = `SELECT DISTINCT l."id_province", l."localidad" FROM ${q(CTE.LOCATED)} AS l WHERE l."id_province" IS NOT NULL`;

const PROVINCE_NAMES_SQL = `SELECT pr."name", count(*) AS "matches", min(pr."id") AS "id" FROM ${q(CTE.PROVINCES)} AS pr GROUP BY pr."name"`;

function provincesSql({ province }: SourceLayouts): string {
  return [
    `SELECT p.${physicalColumn(province, PROVINCE_SOURCE_COLUMN.ID)} AS "id", p.${physicalColumn(province, PROVINCE_SOURCE_COLUMN.NAME)} AS "name"`,
    `FROM ${qualifiedName(province)} AS p`,
  ].join(" ");
}

export function sourceCtes(layouts: SourceLayouts): string[] {
  return [
    cte(CTE.JOINED, joinedSql(layouts)),
    cte(CTE.PRE_GROUPED, PRE_GROUPED_SQL),
    cte(CTE.FIXED, FIXED_SQL),
    cte(CTE.GROUPED, GROUPED_SQL),
    cte(CTE.PROVINCES, provincesSql(layouts)),
    cte(CTE.PROVINCE_NAMES, PROVINCE_NAMES_SQL),
    cte(CTE.LOCATED, LOCATED_SQL),
    cte(CTE.CANDIDATES, CANDIDATES_SQL),
    cte(CTE.KEY_VARIANTS, KEY_VARIANTS_SQL),
    cte(CTE.DECIDED, DECIDED_SQL),
    cte(CTE.ACCEPTED, ACCEPTED_SQL),
    cte(CTE.SOURCE_KEYS, SOURCE_KEYS_SQL),
  ];
}

const SAMPLES_SQL = [
  `SELECT ranked."department", ranked."locality", ranked."code", ranked."reason" FROM (`,
  `SELECT d."nomdepto" AS "department", d."localidad" AS "locality", d."codloccat"::text AS "code", d."skip_reason" AS "reason",`,
  `row_number() OVER (PARTITION BY d."skip_reason" ORDER BY d."nomdepto", d."localidad", d."codloccat"::text) AS "position"`,
  `FROM ${q(CTE.DECIDED)} AS d WHERE d."skip_reason" IS NOT NULL) AS ranked`,
  `WHERE ranked."position" <= ${SAMPLE_LIMIT} ORDER BY ranked."reason", ranked."position"`,
].join(" ");

export function buildSourceReportSql(layouts: SourceLayouts): string {
  return [
    withClause(sourceCtes(layouts)),
    "SELECT",
    `(SELECT count(*) FROM ${q(CTE.JOINED)}) AS "rows_read",`,
    `(SELECT count(*) FROM ${q(CTE.DECIDED)}) AS "groups",`,
    `(SELECT count(*) FROM ${q(CTE.DECIDED)} AS d WHERE d."repaired") AS "repaired",`,
    `(SELECT count(*) FROM ${q(CTE.ACCEPTED)}) AS "candidates",`,
    `(SELECT COALESCE(json_object_agg(reasons."skip_reason", reasons."count"), '{}'::json)`,
    `FROM (SELECT d."skip_reason", count(*) AS "count" FROM ${q(CTE.DECIDED)} AS d`,
    `WHERE d."skip_reason" IS NOT NULL GROUP BY d."skip_reason") AS reasons) AS "by_reason",`,
    `${jsonArrayOf(SAMPLES_SQL, "samples")} AS "samples"`,
  ].join(" ");
}
