import { buildQualifiedTableLabel, quoteIdentifier, resolveSchemaName } from "@/core/services/sqlStatements";
import { cte, literal, q, withClause } from "../../shared/sqlFragments";
import { EJES_TABLE_ROLE, ROAD_SECTION_COLUMN, TOPOLOGY_TOLERANCE_M, VERTICES_COLUMN } from "../constants";
import type { EjesLoadContext } from "../types";
import { physicalOf, qualifiedOf, rawOf } from "./loadContext";
import { createTemp, LOAD_TEMP, tmp } from "./loadSelectionSql";
import { counted } from "./loadWriteSql";

const ROAD = EJES_TABLE_ROLE.ROAD_SECTION;
const VERTICES = EJES_TABLE_ROLE.VERTICES;

const PGR_CREATE_TOPOLOGY_SIGNATURE = "pgr_createTopology(text, float8, text, text, text, text, text, boolean)";
const PGR_SIGNATURE_LITERAL = literal(PGR_CREATE_TOPOLOGY_SIGNATURE);
export const PGR_SUPPORT_SQL = [
  "SELECT to_regproc('pgr_version') IS NOT NULL AS installed,",
  `to_regprocedure(${PGR_SIGNATURE_LITERAL}) IS NOT NULL AS has_topology,`,
  `COALESCE(has_function_privilege(current_user, to_regprocedure(${PGR_SIGNATURE_LITERAL}), 'EXECUTE'), false) AS can_execute`,
].join(" ");
export const PGR_VERSION_SQL = "SELECT pgr_version() AS version";

const PGR_SIMPLE_NAME = /^[a-z_][a-z0-9_]*$/;
const VERTICES_SUFFIX = "_vertices_pgr";
/** pgRouting names these columns of the vertices table itself; they are not configurable. */
const PGR_VERTEX_ID = "id";
const PGR_VERTEX_GEOMETRY = "the_geom";
const GONE_CTE = "gone";

const qualifiedNameOf = (layout: { schema: string; table: string }): string => `${resolveSchemaName(layout.schema)}.${layout.table}`;

/** pgr_createTopology takes its table and column names as text, builds the vertices name by appending a suffix and hardcodes the vertex columns: all must match. */
export function topologyNameIssuesOf(context: EjesLoadContext): string[] {
  const road = context.targets[ROAD];
  const vertices = context.targets[VERTICES];
  const names = [
    resolveSchemaName(road.schema),
    road.table,
    rawOf(context, ROAD, ROAD_SECTION_COLUMN.GEOMETRY),
    rawOf(context, ROAD, ROAD_SECTION_COLUMN.ID),
    rawOf(context, ROAD, ROAD_SECTION_COLUMN.SOURCE),
    rawOf(context, ROAD, ROAD_SECTION_COLUMN.TARGET),
  ];
  const issues = names
    .filter((name) => !PGR_SIMPLE_NAME.test(name))
    .map((name) => `El nombre "${name}" debe ser un identificador en minúsculas sin comillas: pgr_createTopology lo usa como texto.`);
  const expectedVertices = `${road.table}${VERTICES_SUFFIX}`;
  if (resolveSchemaName(vertices.schema) !== resolveSchemaName(road.schema) || vertices.table !== expectedVertices) {
    const label = buildQualifiedTableLabel(road.schema, expectedVertices);
    issues.push(`La tabla de vértices debe ser ${label}: pgr_createTopology la crea y la usa con ese nombre.`);
  }
  if (rawOf(context, VERTICES, VERTICES_COLUMN.ID) !== PGR_VERTEX_ID) {
    issues.push(`La columna de id de la tabla de vértices debe llamarse "${PGR_VERTEX_ID}": pgr_createTopology la usa por ese nombre.`);
  }
  if (rawOf(context, VERTICES, VERTICES_COLUMN.THE_GEOM) !== PGR_VERTEX_GEOMETRY) {
    issues.push(`La columna de geometría de la tabla de vértices debe llamarse "${PGR_VERTEX_GEOMETRY}": pgr_createTopology la usa por ese nombre.`);
  }
  return issues;
}

export interface IndexRequirement {
  key: string;
  label: string;
}

export interface TopologyIndexes {
  tables: string[];
  required: IndexRequirement[];
}

/** Leading-column indexes of the tables pgRouting writes: `qualified|column|method`, valid indexes only. Params: the qualified table names. */
export const LEADING_INDEX_SQL = [
  'SELECT n.nspname || \'.\' || t.relname AS "qualified", a.attname AS "column_name", am.amname AS "method"',
  "FROM pg_index AS i JOIN pg_class AS t ON t.oid = i.indrelid JOIN pg_namespace AS n ON n.oid = t.relnamespace",
  "JOIN pg_class AS ic ON ic.oid = i.indexrelid JOIN pg_am AS am ON am.oid = ic.relam",
  "JOIN pg_attribute AS a ON a.attrelid = t.oid AND a.attnum = i.indkey[0]",
  "WHERE i.indisvalid AND n.nspname || '.' || t.relname = ANY($1::text[])",
].join(" ");

/** pgr_createTopology creates a missing index on the columns it reads, which the revert would not drop: each one must exist beforehand. */
export function topologyIndexesOf(context: EjesLoadContext): TopologyIndexes {
  const roadName = qualifiedNameOf(context.targets[ROAD]);
  const vertexName = qualifiedNameOf(context.targets[VERTICES]);
  const requirement = (qualified: string, column: string, method: "btree" | "gist", kind: string): IndexRequirement => ({
    key: `${qualified}|${column}|${method}`,
    label: `índice ${kind} sobre ${qualified}(${column})`,
  });
  const roadColumn = (logical: string): string => rawOf(context, ROAD, logical);
  return {
    tables: [roadName, vertexName],
    required: [
      requirement(roadName, roadColumn(ROAD_SECTION_COLUMN.ID), "btree", "btree"),
      requirement(roadName, roadColumn(ROAD_SECTION_COLUMN.SOURCE), "btree", "btree"),
      requirement(roadName, roadColumn(ROAD_SECTION_COLUMN.TARGET), "btree", "btree"),
      requirement(roadName, roadColumn(ROAD_SECTION_COLUMN.GEOMETRY), "gist", "GiST"),
      requirement(vertexName, rawOf(context, VERTICES, VERTICES_COLUMN.THE_GEOM), "gist", "GiST"),
    ],
  };
}

/** The sections whose topology the load sets: the inserted ones (merged ones included) and the ones whose geometry changed. */
export const buildTopologyIdsSql = (): string =>
  createTemp(
    LOAD_TEMP.TOPO,
    [
      `SELECT n.section_id::bigint AS id FROM ${tmp(LOAD_TEMP.NEW)} AS n`,
      "UNION",
      `SELECT s.road_id::bigint FROM ${tmp(LOAD_TEMP.STATE)} AS s WHERE s.geom_changed`,
    ].join(" ")
  );

/** The vertices the load may delete: the endpoints the sections deleted or geometry-changed by this load held before it. Taken before the writes. */
export function buildVertexCandidatesSql(context: EjesLoadContext): string {
  const gone = [
    `SELECT d.road_id FROM ${tmp(LOAD_TEMP.DEL)} AS d`,
    `UNION SELECT s.road_id FROM ${tmp(LOAD_TEMP.STATE)} AS s WHERE s.geom_changed`,
  ].join(" ");
  const endpoint = (logical: string): string =>
    [
      `SELECT r.${physicalOf(context, ROAD, logical)}::bigint AS vertex_id FROM ${qualifiedOf(context, ROAD)} AS r`,
      `JOIN ${q(GONE_CTE)} AS g ON g.road_id = r.${physicalOf(context, ROAD, ROAD_SECTION_COLUMN.ID)}`,
    ].join(" ");
  return createTemp(
    LOAD_TEMP.VERTEX_CANDIDATES,
    [
      withClause([cte(GONE_CTE, gone)]),
      "SELECT DISTINCT e.vertex_id FROM (",
      `${endpoint(ROAD_SECTION_COLUMN.SOURCE)} UNION ALL ${endpoint(ROAD_SECTION_COLUMN.TARGET)}`,
      ") AS e WHERE e.vertex_id IS NOT NULL",
    ].join(" ")
  );
}

export function buildCreateTopologySql(context: EjesLoadContext): string {
  const road = context.targets[ROAD];
  const id = rawOf(context, ROAD, ROAD_SECTION_COLUMN.ID);
  const rowsWhere = `${quoteIdentifier(id)} IN (SELECT id FROM ${tmp(LOAD_TEMP.TOPO)})`;
  const args = [
    literal(`${resolveSchemaName(road.schema)}.${road.table}`),
    String(TOPOLOGY_TOLERANCE_M),
    literal(rawOf(context, ROAD, ROAD_SECTION_COLUMN.GEOMETRY)),
    literal(id),
    literal(rawOf(context, ROAD, ROAD_SECTION_COLUMN.SOURCE)),
    literal(rawOf(context, ROAD, ROAD_SECTION_COLUMN.TARGET)),
  ];
  return `SELECT pgr_createTopology(${args.join(", ")}, rows_where := ${literal(rowsWhere)}, clean := false) AS "topology"`;
}

/** Sections of the topology set that hold a source and a target, and those that do not (a missing section counts as missing). */
export function buildTopologyCheckSql(context: EjesLoadContext): string {
  const road = (logical: string): string => `r.${physicalOf(context, ROAD, logical)}`;
  const linked = [ROAD_SECTION_COLUMN.ID, ROAD_SECTION_COLUMN.SOURCE, ROAD_SECTION_COLUMN.TARGET]
    .map((logical) => `${road(logical)} IS NOT NULL`)
    .join(" AND ");
  return [
    `SELECT count(*) FILTER (WHERE ${linked}) AS "assigned", count(*) FILTER (WHERE NOT (${linked})) AS "missing"`,
    `FROM ${tmp(LOAD_TEMP.TOPO)} AS t LEFT JOIN ${qualifiedOf(context, ROAD)} AS r ON ${road(ROAD_SECTION_COLUMN.ID)} = t.id`,
  ].join(" ");
}

export const buildTopologyCountSql = (): string => `SELECT count(*) AS "count" FROM ${tmp(LOAD_TEMP.TOPO)}`;

export function buildVertexTotalsSql(context: EjesLoadContext): string {
  const id = physicalOf(context, VERTICES, VERTICES_COLUMN.ID);
  return `SELECT count(*) AS "total", COALESCE(max(v.${id}), 0) AS "max_id" FROM ${qualifiedOf(context, VERTICES)} AS v`;
}

/** Vertices above the largest id seen before the topology step: the ones pgr_createTopology inserted. */
export function buildCreatedVerticesSql(context: EjesLoadContext, afterId: number): string {
  const id = physicalOf(context, VERTICES, VERTICES_COLUMN.ID);
  return `SELECT count(*) AS "created" FROM ${qualifiedOf(context, VERTICES)} AS v WHERE v.${id} > ${afterId}`;
}

/** A vertex no section holds as source or target, after the topology and the removals of this load. */
function unusedVertexSql(context: EjesLoadContext): string {
  const id = physicalOf(context, VERTICES, VERTICES_COLUMN.ID);
  const source = physicalOf(context, ROAD, ROAD_SECTION_COLUMN.SOURCE);
  const target = physicalOf(context, ROAD, ROAD_SECTION_COLUMN.TARGET);
  return `NOT EXISTS (SELECT 1 FROM ${qualifiedOf(context, ROAD)} AS r WHERE r.${source} = v.${id} OR r.${target} = v.${id})`;
}

export function buildUnusedCandidatesSql(context: EjesLoadContext): string {
  const id = physicalOf(context, VERTICES, VERTICES_COLUMN.ID);
  return [
    `SELECT count(*) AS "expected" FROM ${qualifiedOf(context, VERTICES)} AS v`,
    `JOIN ${tmp(LOAD_TEMP.VERTEX_CANDIDATES)} AS c ON c.vertex_id = v.${id}`,
    `WHERE ${unusedVertexSql(context)}`,
  ].join(" ");
}

/** Deletes only the candidates no section uses; the same predicate as `buildUnusedCandidatesSql`, so the two counts agree. */
export function buildDeleteUnusedVerticesSql(context: EjesLoadContext): string {
  const id = physicalOf(context, VERTICES, VERTICES_COLUMN.ID);
  return counted(
    [
      `DELETE FROM ${qualifiedOf(context, VERTICES)} AS v USING ${tmp(LOAD_TEMP.VERTEX_CANDIDATES)} AS c`,
      `WHERE c.vertex_id = v.${id} AND ${unusedVertexSql(context)}`,
    ].join(" ")
  );
}
