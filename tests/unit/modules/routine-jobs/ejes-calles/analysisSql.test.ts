import { describe, expect, it } from "vitest";
import {
  ANALYSIS_LIST_ALIAS,
  buildEjesAnalysisSql,
  comparableLineSql,
  coverageThresholdSql,
  geometriesDifferSql,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { ejesLayouts } from "./ejesFixtures";

describe("buildEjesAnalysisSql", () => {
  const sql = buildEjesAnalysisSql(ejesLayouts());

  describe("read-only (EJ-3, EJ-8..EJ-12)", () => {
    it("should be a single WITH ... SELECT with no write or DDL keywords", () => {
      expect(sql).toMatch(/^WITH /);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/i);
    });

    it("should read staging, road_section, circulation_way, access_point, localities and departments", () => {
      for (const name of [
        '"bdj_carto"."ide_ejesviacirculacion"',
        '"carto"."road_section"',
        '"carto"."circulation_way"',
        '"carto"."access_point"',
        '"bdj_carto"."ine_localidades_pg"',
        '"carto"."mv_country_province"',
      ]) {
        expect(sql).toContain(name);
      }
    });
  });

  describe("EJ-9 classification", () => {
    it("should match staging to road_section by reftramo_ideuy", () => {
      expect(sql).toContain('LEFT JOIN "cur" AS c ON c.ref = s.ref');
      expect(sql).toContain('"reftramo_ideuy"');
    });

    it("should flag NEW when no road_section matches", () => {
      expect(sql).toContain("(m.cur_id IS NULL) AS is_new");
    });

    it("should flag ATTR on name, idcalle, type or font changes", () => {
      expect(sql).toContain("m.nombre IS DISTINCT FROM m.cur_name");
      expect(sql).toContain("m.idcalle IS DISTINCT FROM m.cur_idcalle");
      expect(sql).toContain("m.new_type_id IS DISTINCT FROM m.cur_type_id");
      expect(sql).toContain("m.new_font_id IS DISTINCT FROM m.cur_font_id");
    });

    it("should flag GEOM using a 4 decimals snapped, merged and normalized comparison", () => {
      expect(comparableLineSql("g")).toBe("ST_Normalize(ST_SnapToGrid(ST_LineMerge(g), 0.0001))");
      expect(geometriesDifferSql("a", "b")).toBe(
        "NOT COALESCE(ST_OrderingEquals(ST_Normalize(ST_SnapToGrid(ST_LineMerge(a), 0.0001)), ST_Normalize(ST_SnapToGrid(ST_LineMerge(b), 0.0001))), false)"
      );
      expect(sql).toContain("ST_OrderingEquals");
    });

    it("should count both as attr and geom changed together", () => {
      expect(sql).toContain("attr_changed AND geom_changed");
    });

    it("should count unchanged as not new, not attr and not geom changed", () => {
      expect(sql).toContain("NOT is_new AND NOT attr_changed AND NOT geom_changed");
    });

    it("should read only staging rows with a valid integer reftramo and non-empty geometry", () => {
      expect(sql).toContain("~ '^[0-9]+$'");
      expect(sql).toContain("NOT ST_IsEmpty(");
    });
  });

  describe("EJ-10 split and merge", () => {
    it("should define REMOVED as road_section rows absent from staging", () => {
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "stg_keys" AS k WHERE k.ref = c.ref)');
    });

    it("should use a 95% coverage threshold", () => {
      expect(coverageThresholdSql("covered", "len")).toBe("covered >= 0.95 * len");
      expect(sql).toContain("covered >= 0.95 * len");
      expect(sql).toContain("sum(p.covered) >= 0.95 * sum(p.len)");
    });

    it("should use a 1 m tolerance for buffer and ST_DWithin", () => {
      expect(sql).toContain("ST_Buffer(ST_Collect(n.geom), 1)");
      expect(sql).toContain("ST_DWithin(r.geometry, n.geom, 1)");
      expect(sql).toContain("ST_Buffer(n.geom, 1)");
    });

    it("should require two or more NEW sections for a split", () => {
      expect(sql).toContain("new_count >= 2");
    });

    it("should require two or more removed sections of the same idcalle for a merge", () => {
      expect(sql).toContain("r.idcalle = n.idcalle");
      expect(sql).toContain("HAVING count(*) >= 2");
    });

    it("should exclude splits and merged sections from plain removals", () => {
      expect(sql).toContain(
        'r.id NOT IN (SELECT id FROM "splits") AND r.id NOT IN (SELECT id FROM "merged_ids")'
      );
    });

    it("should list plain removals with access points first and count them as held", () => {
      expect(sql).toContain("ORDER BY COALESCE(ap.points, 0) DESC, p.ref");
      expect(sql).toContain('AS "plain_held"');
    });

    it("should describe each new street with its departments, localities and type", () => {
      for (const alias of ["tipos", "departments", "localities"]) expect(sql).toContain(`AS "${alias}"`);
      expect(sql).toContain("string_agg(DISTINCT c.localidad");
    });

    it("should report access points of each removed section", () => {
      expect(sql).toContain('LEFT JOIN "ap" AS ap ON ap.ref = s.ref');
      expect(sql).toContain("count(*) AS points");
      expect(sql).toContain('AS "points"');
    });
  });

  describe("EJ-11 cloc_iso", () => {
    it("should pick the locality with the longest intersection", () => {
      expect(sql).toContain("ORDER BY ST_Length(ST_Intersection(");
      expect(sql).toContain("DESC LIMIT 1) AS cloc");
    });

    it("should fall back to the department code via iso_code_dpto", () => {
      expect(sql).toContain('"iso_code_dpto"');
      expect(sql).toContain("dp.code = upper(c.departamento)");
      expect(sql).toContain("AS dept_code");
    });

    it("should compute it only for NEW and GEOM sections", () => {
      expect(sql).toContain("WHERE c.is_new OR c.geom_changed");
    });

    it("should count with_locality, only_department and without_code", () => {
      expect(sql).toContain('(SELECT count(*) FROM "located" WHERE cloc IS NOT NULL) AS "with_locality"');
      expect(sql).toContain('WHERE cloc IS NULL AND dept_code IS NOT NULL) AS "only_department"');
      expect(sql).toContain('WHERE cloc IS NULL AND dept_code IS NULL) AS "without_code"');
    });
  });

  describe("EJ-12 report columns", () => {
    it.each([
      "new_sections",
      "unchanged",
      "attr",
      "geom",
      "both",
      "removed",
      "splits",
      "merges",
      "plain_removals",
      "plain_held",
      "new_streets",
    ])("should select count %s", (alias) => {
      expect(sql).toContain(`AS "${alias}"`);
    });

    it("should select every list alias, limited to 500 rows", () => {
      for (const alias of Object.values(ANALYSIS_LIST_ALIAS)) expect(sql).toContain(`AS "${alias}"`);
      expect(sql).toContain("LIMIT 500");
    });
  });

  it("should throw when a layout column is missing", () => {
    const layouts = ejesLayouts();
    delete layouts["ejes-localidades"].columns.cloc_iso;

    expect(() => buildEjesAnalysisSql(layouts)).toThrow(/cloc_iso/);
  });
});
