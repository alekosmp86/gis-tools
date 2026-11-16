import { describe, expect, it } from "vitest";
import { buildRevertCreatedVerticesSql, buildRevertRestoredVerticesSql, REVERT_ORDER } from "@/modules/routine-jobs/jobs/ejes-calles/domain/revertSql";
import { ejesLoadContextFixture } from "./ejesFixtures";

describe("buildRevertRestoredVerticesSql (EJ-28, step 1)", () => {
  it("should name its temp table ej_rev_vertices_del, the first statement of the revert file", () => {
    expect(REVERT_ORDER[0]).toBe("ej_rev_vertices_del");
    expect(buildRevertRestoredVerticesSql(ejesLoadContextFixture())).toMatch(/^CREATE TEMP TABLE "ej_rev_vertices_del" ON COMMIT DROP AS /);
  });

  it("should take the rows to restore from the candidate vertices of the load, not from the topology", () => {
    expect(buildRevertRestoredVerticesSql(ejesLoadContextFixture())).toContain(
      'FROM (SELECT t."id" AS row_id, to_jsonb(t)::text AS row_json FROM "carto"."road_section_vertices_pgr" AS t WHERE t."id" IN (SELECT c.vertex_id FROM pg_temp."ej_vertex_candidates" AS c)) AS x'
    );
  });

  it("should re-insert a candidate only when it is missing, so the candidates the load kept are skipped", () => {
    expect(buildRevertRestoredVerticesSql(ejesLoadContextFixture())).toContain("WHERE NOT EXISTS (SELECT 1 FROM %s AS y WHERE y.%s = x.%s);");
  });

  it("should rebuild the full row, the_geom included, from its JSON", () => {
    const sql = buildRevertRestoredVerticesSql(ejesLoadContextFixture());

    expect(sql).toContain("jsonb_populate_record(NULL::%s, %L)");
    expect(sql).toContain("to_jsonb(t)::text AS row_json");
  });
});

describe("buildRevertCreatedVerticesSql (EJ-28, step 7)", () => {
  it("should name its temp table ej_rev_vertices_new, the last statement of the revert file", () => {
    expect(REVERT_ORDER[REVERT_ORDER.length - 1]).toBe("ej_rev_vertices_new");
    expect(buildRevertCreatedVerticesSql(ejesLoadContextFixture())).toMatch(/^CREATE TEMP TABLE "ej_rev_vertices_new" ON COMMIT DROP AS SELECT 1::bigint AS n, format\(/);
  });

  it("should delete only the vertices with an id above the largest id read before the load", () => {
    const sql = buildRevertCreatedVerticesSql(ejesLoadContextFixture());

    expect(sql).toContain("DELETE FROM %s AS v WHERE v.%s > %s AND NOT EXISTS");
    expect(sql).toContain(`'"id"', m.max_id, '"carto"."road_section"'`);
    expect(sql).toContain('FROM (SELECT COALESCE(max(v."id"), 0) AS max_id FROM "carto"."road_section_vertices_pgr" AS v) AS m');
  });

  it("should keep a vertex that a section names as source or as target, checking both columns", () => {
    const sql = buildRevertCreatedVerticesSql(ejesLoadContextFixture());

    expect(sql).toContain("AND NOT EXISTS (SELECT 1 FROM %s AS r WHERE r.%s = v.%s OR r.%s = v.%s);");
    expect(sql).toContain("'\"source\"'");
    expect(sql).toContain("'\"target\"'");
    expect(sql).toContain("'\"carto\".\"road_section\"'");
  });
});
