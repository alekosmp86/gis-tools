import { describe, expect, it } from "vitest";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { buildStagingChecksSql, validGeometrySql } from "@/modules/routine-jobs/jobs/ejes-calles/domain/stagingSql";
import { ejesLayouts } from "./ejesFixtures";

describe("buildStagingChecksSql (EJ-8)", () => {
  const sql = buildStagingChecksSql(ejesLayouts());

  it("should read the staging table and nothing else", () => {
    expect(sql).toContain('"bdj_carto"."ide_ejesviacirculacion"');
    expect(sql).not.toContain('"carto"."road_section"');
  });

  it("should be a read-only statement with no write keywords", () => {
    expect(sql).toMatch(/^WITH /);
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\b/i);
  });

  it.each([
    "rows",
    "distinct_refs",
    "repeated_groups",
    "repeated_rows",
    "non_integer_refs",
    "empty_geometry",
    "empty_idcalle",
    "damaged_text_rows",
    "unknown_tipo_rows",
    "unknown_fuente_rows",
    "unknown_tipos",
    "unknown_fuentes",
  ])("should select the %s column", (alias) => {
    expect(sql).toContain(`AS "${alias}"`);
  });

  it("should detect repeated refs with GROUP BY and HAVING count(*) > 1", () => {
    expect(sql).toContain("GROUP BY ref HAVING count(*) > 1");
  });

  it("should test non-integer refs with the integer pattern", () => {
    expect(sql).toContain("ref !~ '^[0-9]+$'");
  });

  it("should flag the replacement character in nombre, localidad and departamento", () => {
    expect(sql.match(/position\(chr\(65533\) in/g)).toHaveLength(3);
  });

  it("should flag null or empty geometry", () => {
    expect(sql).toContain("IS NULL OR ST_IsEmpty(");
  });

  describe("ET-18 invalid geometries", () => {
    it("should define the validity predicate so a null or empty geometry is not invalid", () => {
      expect(validGeometrySql("g")).toBe("COALESCE(ST_IsValid(g), true)");
    });

    it("should carry localidad, departamento and invalid_geometry in the s CTE", () => {
      expect(sql).toContain("AS localidad");
      expect(sql).toContain("AS departamento");
      expect(sql).toContain('(NOT COALESCE(ST_IsValid(s."geom"), true)) AS invalid_geometry');
    });

    it("should count the invalid rows and the distinct invalid reftramo", () => {
      expect(sql).toContain('(SELECT count(*) FROM "s" WHERE invalid_geometry) AS "invalid_geometry_rows"');
      expect(sql).toContain('(SELECT count(DISTINCT ref) FROM "s" WHERE invalid_geometry) AS "invalid_geometry_refs"');
    });

    it("should list the invalid rows with ref, idcalle, localidad and departamento ordered by ref and localidad, limited", () => {
      expect(sql).toContain('x.ref AS "ref", x.idcalle AS "idcalle", x.localidad AS "localidad", x.departamento AS "departamento"');
      expect(sql).toContain(`WHERE x.invalid_geometry ORDER BY x.ref, x.localidad LIMIT ${DETAIL_LIST_LIMIT}`);
      expect(sql).toContain('AS "invalid_geometries"');
    });

    it("should leave the raw counts without a validity condition", () => {
      expect(sql).toContain('(SELECT count(*) FROM "s") AS "rows"');
      expect(sql).toContain('(SELECT count(DISTINCT ref) FROM "s") AS "distinct_refs"');
    });

    it("should stay read-only", () => {
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/i);
    });
  });

  it("should compare tipo and fuente against the mapping tables", () => {
    expect(sql).toContain("'CALLE INTERNA', 20");
    expect(sql).toContain("'MTOP', 7");
    expect(sql).toContain("NOT EXISTS");
  });

  it("should use the physical column names of the layout", () => {
    const layouts = ejesLayouts();
    layouts["ejes-origen"].columns.reftramo = "ref_tramo";

    expect(buildStagingChecksSql(layouts)).toContain('"ref_tramo"');
  });

  it("should throw when a logical column is not resolved", () => {
    const layouts = ejesLayouts();
    delete layouts["ejes-origen"].columns.geom;

    expect(() => buildStagingChecksSql(layouts)).toThrow(/geom/);
  });
});
