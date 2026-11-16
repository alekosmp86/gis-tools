import { describe, expect, it } from "vitest";
import { EJES_TABLE_ROLE, TOPOLOGY_TOLERANCE_M } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import {
  buildCreatedVerticesSql,
  buildCreateTopologySql,
  buildDeleteUnusedVerticesSql,
  buildTopologyCheckSql,
  buildTopologyCountSql,
  buildTopologyIdsSql,
  buildUnusedCandidatesSql,
  buildVertexCandidatesSql,
  buildVertexTotalsSql,
  LEADING_INDEX_SQL,
  PGR_SUPPORT_SQL,
  topologyIndexesOf,
  topologyNameIssuesOf,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/topologySql";
import { ejesLoadContextFixture, roadColumnsPatch } from "./ejesFixtures";

const ROAD = EJES_TABLE_ROLE.ROAD_SECTION;
const VERTICES = EJES_TABLE_ROLE.VERTICES;
const VERTICES_TABLE = '"carto"."road_section_vertices_pgr"';

const ROAD_NOT_EXISTS =
  'NOT EXISTS (SELECT 1 FROM "carto"."road_section" AS r WHERE r."source" = v."id" OR r."target" = v."id")';

describe("topologyNameIssuesOf (EJ-20)", () => {
  it("should return no issue for the default names, with the vertices table named after the road section table", () => {
    expect(topologyNameIssuesOf(ejesLoadContextFixture())).toEqual([]);
  });

  it("should block a vertices table with another name than <road_section>_vertices_pgr", () => {
    const issues = topologyNameIssuesOf(ejesLoadContextFixture([VERTICES, { table: "vertices_otra" }]));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/debe ser carto\.road_section_vertices_pgr/);
  });

  it("should block a vertices table in another schema than the road section table", () => {
    const issues = topologyNameIssuesOf(ejesLoadContextFixture([VERTICES, { schema: "otro" }]));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatch(/debe ser .*road_section_vertices_pgr/);
  });

  it("should block an upper-case road section table name, since pgRouting takes it as text", () => {
    const issues = topologyNameIssuesOf(
      ejesLoadContextFixture([ROAD, { table: "Road_Section" }], [VERTICES, { table: "Road_Section_vertices_pgr" }])
    );

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('"Road_Section"');
  });

  it("should block a geometry column with upper-case letters", () => {
    const issues = topologyNameIssuesOf(ejesLoadContextFixture([ROAD, roadColumnsPatch({ geometry: "Geometry" })]));

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('"Geometry"');
  });

  it("should block a source column name with a space and a target column name with a quote", () => {
    const withSpace = topologyNameIssuesOf(ejesLoadContextFixture([ROAD, roadColumnsPatch({ source: "src node" })]));
    const withQuote = topologyNameIssuesOf(ejesLoadContextFixture([ROAD, roadColumnsPatch({ target: 'tgt"' })]));

    expect(withSpace.some((issue) => issue.includes('"src node"'))).toBe(true);
    expect(withQuote.some((issue) => issue.includes('"tgt""'))).toBe(true);
  });

  it("should block an identifier that starts with a digit", () => {
    const issues = topologyNameIssuesOf(ejesLoadContextFixture([ROAD, roadColumnsPatch({ id: "1id" })]));

    expect(issues.some((issue) => issue.includes('"1id"'))).toBe(true);
  });

  it("should report every non-simple name, one issue each, and the vertices name issue after them", () => {
    const issues = topologyNameIssuesOf(
      ejesLoadContextFixture([ROAD, { table: "Road", ...roadColumnsPatch({ geometry: "G" }) }], [VERTICES, { table: "x" }])
    );

    expect(issues).toHaveLength(3);
    expect(issues[0]).toContain('"Road"');
    expect(issues[1]).toContain('"G"');
    expect(issues[2]).toMatch(/debe ser .*Road_vertices_pgr/);
  });
});

describe("buildCreateTopologySql (EJ-20)", () => {
  it("should build pgr_createTopology with the schema-qualified table, the tolerance and the plain column names", () => {
    expect(buildCreateTopologySql(ejesLoadContextFixture())).toBe(
      `SELECT pgr_createTopology('carto.road_section', 0.1, 'geometry', 'id', 'source', 'target', rows_where := '"id" IN (SELECT id FROM pg_temp."ej_topo_ids")', clean := false) AS "topology"`
    );
  });

  it("should alias the pgr_createTopology result as topology, the column the load reads its OK or FAIL from", () => {
    expect(buildCreateTopologySql(ejesLoadContextFixture())).toMatch(/\) AS "topology"$/);
  });

  it("should call pgr_createTopology once, as the only statement of the topology call", () => {
    const sql = buildCreateTopologySql(ejesLoadContextFixture());

    expect(sql.startsWith("SELECT pgr_createTopology(")).toBe(true);
    expect(sql.match(/pgr_createTopology\(/g)).toHaveLength(1);
  });

  it("should pass TOPOLOGY_TOLERANCE_M as the tolerance argument, 0.1 metres", () => {
    expect(TOPOLOGY_TOLERANCE_M).toBe(0.1);
    expect(buildCreateTopologySql(ejesLoadContextFixture())).toContain(`, ${TOPOLOGY_TOLERANCE_M}, 'geometry', `);
  });

  it("should restrict the rows to the ids of the topology set, the id column quoted inside the literal", () => {
    expect(buildCreateTopologySql(ejesLoadContextFixture())).toContain(`rows_where := '"id" IN (SELECT id FROM pg_temp."ej_topo_ids")'`);
  });

  it("should pass clean := false so pgRouting keeps the existing vertices", () => {
    expect(buildCreateTopologySql(ejesLoadContextFixture())).toMatch(/, clean := false\) AS "topology"$/);
  });

  it("should use the physical names of the columns, not the logical ones", () => {
    const sql = buildCreateTopologySql(ejesLoadContextFixture([ROAD, roadColumnsPatch({ geometry: "geom_ruteo", source: "nodo_ini" })]));

    expect(sql).toContain(`'geom_ruteo', 'id', 'nodo_ini', 'target'`);
  });
});

describe("topology sets and vertex candidates (EJ-20, EJ-27)", () => {
  it("should take the topology ids from the NEW sections and the GEOM-changed sections", () => {
    expect(buildTopologyIdsSql()).toBe(
      'CREATE TEMP TABLE "ej_topo_ids" ON COMMIT DROP AS SELECT n.section_id::bigint AS id FROM pg_temp."ej_new" AS n UNION SELECT s.road_id::bigint FROM pg_temp."ej_state" AS s WHERE s.geom_changed'
    );
  });

  it("should count the topology set with a plain count", () => {
    expect(buildTopologyCountSql()).toBe('SELECT count(*) AS "count" FROM pg_temp."ej_topo_ids"');
  });

  it("should take the candidates from the deleted sections and the GEOM-changed sections of this load", () => {
    const sql = buildVertexCandidatesSql(ejesLoadContextFixture());

    expect(sql).toContain('CREATE TEMP TABLE "ej_vertex_candidates" ON COMMIT DROP AS WITH "gone" AS (');
    expect(sql).toContain('SELECT d.road_id FROM pg_temp."ej_del" AS d');
    expect(sql).toContain('UNION SELECT s.road_id FROM pg_temp."ej_state" AS s WHERE s.geom_changed');
  });

  it("should take both endpoints, source and target, of every gone section as candidates", () => {
    const sql = buildVertexCandidatesSql(ejesLoadContextFixture());

    expect(sql).toContain('SELECT r."source"::bigint AS vertex_id FROM "carto"."road_section" AS r JOIN "gone" AS g ON g.road_id = r."id"');
    expect(sql).toContain('SELECT r."target"::bigint AS vertex_id FROM "carto"."road_section" AS r JOIN "gone" AS g ON g.road_id = r."id"');
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain("WHERE e.vertex_id IS NOT NULL");
  });

  it("should only read while it builds the candidates: no write statement in the candidate SQL", () => {
    expect(buildVertexCandidatesSql(ejesLoadContextFixture())).not.toMatch(/\b(INSERT|UPDATE|DELETE)\b/);
  });
});

describe("vertex deletes and their expected count share one predicate (EJ-27)", () => {
  it("should count the expected deletes with the NOT EXISTS over road_section on source and target", () => {
    expect(buildUnusedCandidatesSql(ejesLoadContextFixture())).toBe(
      `SELECT count(*) AS "expected" FROM ${VERTICES_TABLE} AS v JOIN pg_temp."ej_vertex_candidates" AS c ON c.vertex_id = v."id" WHERE ${ROAD_NOT_EXISTS}`
    );
  });

  it("should delete only the candidates matched by the same NOT EXISTS, and count the rows written", () => {
    expect(buildDeleteUnusedVerticesSql(ejesLoadContextFixture())).toBe(
      `WITH "written" AS (DELETE FROM ${VERTICES_TABLE} AS v USING pg_temp."ej_vertex_candidates" AS c WHERE c.vertex_id = v."id" AND ${ROAD_NOT_EXISTS} RETURNING 1) SELECT count(*) AS "written" FROM "written"`
    );
  });

  it("should use the same NOT EXISTS text in the expected count and in the delete", () => {
    const predicateOf = (sql: string): string => {
      const start = sql.indexOf("NOT EXISTS");
      return sql.slice(start, start + ROAD_NOT_EXISTS.length);
    };

    expect(predicateOf(buildDeleteUnusedVerticesSql(ejesLoadContextFixture()))).toBe(ROAD_NOT_EXISTS);
    expect(predicateOf(buildUnusedCandidatesSql(ejesLoadContextFixture()))).toBe(ROAD_NOT_EXISTS);
  });
});

describe("topology check, totals and created vertices (EJ-20, EJ-27)", () => {
  it("should count the sections of the topology set with an id, a source and a target as assigned, and the others as missing", () => {
    const sql = buildTopologyCheckSql(ejesLoadContextFixture());

    expect(sql).toContain('count(*) FILTER (WHERE r."id" IS NOT NULL AND r."source" IS NOT NULL AND r."target" IS NOT NULL) AS "assigned"');
    expect(sql).toContain('count(*) FILTER (WHERE NOT (r."id" IS NOT NULL AND r."source" IS NOT NULL AND r."target" IS NOT NULL)) AS "missing"');
  });

  it("should left-join the topology set to road_section, so a section that is gone counts as missing", () => {
    expect(buildTopologyCheckSql(ejesLoadContextFixture())).toContain(
      'FROM pg_temp."ej_topo_ids" AS t LEFT JOIN "carto"."road_section" AS r ON r."id" = t.id'
    );
  });

  it("should read the vertex total and the largest id of the vertices table", () => {
    expect(buildVertexTotalsSql(ejesLoadContextFixture())).toBe(
      `SELECT count(*) AS "total", COALESCE(max(v."id"), 0) AS "max_id" FROM ${VERTICES_TABLE} AS v`
    );
  });

  it("should count the created vertices as the ids above the largest id read before the step", () => {
    expect(buildCreatedVerticesSql(ejesLoadContextFixture(), 7)).toBe(`SELECT count(*) AS "created" FROM ${VERTICES_TABLE} AS v WHERE v."id" > 7`);
  });

  it("should count every vertex as created when the vertices table was empty before the step", () => {
    expect(buildCreatedVerticesSql(ejesLoadContextFixture(), 0)).toMatch(/WHERE v\."id" > 0$/);
  });

  it("should read the totals of the vertices role of the context, whatever its table name", () => {
    expect(buildVertexTotalsSql(ejesLoadContextFixture([VERTICES, { table: "otra_vertices" }]))).toContain('"carto"."otra_vertices"');
  });
});

describe("pgRouting probes and index requirements (EJ-20)", () => {
  it("should probe the EXECUTE privilege of the current user on pgr_createTopology with its signature", () => {
    expect(PGR_SUPPORT_SQL).toContain("to_regproc('pgr_version') IS NOT NULL AS installed");
    expect(PGR_SUPPORT_SQL).toContain("to_regprocedure('pgr_createTopology(text, float8, text, text, text, text, text, boolean)') IS NOT NULL AS has_topology");
    expect(PGR_SUPPORT_SQL).toContain("COALESCE(has_function_privilege(current_user, to_regprocedure('pgr_createTopology(text, float8, text, text, text, text, text, boolean)'), 'EXECUTE'), false) AS can_execute");
  });

  it("should require the btree on id, source and target and the GiST on the section and vertex geometries, keyed by table, column and method", () => {
    expect(topologyIndexesOf(ejesLoadContextFixture()).required.map((entry) => entry.key)).toEqual([
      "carto.road_section|id|btree",
      "carto.road_section|source|btree",
      "carto.road_section|target|btree",
      "carto.road_section|geometry|gist",
      "carto.road_section_vertices_pgr|the_geom|gist",
    ]);
  });

  it("should check the indexes of the road section and the vertices tables only", () => {
    expect(topologyIndexesOf(ejesLoadContextFixture()).tables).toEqual(["carto.road_section", "carto.road_section_vertices_pgr"]);
  });

  it("should read only valid indexes, keyed by the leading column, in the catalog query", () => {
    expect(LEADING_INDEX_SQL).toContain("WHERE i.indisvalid AND n.nspname || '.' || t.relname = ANY($1::text[])");
    expect(LEADING_INDEX_SQL).toContain("a.attnum = i.indkey[0]");
  });

  it("should take the physical column names of the requirements, not the logical ones", () => {
    const keys = topologyIndexesOf(ejesLoadContextFixture([EJES_TABLE_ROLE.ROAD_SECTION, roadColumnsPatch({ source: "nodo_ini" })])).required.map(
      (entry) => entry.key
    );

    expect(keys).toContain("carto.road_section|nodo_ini|btree");
  });
});
