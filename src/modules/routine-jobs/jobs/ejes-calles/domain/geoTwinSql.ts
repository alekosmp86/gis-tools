import { cte, q } from "../../shared/sqlFragments";
import { GEO_TWIN_ROLE, GEO_TWIN_TOLERANCE_M } from "../constants";
import { countOf, listOf } from "./layoutSql";

/**
 * Geometric twins (ET-20 to ET-27, a complement of the locality twins of ET-1 to ET-18). They run AFTER the locality rule: they read
 * `copy_kept`, the copies the locality rule keeps. A reftramo takes part only with exactly one kept copy, whose idcalle is complete.
 * Members with the same idcalle whose geometries are equal within the tolerance are grouped by anchor (the lowest reftramo among the
 * members within the tolerance of a member); chains are not merged transitively. The locality is informational only.
 */
export interface GeoTwinSinks {
  geoTwins: string;
}

const GEO_TWIN_TABLE_COLUMNS =
  "ref text, group_key text, role text, in_carto boolean, section_id bigint, cur_rows bigint, points bigint, id_points bigint, idcalle text, localidad text, partners text, winner_ref text";

/** One row per member of a geometric twin group, as the analysis decided it (the load reads the same rows). */
export const buildCreateGeoTwinTableSql = (name: string): string => `CREATE TEMP TABLE ${q(name)} (${GEO_TWIN_TABLE_COLUMNS}) ON COMMIT DROP`;

const roleLiteral = (role: keyof typeof GEO_TWIN_ROLE): string => `'${GEO_TWIN_ROLE[role]}'`;

/** A loser the load removes: in carto, one current section, and no point by the `road_section.id` of that section. */
const removableSql = (prefix: string): string =>
  `${prefix}role = ${roleLiteral("LOSER")} AND ${prefix}in_carto AND ${prefix}cur_rows = 1 AND ${prefix}id_points = 0`;

/**
 * The geometric rule, after the locality rule. `cur` and `ap` are the current sections and the points by `reftramo` (`currentCtes`),
 * `copy_kept` the copies the locality rule keeps. The winner of a group is its member with the most access points (by `reftramo` and by
 * the `road_section.id` of its section), a member in carto first, then the lowest reftramo. Every other member is a loser: never inserted,
 * classified or split; a loser in carto is a removal offer, and its points move to the winner when it is accepted.
 */
export function geoTwinCtes(): string[] {
  return [
    cte(
      "geo_keys",
      `SELECT k.ref, k.idcalle, k.localidad, k.geom FROM ${q("copy_kept")} AS k`
    ),
    cte(
      "geo_refs",
      [
        "SELECT g.ref, count(*) AS copies, min(g.idcalle) AS idcalle, min(g.localidad) AS localidad, (array_agg(g.geom))[1] AS geom,",
        "bool_and(g.idcalle IS NOT NULL) AS complete",
        `FROM ${q("geo_keys")} AS g GROUP BY g.ref`,
      ].join(" ")
    ),
    cte("geo_members", `SELECT r.* FROM ${q("geo_refs")} AS r WHERE r.copies = 1 AND r.complete`),
    cte(
      "geo_pairs",
      [
        "SELECT a.ref, a.idcalle, a.localidad, b.ref AS other",
        `FROM ${q("geo_members")} AS a JOIN ${q("geo_members")} AS b`,
        "ON b.idcalle = a.idcalle",
        `AND a.geom && ST_Expand(b.geom, ${GEO_TWIN_TOLERANCE_M}) AND ST_HausdorffDistance(a.geom, b.geom) < ${GEO_TWIN_TOLERANCE_M}`,
      ].join(" ")
    ),
    cte(
      "geo_anchors",
      [
        "SELECT p.ref, p.idcalle, p.localidad, (array_agg(p.other ORDER BY CAST(p.other AS numeric), p.other))[1] AS group_key",
        `FROM ${q("geo_pairs")} AS p GROUP BY p.ref, p.idcalle, p.localidad`,
      ].join(" ")
    ),
    cte(
      "geo_grouped",
      [
        "SELECT a.ref, a.group_key, a.idcalle, a.localidad, COALESCE(ap.points, 0) AS ref_points",
        `FROM ${q("geo_anchors")} AS a LEFT JOIN ${q("ap")} AS ap ON ap.ref = a.ref`,
      ].join(" ")
    ),
    cte(
      "geo_sized",
      `SELECT x.* FROM ${q("geo_grouped")} AS x WHERE x.group_key IN (SELECT g.group_key FROM ${q("geo_grouped")} AS g GROUP BY g.group_key HAVING count(*) >= 2)`
    ),
    cte(
      "geo_cur",
      [
        "SELECT c.ref, min(c.id) AS section_id, count(*) AS cur_rows, COALESCE(sum(apid.points), 0) AS id_points",
        `FROM ${q("cur")} AS c LEFT JOIN ${q("ap")} AS apid ON apid.ref = c.id::text`,
        `WHERE c.ref IN (SELECT x.ref FROM ${q("geo_sized")} AS x) GROUP BY c.ref`,
      ].join(" ")
    ),
    cte(
      "geo_held",
      [
        "SELECT x.ref, x.group_key, x.idcalle, x.localidad, x.ref_points, COALESCE(g.id_points, 0) AS id_points,",
        "g.section_id, COALESCE(g.cur_rows, 0) AS cur_rows",
        `FROM ${q("geo_sized")} AS x LEFT JOIN ${q("geo_cur")} AS g ON g.ref = x.ref`,
      ].join(" ")
    ),
    cte(
      "geo_ranked",
      [
        "SELECT h.*, h.ref_points + h.id_points AS points,",
        "row_number() OVER (PARTITION BY h.group_key ORDER BY h.ref_points + h.id_points DESC, (h.section_id IS NULL), CAST(h.ref AS numeric)) AS rn",
        `FROM ${q("geo_held")} AS h`,
      ].join(" ")
    ),
    cte(
      "geo_roles",
      [
        "SELECT r.ref, r.group_key, r.idcalle, r.localidad, r.section_id IS NOT NULL AS in_carto, r.section_id, r.cur_rows, r.points, r.id_points,",
        `CASE WHEN r.rn = 1 THEN ${roleLiteral("WINNER")} ELSE ${roleLiteral("LOSER")} END AS role,`,
        `(SELECT w.ref FROM ${q("geo_ranked")} AS w WHERE w.group_key = r.group_key AND w.rn = 1) AS winner_ref,`,
        `(SELECT string_agg(o.ref, ',' ORDER BY CAST(o.ref AS numeric)) FROM ${q("geo_ranked")} AS o WHERE o.group_key = r.group_key AND o.ref <> r.ref) AS partners`,
        `FROM ${q("geo_ranked")} AS r`,
      ].join(" ")
    ),
    cte(
      "geo_winners",
      [
        "SELECT r.group_key, r.points AS winner_points, r.in_carto AS winner_in_carto, ST_Length(k.geom) AS winner_length, k.fuente AS winner_fuente",
        `FROM ${q("geo_roles")} AS r JOIN ${q("copy_kept")} AS k ON k.ref = r.ref`,
        `WHERE r.role = ${roleLiteral("WINNER")}`,
      ].join(" ")
    ),
    cte("geo_losers", `SELECT l.ref FROM ${q("geo_roles")} AS l WHERE l.role = ${roleLiteral("LOSER")}`),
  ];
}

/** The copies that survive the geometric rule and the discarded renumber candidates: the kept copies minus the losers and the discarded refs. `losers` and `discarded` are relations with a `ref` column. */
export const copyFinalCte = (losers: string, discarded: string): string =>
  cte(
    "copy_final",
    `SELECT k.* FROM ${q("copy_kept")} AS k WHERE NOT EXISTS (SELECT 1 FROM ${losers} AS l WHERE l.ref = k.ref) AND NOT EXISTS (SELECT 1 FROM ${discarded} AS d WHERE d.ref = k.ref)`
  );

/** The data-modifying CTE that writes every member into the temp table the load reads (PostgreSQL runs it although nothing reads it). */
export const geoTwinSinkCtes = (sinks: GeoTwinSinks): string[] => [
  cte(
    "geo_twin_sink",
    `INSERT INTO ${sinks.geoTwins} (ref, group_key, role, in_carto, section_id, cur_rows, points, id_points, idcalle, localidad, partners, winner_ref) SELECT r.ref, r.group_key, r.role, r.in_carto, r.section_id, r.cur_rows, r.points, r.id_points, r.idcalle, r.localidad, r.partners, r.winner_ref FROM ${q("geo_roles")} AS r RETURNING 1`
  ),
];

export const geoTwinCountColumns = (): string[] => [
  `(SELECT count(DISTINCT r.group_key) FROM ${q("geo_roles")} AS r) AS "geo_twin_groups"`,
  `${countOf("geo_roles")} AS "geo_twin_sections"`,
  `${countOf("geo_roles", `role = ${roleLiteral("LOSER")} AND NOT in_carto`)} AS "geo_twin_losers_omitted"`,
  `${countOf("geo_roles", removableSql(""))} AS "geo_twin_losers_removable"`,
  // Reftramos with several kept copies are never grouped (conservative): counted when one of their kept copies is within the tolerance of a copy of another reftramo of the same idcalle.
  [
    `(SELECT count(DISTINCT k.ref) FROM ${q("geo_keys")} AS k WHERE k.ref IN (SELECT r.ref FROM ${q("geo_refs")} AS r WHERE r.copies > 1)`,
    `AND EXISTS (SELECT 1 FROM ${q("geo_keys")} AS o WHERE o.ref <> k.ref AND COALESCE(o.idcalle, '') = COALESCE(k.idcalle, '')`,
    `AND k.geom && ST_Expand(o.geom, ${GEO_TWIN_TOLERANCE_M}) AND ST_HausdorffDistance(k.geom, o.geom) < ${GEO_TWIN_TOLERANCE_M})) AS "geo_twin_skipped_refs"`,
  ].join(" "),
];

export const geoTwinListColumn = (alias: string): string =>
  listOf(
    alias,
    "geo_twin_list",
    [
      'SELECT r.ref AS "ref", r.idcalle AS "idcalle", r.localidad AS "localidad", r.group_key AS "groupKey",',
      `r.partners AS "partners", r.role AS "role", r.in_carto AS "inCarto", r.points AS "points", r.id_points AS "pointsById",`,
      `(${removableSql("r.")}) AS "removable", r.winner_ref AS "winnerRef", w.winner_points AS "winnerPoints", w.winner_length AS "winnerLength",`,
      'w.winner_fuente AS "winnerFuente", w.winner_in_carto AS "winnerInCarto"',
      `FROM ${q("geo_roles")} AS r JOIN ${q("geo_winners")} AS w ON w.group_key = r.group_key`,
      // Removable losers first, so the list limit never cuts one of them.
      `ORDER BY (${removableSql("r.")}) DESC, r.group_key, CAST(r.ref AS numeric)`,
    ].join(" ")
  );
