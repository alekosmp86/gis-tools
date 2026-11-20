import { describe, expect, it } from "vitest";
import { buildEjesAnalysisSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { buildCopyTableSql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/loadSelectionSql";
import { buildStagingChecksSql, keptStagingRowSql, validGeometrySql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/stagingSql";
import { ejesLayouts } from "./ejesFixtures";

const SHORT_UNHELD_HEAD = 'WITH "short_unheld" AS (SELECT x.ref FROM';
const ACCESS_POINT_IN = /\bIN \(SELECT (DISTINCT )?CASE WHEN NULLIF\(btrim\(a\."id_road_section"/;
const ACCESS_POINT_EXISTS = /EXISTS \(SELECT 1 FROM "carto"\."access_point"/;

const BUILDERS: Array<[string, () => string]> = [
  ["buildStagingChecksSql", () => buildStagingChecksSql(ejesLayouts())],
  ["buildEjesAnalysisSql", () => buildEjesAnalysisSql(ejesLayouts())],
  ["buildCopyTableSql", () => buildCopyTableSql(ejesLayouts())],
];

describe("short_unheld CTE (ET-18 performance rewrite)", () => {
  describe.each(BUILDERS)("%s", (_name, build) => {
    it("should declare short_unheld as the first CTE of the statement", () => {
      const sql = build();

      expect(sql.slice(sql.indexOf("WITH ")).startsWith(SHORT_UNHELD_HEAD)).toBe(true);
    });

    it("should read the access points only through a hashed LEFT JOIN, never through IN or EXISTS", () => {
      const sql = build();

      expect(sql).toContain('LEFT JOIN (SELECT DISTINCT CASE WHEN NULLIF(btrim(a."id_road_section"::text)');
      expect(sql).not.toMatch(ACCESS_POINT_IN);
      expect(sql).not.toMatch(ACCESS_POINT_EXISTS);
    });

    it("should keep the short-section test a set membership test on short_unheld", () => {
      expect(build()).toMatch(/COALESCE\(.+? NOT IN \(SELECT ref FROM "short_unheld"\), false\)/);
    });
  });

  describe("short_unheld body", () => {
    it("should select only staging refs shorter than 1 m with a present, non-empty geometry", () => {
      const sql = buildStagingChecksSql(ejesLayouts());

      expect(sql).toContain('WHERE s."geom" IS NOT NULL AND NOT ST_IsEmpty(s."geom") AND ST_Length(s."geom") < 1)');
    });

    it("should keep only refs that are not null and that no access point holds", () => {
      expect(buildStagingChecksSql(ejesLayouts())).toContain("WHERE x.ref IS NOT NULL AND p.ref IS NULL");
    });
  });

  describe("predicates", () => {
    it("should keep access_point out of the validity predicate", () => {
      const predicate = validGeometrySql("g", "r");

      expect(predicate).not.toContain("access_point");
      expect(predicate).not.toMatch(ACCESS_POINT_EXISTS);
      expect(predicate).not.toMatch(ACCESS_POINT_IN);
    });

    it("should keep access_point out of the kept-row predicate", () => {
      const predicate = keptStagingRowSql("g", "r");

      expect(predicate).not.toContain("access_point");
      expect(predicate).not.toMatch(ACCESS_POINT_EXISTS);
      expect(predicate).not.toMatch(ACCESS_POINT_IN);
    });

    it("should test the reference against short_unheld in the kept-row predicate", () => {
      expect(keptStagingRowSql("g", "r")).toContain('r IS NOT NULL AND r NOT IN (SELECT ref FROM "short_unheld")');
    });
  });
});
