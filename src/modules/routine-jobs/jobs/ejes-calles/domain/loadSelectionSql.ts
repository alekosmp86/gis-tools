import { cte, q, withClause } from "../../shared/sqlFragments";
import { EJES_SKIP_KIND, EJES_SRID, EJES_TABLE_ROLE, GEO_TWIN_ROLE } from "../constants";
import type { EjesLayouts, EjesLoadContext } from "../types";
import { accessPointRefMatchSql, circulationPairsCte, copyKeptCte, copyLocalizedCte, copyRawCte, currentCtes, geometriesDifferSql, pointsCte } from "./analysisSql";
import { copyFinalCte } from "./geoTwinSql";
import { col, table } from "./layoutSql";
import { nextvalSql } from "./loadContext";
import { FUENTE_MAP_CTE_NAME, fuenteMapCte, TIPO_MAP_CTE_NAME, tipoMapCte } from "./mappings";
import { shortUnheldCte } from "./stagingSql";
import { distinctPairsCountSql } from "./renumberSql";
import { twinCtes, twinGroupCtes } from "./twinSql";
import { twinPicksTableCte } from "./twinPickSql";

export const LOAD_TEMP = {
  GEO_TWIN: "ej_geo_twins",
  ACC_TWIN: "ej_acc_twin",
  ACC_TWIN_PICK: "ej_acc_twin_pick",
  COPY: "ej_copy",
  RENUM: "ej_renum",
  HELD: "ej_held",
  DROPPED: "ej_dropped",
  SPLIT: "ej_split",
  SPLIT_PTS: "ej_split_pts",
  SPLIT_PLAN: "ej_split_plan",
  SPLIT_FINAL: "ej_split_final",
  SKIPPED: "ej_skipped",
  MERGE: "ej_merge",
  PLAIN: "ej_plain",
  ACC_SPLIT: "ej_acc_split",
  ACC_CHOICE: "ej_acc_choice",
  ACC_MERGE: "ej_acc_merge",
  ACC_PLAIN: "ej_acc_plain",
  MERGE_PLAN: "ej_merge_plan",
  PLAIN_PLAN: "ej_plain_plan",
  MOVE: "ej_move",
  DEL: "ej_del",
  EXIST: "ej_exist",
  PAIR: "ej_pair",
  STATE: "ej_state",
  NEW: "ej_new",
  WAY_IN: "ej_way_in",
  WAY: "ej_way",
  SURPLUS: "ej_surplus",
  TOPO: "ej_topo_ids",
  VERTEX_CANDIDATES: "ej_vertex_candidates",
} as const;

export const tmp = (name: string): string => `pg_temp.${q(name)}`;

export const createTemp = (name: string, body: string): string => `CREATE TEMP TABLE ${q(name)} ON COMMIT DROP AS ${body}`;

export const buildAnalyzeTempSql = (name: string): string => `ANALYZE ${tmp(name)}`;

/** The geometric losers the analysis of this transaction wrote to `ej_geo_twins`: they are no copy of the load. */
const GEO_LOSERS_SQL = `(SELECT g.ref FROM ${tmp(LOAD_TEMP.GEO_TWIN)} AS g WHERE g.role = '${GEO_TWIN_ROLE.LOSER}')`;

/** The discarded renumber candidates the analysis of this transaction wrote to `ej_dropped`: no copy of them is loaded. */
const DROPPED_SQL = `(SELECT d.ref FROM ${tmp(LOAD_TEMP.DROPPED)} AS d)`;

/** One row per kept copy: a copy is `reftramo + localidad + departamento`; the twin rules drop the copies of the localities they name, the picks keep one. */
export function buildCopyTableSql(layouts: EjesLayouts): string {
  const ctes = [
    shortUnheldCte(layouts),
    tipoMapCte(),
    fuenteMapCte(),
    ...twinGroupCtes(layouts),
    ...twinCtes(layouts),
    copyRawCte(layouts),
    twinPicksTableCte(tmp(LOAD_TEMP.ACC_TWIN_PICK)),
    copyLocalizedCte(),
    copyKeptCte(),
    copyFinalCte(GEO_LOSERS_SQL, DROPPED_SQL),
  ];
  return createTemp(
    LOAD_TEMP.COPY,
    [
      withClause(ctes),
      "SELECT (row_number() OVER (ORDER BY length(k.ref), k.ref, k.localidad NULLS FIRST, k.departamento NULLS FIRST))::bigint AS copy_id,",
      "k.ref, k.idcalle, k.nombre, tm.id::text AS type_id, fm.id::text AS font_id, k.departamento, k.localidad,",
      `ST_SetSRID(ST_LineMerge(k.geom), ${EJES_SRID}) AS geom`,
      `FROM ${q("copy_final")} AS k`,
      `LEFT JOIN ${q(TIPO_MAP_CTE_NAME)} AS tm ON tm.label = k.tipo LEFT JOIN ${q(FUENTE_MAP_CTE_NAME)} AS fm ON fm.label = k.fuente`,
    ].join(" ")
  );
}

/** The renumbered and the held sets, written by the analysis of the same transaction (its sinks): the tables are created empty here. */
export const buildCreateRenumberTableSql = (name: string): string =>
  `CREATE TEMP TABLE ${q(name)} (old_id bigint, old_ref text, new_ref text, points bigint) ON COMMIT DROP`;

/** The copies of the skipped renumber pairs' new `reftramo`s are not inserted: their section and the old one stay as they are. */
export const buildHeldCopiesSql = (): string =>
  `DELETE FROM ${tmp(LOAD_TEMP.COPY)} AS c WHERE c.ref IN (SELECT h.new_ref FROM ${tmp(LOAD_TEMP.HELD)} AS h)`;

/** E: the existing sections of every `reftramo` that has a kept copy, plus the renumbered ones. */
export function buildExistTableSql(layouts: EjesLayouts): string {
  return createTemp(
    LOAD_TEMP.EXIST,
    [
      withClause(currentCtes(layouts)),
      "SELECT c.id, c.ref, c.idcalle, w.name, c.type_id, c.font_id",
      `FROM ${q("cur")} AS c LEFT JOIN ${q("cw")} AS w ON w.idcalle = c.idcalle`,
      `WHERE c.ref IN (SELECT ref FROM ${tmp(LOAD_TEMP.COPY)}) OR c.id IN (SELECT old_id FROM ${tmp(LOAD_TEMP.RENUM)})`,
    ].join(" ")
  );
}

/** Pairs copies with existing rows per `reftramo`: same `idcalle` and name first, then the lowest ids; renumbered pairs join as they are. */
export function buildPairTableSql(): string {
  const copy = tmp(LOAD_TEMP.COPY);
  const exist = tmp(LOAD_TEMP.EXIST);
  const ctes = [
    cte(
      "c1",
      `SELECT c.copy_id, c.ref, c.idcalle, c.nombre, row_number() OVER (PARTITION BY c.ref, c.idcalle, c.nombre ORDER BY c.copy_id) AS rn FROM ${copy} AS c`
    ),
    cte(
      "e1",
      `SELECT e.id, e.ref, e.idcalle, e.name, row_number() OVER (PARTITION BY e.ref, e.idcalle, e.name ORDER BY e.id) AS rn FROM ${exist} AS e`
    ),
    cte(
      "p1",
      `SELECT c1.copy_id, e1.id AS road_id FROM ${q("c1")} AS c1 JOIN ${q("e1")} AS e1 ON e1.ref = c1.ref AND e1.idcalle IS NOT DISTINCT FROM c1.idcalle AND e1.name IS NOT DISTINCT FROM c1.nombre AND e1.rn = c1.rn`
    ),
    cte(
      "c2",
      `SELECT c.copy_id, c.ref, row_number() OVER (PARTITION BY c.ref ORDER BY c.copy_id) AS rn FROM ${copy} AS c WHERE NOT EXISTS (SELECT 1 FROM ${q("p1")} AS p WHERE p.copy_id = c.copy_id)`
    ),
    cte(
      "e2",
      `SELECT e.id, e.ref, row_number() OVER (PARTITION BY e.ref ORDER BY e.id) AS rn FROM ${exist} AS e WHERE NOT EXISTS (SELECT 1 FROM ${q("p1")} AS p WHERE p.road_id = e.id)`
    ),
    cte(
      "p2",
      `SELECT c2.copy_id, e2.id AS road_id FROM ${q("c2")} AS c2 JOIN ${q("e2")} AS e2 ON e2.ref = c2.ref AND e2.rn = c2.rn`
    ),
  ];
  return createTemp(
    LOAD_TEMP.PAIR,
    [
      withClause(ctes),
      "SELECT p.copy_id, p.road_id, NULL::text AS renum_old, NULL::text AS renum_new FROM",
      `(SELECT copy_id, road_id FROM ${q("p1")} UNION ALL SELECT copy_id, road_id FROM ${q("p2")}) AS p`,
      "UNION ALL",
      `SELECT c.copy_id, n.old_id, n.old_ref, n.new_ref FROM ${tmp(LOAD_TEMP.RENUM)} AS n JOIN ${copy} AS c ON c.ref = n.new_ref`,
    ].join(" ")
  );
}

/** ATTR and GEOM flags per pair, computed once while the tables are locked. A name change alone writes nothing: `circulation_way` rows are never changed. */
export function buildStateTableSql(layouts: EjesLayouts): string {
  const section = (logical: string): string => `r.${col(layouts, "ROAD_SECTION", logical)}`;
  return createTemp(
    LOAD_TEMP.STATE,
    [
      "SELECT p.copy_id, p.road_id, p.renum_old, p.renum_new,",
      "(c.idcalle IS DISTINCT FROM e.idcalle) AS idcalle_changed,",
      "(c.type_id IS DISTINCT FROM e.type_id) AS type_changed,",
      "(c.font_id IS DISTINCT FROM e.font_id) AS font_changed,",
      `${geometriesDifferSql(section("geometry"), "c.geom")} AS geom_changed`,
      `FROM ${tmp(LOAD_TEMP.PAIR)} AS p JOIN ${tmp(LOAD_TEMP.COPY)} AS c ON c.copy_id = p.copy_id`,
      `JOIN ${tmp(LOAD_TEMP.EXIST)} AS e ON e.id = p.road_id`,
      `JOIN ${table(layouts, "ROAD_SECTION")} AS r ON ${section("id")} = p.road_id`,
    ].join(" ")
  );
}

export const CHANGED_CONDITION = "s.idcalle_changed OR s.type_changed OR s.font_changed OR s.geom_changed";

/** Ids are taken from the sequences before the backup, so the revert file can name every inserted row. */
export function buildNewTableSql(context: EjesLoadContext): string {
  return createTemp(
    LOAD_TEMP.NEW,
    [
      `SELECT c.copy_id, ${nextvalSql(context, EJES_TABLE_ROLE.ROAD_SECTION)} AS section_id, ${nextvalSql(context, EJES_TABLE_ROLE.ADDRESS_MASTER)} AS master_id`,
      `FROM (SELECT x.copy_id FROM ${tmp(LOAD_TEMP.COPY)} AS x WHERE NOT EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.PAIR)} AS p WHERE p.copy_id = x.copy_id) ORDER BY x.copy_id) AS c`,
    ].join(" ")
  );
}

/** The copies that need a `circulation_way` for their `(idcalle, name)`: the new sections and the ones that moved to another street. */
const WAY_SOURCE_CONDITION = [
  `(EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.NEW)} AS n WHERE n.copy_id = c.copy_id)`,
  `OR EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.STATE)} AS s WHERE s.copy_id = c.copy_id AND s.idcalle_changed))`,
].join(" ");

export function buildNewWaysSql(layouts: EjesLayouts): string {
  const first = (column: string): string => `(array_agg(c.${column} ORDER BY length(c.ref), c.ref))[1]`;
  return [
    withClause([circulationPairsCte(layouts)]),
    `SELECT c.idcalle AS "idcalle", c.nombre AS "name", ${first("type_id")} AS "type_id", ${first("font_id")} AS "font_id"`,
    `FROM ${tmp(LOAD_TEMP.COPY)} AS c`,
    `WHERE ${WAY_SOURCE_CONDITION}`,
    `AND NOT EXISTS (SELECT 1 FROM ${q("cw_pairs")} AS p WHERE p.idcalle IS NOT DISTINCT FROM c.idcalle AND p.name IS NOT DISTINCT FROM c.nombre)`,
    "GROUP BY c.idcalle, c.nombre ORDER BY c.idcalle, c.nombre",
  ].join(" ");
}

export const buildCreateWayInputSql = (): string =>
  `CREATE TEMP TABLE ${q(LOAD_TEMP.WAY_IN)} (idcalle text, name text, short_name text, type_id text, font_id text) ON COMMIT DROP`;

export function buildWayTableSql(context: EjesLoadContext): string {
  return createTemp(
    LOAD_TEMP.WAY,
    [
      `SELECT ${nextvalSql(context, EJES_TABLE_ROLE.CIRCULATION_WAY)} AS way_id, i.idcalle, i.name, i.short_name, i.type_id, i.font_id`,
      `FROM (SELECT * FROM ${tmp(LOAD_TEMP.WAY_IN)} ORDER BY idcalle, name) AS i`,
    ].join(" ")
  );
}

/** Existing sections the staging no longer holds a copy for: reported, never deleted. Points are read only for the `reftramo`s of the existing rows. */
export function buildSurplusTableSql(context: EjesLoadContext): string {
  const exist = tmp(LOAD_TEMP.EXIST);
  return createTemp(
    LOAD_TEMP.SURPLUS,
    [
      withClause([pointsCte(context.layouts, `WHERE EXISTS (SELECT 1 FROM ${exist} AS e WHERE ${accessPointRefMatchSql(context, "e.ref")})`)]),
      "SELECT e.id, e.ref, e.idcalle, COALESCE(ap.points, 0) AS points",
      `FROM ${exist} AS e LEFT JOIN ${q("ap")} AS ap ON ap.ref = e.ref`,
      `WHERE e.ref IN (SELECT ref FROM ${tmp(LOAD_TEMP.COPY)}) AND NOT EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.PAIR)} AS p WHERE p.road_id = e.id)`,
    ].join(" ")
  );
}

export const buildMultiPartCountSql = (): string =>
  [
    `SELECT count(*) AS "multi_part" FROM ${tmp(LOAD_TEMP.COPY)} AS c`,
    `WHERE (NOT EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.PAIR)} AS p WHERE p.copy_id = c.copy_id)`,
    `OR EXISTS (SELECT 1 FROM ${tmp(LOAD_TEMP.STATE)} AS s WHERE s.copy_id = c.copy_id AND s.geom_changed))`,
    "AND GeometryType(c.geom) <> 'LINESTRING'",
  ].join(" ");

export const buildLoadCountsSql = (): string =>
  [
    "SELECT",
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.NEW)}) AS "inserted",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.SPLIT_PLAN)} AS p WHERE p.reason IS NULL) AS "splits",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.SPLIT_FINAL)}) AS "split_points",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.STATE)} AS s WHERE ${CHANGED_CONDITION}) AS "updated",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.STATE)} AS s WHERE s.idcalle_changed) AS "idcalle",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.STATE)} AS s WHERE s.type_changed) AS "type",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.STATE)} AS s WHERE s.font_changed) AS "font",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.STATE)} AS s WHERE s.geom_changed) AS "geom",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.RENUM)}) AS "renumbered",`,
    `${distinctPairsCountSql(tmp(LOAD_TEMP.HELD))} AS "renumber_skipped",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.PLAIN_PLAN)} AS p WHERE p.reason IS NULL AND p.kind = '${EJES_SKIP_KIND.REMOVAL}') AS "removed",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.PLAIN_PLAN)} AS p WHERE p.reason IS NULL AND p.kind = '${EJES_SKIP_KIND.TWIN}') AS "twins_removed",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.MERGE_PLAN)} AS p WHERE p.reason IS NULL) AS "merged",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.DEL)}) AS "deleted",`,
    `(SELECT count(DISTINCT d.master_id) FROM ${tmp(LOAD_TEMP.DEL)} AS d WHERE d.master_deleted) AS "masters_deleted",`,
    `(SELECT COALESCE(sum(points), 0) FROM ${tmp(LOAD_TEMP.MOVE)}) AS "points_moved",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.WAY)}) AS "ways",`,
    `(SELECT count(*) FROM ${tmp(LOAD_TEMP.SURPLUS)}) AS "surplus"`,
  ].join(" ");

export const buildRenumberedListSql = (limit: number): string =>
  [
    'SELECT n.old_ref AS "old_ref", n.new_ref AS "new_ref", n.old_id AS "id", n.points AS "points"',
    `FROM ${tmp(LOAD_TEMP.RENUM)} AS n ORDER BY n.points DESC, n.old_ref LIMIT ${limit}`,
  ].join(" ");

export const buildSurplusListSql = (limit: number): string =>
  [
    'SELECT s.ref AS "ref", s.id AS "id", s.points AS "points"',
    `FROM ${tmp(LOAD_TEMP.SURPLUS)} AS s ORDER BY s.points DESC, s.ref, s.id LIMIT ${limit}`,
  ].join(" ");
