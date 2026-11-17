import { cte, q } from "../../shared/sqlFragments";
import { GEO_TWIN_ROLE } from "../constants";
import { comparableLineSql } from "./geometryCompareSql";
import { countOf, listOf } from "./layoutSql";

/**
 * Geometric twins (ET-20 to ET-27, a complement of the locality twins of ET-1 to ET-18). They run AFTER the locality rule: they read
 * `copy_kept`, the copies the locality rule keeps. A reftramo takes part only with exactly one kept copy, whose locality, department,
 * idcalle and geometry define its key. A group is the set of members sharing the four of them (key, idcalle, localidad, departamento):
 * a geometry shared by sections of another street or locality splits into its own groups, and a section that matches none is no member.
 */
export interface GeoTwinSinks {
  geoTwins: string;
}

const GEO_TWIN_TABLE_COLUMNS =
  "ref text, group_key text, role text, in_carto boolean, section_id bigint, cur_rows bigint, points bigint, idcalle text, localidad text, departamento text, partners text";

/** One row per member of a geometric twin group, as the analysis decided it (the load reads the same rows). */
export const buildCreateGeoTwinTableSql = (name: string): string => `CREATE TEMP TABLE ${q(name)} (${GEO_TWIN_TABLE_COLUMNS}) ON COMMIT DROP`;

/** The grouping key: an md5 of the comparable line (the same snap grid as the GEOM comparison, EJ-9), short enough to group and sort. */
const geometryKeySql = (geometry: string): string => `md5(ST_AsEWKB(${comparableLineSql(geometry)}))`;

const roleLiteral = (role: keyof typeof GEO_TWIN_ROLE): string => `'${GEO_TWIN_ROLE[role]}'`;

/**
 * The geometric rule, after the locality rule. `cur` and `ap` are the current sections and the points by `reftramo` (`currentCtes`),
 * `copy_kept` the copies the locality rule keeps. Keepers hold a point reference (by `reftramo`, or by the `road_section.id` of a section
 * with that reftramo); the winner is the single member kept when no member of its group holds one (a member in carto first, then the
 * lowest reftramo); every other member is a loser. Losers are never inserted, classified or split, and a loser in carto is a removal offer.
 */
export function geoTwinCtes(): string[] {
  return [
    cte(
      "geo_keys",
      `SELECT k.ref, k.idcalle, upper(btrim(k.localidad)) AS localidad, upper(btrim(k.departamento)) AS departamento, ${geometryKeySql("k.geom")} AS key FROM ${q("copy_kept")} AS k`
    ),
    cte(
      "geo_refs",
      [
        "SELECT g.ref, count(*) AS copies, min(g.idcalle) AS idcalle, min(g.localidad) AS localidad, min(g.departamento) AS departamento, min(g.key) AS key,",
        "bool_and(g.idcalle IS NOT NULL AND g.localidad IS NOT NULL AND g.departamento IS NOT NULL) AS complete",
        `FROM ${q("geo_keys")} AS g GROUP BY g.ref`,
      ].join(" ")
    ),
    cte("geo_members", `SELECT r.* FROM ${q("geo_refs")} AS r WHERE r.copies = 1 AND r.complete`),
    cte(
      "geo_groups",
      [
        `SELECT m.key, m.idcalle, m.localidad, m.departamento FROM ${q("geo_members")} AS m`,
        "GROUP BY m.key, m.idcalle, m.localidad, m.departamento HAVING count(*) >= 2",
      ].join(" ")
    ),
    cte(
      "geo_grouped",
      [
        "SELECT m.ref, m.key, m.idcalle, m.localidad, m.departamento,",
        "concat_ws('|', m.key, m.idcalle, m.localidad, m.departamento) AS gid, COALESCE(ap.points, 0) AS ref_points",
        `FROM ${q("geo_members")} AS m`,
        `JOIN ${q("geo_groups")} AS gg ON gg.key = m.key AND gg.idcalle = m.idcalle AND gg.localidad = m.localidad AND gg.departamento = m.departamento`,
        `LEFT JOIN ${q("ap")} AS ap ON ap.ref = m.ref`,
      ].join(" ")
    ),
    cte(
      "geo_cur",
      [
        "SELECT c.ref, min(c.id) AS section_id, count(*) AS cur_rows, COALESCE(sum(apid.points), 0) AS id_points",
        `FROM ${q("cur")} AS c LEFT JOIN ${q("ap")} AS apid ON apid.ref = c.id::text`,
        `WHERE c.ref IN (SELECT x.ref FROM ${q("geo_grouped")} AS x) GROUP BY c.ref`,
      ].join(" ")
    ),
    cte(
      "geo_held",
      [
        "SELECT x.ref, x.key, x.idcalle, x.localidad, x.departamento, x.gid, x.ref_points, COALESCE(g.id_points, 0) AS id_points,",
        "g.section_id, COALESCE(g.cur_rows, 0) AS cur_rows",
        `FROM ${q("geo_grouped")} AS x LEFT JOIN ${q("geo_cur")} AS g ON g.ref = x.ref`,
      ].join(" ")
    ),
    cte(
      "geo_ranked",
      [
        "SELECT h.*, (h.ref_points + h.id_points > 0) AS holds,",
        "bool_or(h.ref_points + h.id_points > 0) OVER (PARTITION BY h.gid) AS group_keeps,",
        "row_number() OVER (PARTITION BY h.gid ORDER BY (h.section_id IS NULL), CAST(h.ref AS numeric)) AS rn,",
        "min(CAST(h.ref AS numeric)) OVER (PARTITION BY h.gid) AS group_label",
        `FROM ${q("geo_held")} AS h`,
      ].join(" ")
    ),
    cte(
      "geo_roles",
      [
        "SELECT r.ref, r.group_label::text AS group_key, r.idcalle, r.localidad, r.departamento, r.section_id IS NOT NULL AS in_carto, r.section_id, r.cur_rows,",
        "r.ref_points + r.id_points AS points, CASE",
        `WHEN r.holds THEN ${roleLiteral("KEEPER")}`,
        `WHEN NOT r.group_keeps AND r.rn = 1 THEN ${roleLiteral("WINNER")}`,
        `ELSE ${roleLiteral("LOSER")} END AS role,`,
        `(SELECT string_agg(o.ref, ',' ORDER BY CAST(o.ref AS numeric)) FROM ${q("geo_ranked")} AS o WHERE o.gid = r.gid AND o.ref <> r.ref) AS partners`,
        `FROM ${q("geo_ranked")} AS r`,
      ].join(" ")
    ),
    cte("geo_losers", `SELECT l.ref FROM ${q("geo_roles")} AS l WHERE l.role = ${roleLiteral("LOSER")}`),
  ];
}

/** The copies that survive the geometric rule: the kept copies minus the losers. `losers` is a relation with a `ref` column. */
export const copyFinalCte = (losers: string): string =>
  cte("copy_final", `SELECT k.* FROM ${q("copy_kept")} AS k WHERE NOT EXISTS (SELECT 1 FROM ${losers} AS l WHERE l.ref = k.ref)`);

/** The data-modifying CTE that writes every member into the temp table the load reads (PostgreSQL runs it although nothing reads it). */
export const geoTwinSinkCtes = (sinks: GeoTwinSinks): string[] => [
  cte(
    "geo_twin_sink",
    `INSERT INTO ${sinks.geoTwins} (ref, group_key, role, in_carto, section_id, cur_rows, points, idcalle, localidad, departamento, partners) SELECT r.ref, r.group_key, r.role, r.in_carto, r.section_id, r.cur_rows, r.points, r.idcalle, r.localidad, r.departamento, r.partners FROM ${q("geo_roles")} AS r RETURNING 1`
  ),
];

export const geoTwinCountColumns = (): string[] => [
  `(SELECT count(DISTINCT r.group_key) FROM ${q("geo_roles")} AS r) AS "geo_twin_groups"`,
  `${countOf("geo_roles")} AS "geo_twin_sections"`,
  `${countOf("geo_roles", `role = ${roleLiteral("LOSER")} AND NOT in_carto`)} AS "geo_twin_losers_omitted"`,
  `${countOf("geo_roles", `role = ${roleLiteral("LOSER")} AND in_carto`)} AS "geo_twin_losers_removable"`,
  // Reftramos with several kept copies are never grouped (conservative): counted when one of their kept copies has the same four parts
  // (key, idcalle, localidad, departamento) as a copy of another reftramo, i.e. they would have been a member of a group.
  [
    `(SELECT count(DISTINCT k.ref) FROM ${q("geo_keys")} AS k WHERE k.ref IN (SELECT r.ref FROM ${q("geo_refs")} AS r WHERE r.copies > 1)`,
    `AND EXISTS (SELECT 1 FROM ${q("geo_keys")} AS o WHERE o.key = k.key AND o.idcalle IS NOT DISTINCT FROM k.idcalle`,
    "AND o.localidad IS NOT DISTINCT FROM k.localidad AND o.departamento IS NOT DISTINCT FROM k.departamento AND o.ref <> k.ref)) AS \"geo_twin_skipped_refs\"",
  ].join(" "),
];

export const geoTwinListColumn = (alias: string): string =>
  listOf(
    alias,
    "geo_twin_list",
    [
      'SELECT r.ref AS "ref", r.idcalle AS "idcalle", r.localidad AS "localidad", r.departamento AS "departamento", r.group_key AS "groupKey",',
      `r.partners AS "partners", r.role AS "role", r.in_carto AS "inCarto", r.points AS "points" FROM ${q("geo_roles")} AS r`,
      // Removable losers first, so the list limit never cuts one of them.
      `ORDER BY (r.role = '${GEO_TWIN_ROLE.LOSER}' AND r.in_carto) DESC, r.group_key, CAST(r.ref AS numeric)`,
    ].join(" ")
  );
