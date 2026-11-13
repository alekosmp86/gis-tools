import { describe, expect, it } from "vitest";
import {
  ANALYSIS_LIST_ALIAS,
  buildEjesAnalysisSql,
  comparableLineSql,
  coverageThresholdSql,
  geometriesDifferSql,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import { GEOMETRY_TOLERANCE_M, RURAL_LOCALITY_SUFFIX, TWIN_NEAR_MIN_LENGTH_M, TWIN_PADRON_DISTANCE_M } from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
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
        "NOT CASE WHEN COALESCE(ST_OrderingEquals(ST_Normalize(ST_SnapToGrid(ST_LineMerge(a), 0.0001)), ST_Normalize(ST_SnapToGrid(ST_LineMerge(b), 0.0001))), false) THEN true ELSE COALESCE(ST_HausdorffDistance(a, b) < 0.001, false) END"
      );
      expect(sql).toContain("ST_OrderingEquals");
    });

    it("should take the geometry tolerance from the constant, 0.001 m", () => {
      expect(GEOMETRY_TOLERANCE_M).toBe(0.001);
      expect(geometriesDifferSql("a", "b")).toContain(`ST_HausdorffDistance(a, b) < ${GEOMETRY_TOLERANCE_M}`);
    });

    it("should read the Hausdorff distance only in the ELSE branch, so only for pairs the ordering test already calls different", () => {
      const text = geometriesDifferSql("a", "b");
      const thenAt = text.indexOf(" THEN true ");
      const elseAt = text.indexOf(" ELSE ");

      expect(text.slice(0, thenAt)).not.toContain("ST_HausdorffDistance");
      expect(text.slice(elseAt)).toContain("ST_HausdorffDistance");
      expect(text.split("ST_HausdorffDistance")).toHaveLength(2);
      expect(text.startsWith("NOT CASE WHEN COALESCE(ST_OrderingEquals(")).toBe(true);
    });

    it("should treat an ordering match as unchanged without reading the distance, and a NULL ordering or distance as different", () => {
      const text = geometriesDifferSql("a", "b");

      expect(text).toContain("THEN true ELSE");
      expect(text).toContain("COALESCE(ST_OrderingEquals(");
      expect(text).toMatch(/, false\) THEN true/);
      expect(text).toContain("< 0.001, false) END");
    });

    it("should use the expression for geom_changed of a matched section in the classified CTE", () => {
      const classified = sql.slice(sql.indexOf('"classified" AS ('));

      expect(classified).toContain(`(m.cur_id IS NOT NULL AND ${geometriesDifferSql("m.cur_geometry", "m.geom")}) AS geom_changed`);
    });

    it("should keep the 4 decimals snap for the ordering test", () => {
      expect(comparableLineSql("g")).toContain("ST_SnapToGrid(ST_LineMerge(g), 0.0001)");
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

    it("should measure the old length, the new length and the new length outside the old section of splits and merges", () => {
      for (const alias of ["old_length", "new_length", "outside_length"]) expect(sql).toContain(`AS "${alias}"`);
      expect(sql).toContain("ST_Difference(ST_Union(n.geom)");
      expect(sql).toContain("ST_Difference((array_agg(p.new_geom))[1]");
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

  describe("ET-1 padrones table", () => {
    it("should read the padrones table of the layouts, and only read it", () => {
      expect(sql).toContain('"carto"."padron"');
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/i);
    });

    it("should use the physical column names of the padrones layout", () => {
      const layouts = ejesLayouts();
      layouts["ejes-padrones"] = { schema: "x", table: "padrones_v2", columns: { type_padron: "tipo", geometry: "the_geom" } };

      const renamed = buildEjesAnalysisSql(layouts);

      expect(renamed).toContain('"x"."padrones_v2"');
      expect(renamed).toContain('p."the_geom"');
      expect(renamed).toContain('p."tipo"');
    });

    it("should throw when a padrones layout column is missing", () => {
      const layouts = ejesLayouts();
      delete layouts["ejes-padrones"].columns.type_padron;

      expect(() => buildEjesAnalysisSql(layouts)).toThrow(/type_padron/);
    });
  });

  describe("ET-2 twin group", () => {
    it("should read only staging rows with a non-empty geometry and an integer reftramo, grouped by the trimmed reftramo", () => {
      expect(sql).toContain("twin_raw");
      expect(sql).toContain("NULLIF(btrim(s.\"reftramo\"::text), '') AS ref");
      expect(sql).toContain('s."geom" IS NOT NULL AND NOT ST_IsEmpty(s."geom")');
      expect(sql).toMatch(/NULLIF\(btrim\(s\."reftramo"::text\), ''\) ~ '\^\[0-9\]\+\$'/);
      expect(sql).toContain('FROM "twin_raw" AS t GROUP BY t.ref');
    });

    it("should count the distinct non-null departments and localities of each group", () => {
      expect(sql).toContain("count(DISTINCT t.departamento) AS departments");
      expect(sql).toContain("count(DISTINCT t.localidad) AS locality_count");
    });

    it("should collect every locality of the group, sorted and without nulls", () => {
      expect(sql).toContain("array_agg(DISTINCT t.localidad ORDER BY t.localidad) FILTER (WHERE t.localidad IS NOT NULL) AS localities");
    });

    it("should measure only groups with exactly one department and at least two localities", () => {
      expect(sql).toContain('FROM "twin_groups" AS g WHERE g.departments = 1 AND g.locality_count >= 2');
    });

    it("should report the number of groups with more than one department as twins_cross_department", () => {
      expect(sql).toContain('(SELECT count(*) FROM "twin_groups" WHERE departments > 1) AS "twins_cross_department"');
    });
  });

  describe("ET-3 near lengths and class", () => {
    it("should take the distance and the minimum near length from the constants", () => {
      expect(TWIN_PADRON_DISTANCE_M).toBe(25);
      expect(TWIN_NEAR_MIN_LENGTH_M).toBe(1);
      expect(sql).toContain(`ST_DWithin(p."geometry", g.geom, ${TWIN_PADRON_DISTANCE_M})`);
      expect(sql).toContain(`ST_Buffer(p."geometry", ${TWIN_PADRON_DISTANCE_M})`);
      expect(sql).toContain(`m.urban_len >= ${TWIN_NEAR_MIN_LENGTH_M}`);
      expect(sql).toContain(`m.rural_len >= ${TWIN_NEAR_MIN_LENGTH_M}`);
    });

    it("should measure the length of the section inside the union of the buffers, 0 when no padron is near", () => {
      expect(sql).toContain(`ST_Length(ST_Intersection(g.geom, ST_Union(ST_Buffer(p."geometry", ${TWIN_PADRON_DISTANCE_M}))))`);
      expect(sql).toMatch(/COALESCE\(\(SELECT ST_Length\(ST_Intersection/);
      expect(sql).toContain("AS urban_len");
      expect(sql).toContain("AS rural_len");
    });

    it("should compare the padron type trimmed and in upper case with URBANO and RURAL", () => {
      expect(sql).toContain("upper(btrim(p.\"type_padron\"::text)) = 'URBANO'");
      expect(sql).toContain("upper(btrim(p.\"type_padron\"::text)) = 'RURAL'");
    });

    it("should classify BOTH first, then URBAN, then RURAL, and NEITHER otherwise", () => {
      const caseSql = sql.slice(sql.indexOf("SELECT m.*, CASE"));
      const order = ["'BOTH'", "'URBAN'", "'RURAL'", "'NEITHER'"].map((label) => caseSql.indexOf(label));

      expect(order.every((index) => index > 0)).toBe(true);
      expect([...order].sort((first, second) => first - second)).toEqual(order);
      expect(caseSql).toContain(
        `WHEN m.urban_len >= ${TWIN_NEAR_MIN_LENGTH_M} AND m.rural_len >= ${TWIN_NEAR_MIN_LENGTH_M} THEN 'BOTH' WHEN m.urban_len >= ${TWIN_NEAR_MIN_LENGTH_M} THEN 'URBAN' WHEN m.rural_len >= ${TWIN_NEAR_MIN_LENGTH_M} THEN 'RURAL' ELSE 'NEITHER' END AS class`
      );
      expect(caseSql).toContain("ELSE 'NEITHER' END AS class");
    });

    it("should decide near by an absolute length, with no ratio to the section length left in the twin CASE", () => {
      const caseSql = sql.slice(sql.indexOf("SELECT m.*, CASE"), sql.indexOf('FROM "twin_measured" AS m'));

      expect(caseSql).not.toContain("0.1 *");
      expect(caseSql).not.toContain("m.len");
    });
  });

  describe("ET-4 counts and list", () => {
    it.each(["twins", "twins_urban", "twins_rural", "twins_both", "twins_neither", "twins_cross_department"])(
      "should select count %s",
      (alias) => {
        expect(sql).toContain(`AS "${alias}"`);
      }
    );

    it("should count each class over the twins", () => {
      for (const twinClass of ["URBAN", "RURAL", "BOTH", "NEITHER"]) {
        expect(sql).toContain(`(SELECT count(*) FROM "twins" WHERE class = '${twinClass}') AS "twins_${twinClass.toLowerCase()}"`);
      }
      expect(sql).toContain('(SELECT count(*) FROM "twins" WHERE true) AS "twins"');
    });

    it("should select the twins list under its alias with the eight fields of a row", () => {
      expect(ANALYSIS_LIST_ALIAS.TWINS).toBe("twins_json");
      expect(sql).toContain(`AS "${ANALYSIS_LIST_ALIAS.TWINS}"`);
      for (const field of ["ref", "idcalle", "department", "localities", "class", "length", "urban_length", "rural_length"]) {
        expect(sql).toContain(`AS "${field}"`);
      }
    });

    it("should order NEITHER, BOTH, RURAL, URBAN and then by reftramo", () => {
      expect(sql).toContain("ORDER BY CASE t.class WHEN 'NEITHER' THEN 0 WHEN 'BOTH' THEN 1 WHEN 'RURAL' THEN 2 WHEN 'URBAN' THEN 3 END, t.ref");
    });

    it("should limit the twins list to DETAIL_LIST_LIMIT rows", () => {
      expect(sql).toContain(`THEN 3 END, t.ref LIMIT ${DETAIL_LIST_LIMIT}`);
    });

    it("should list a section once however many copies it has, because the list reads the groups, not the staging rows", () => {
      expect(sql).toContain('FROM "twins" AS t');
      expect(sql).not.toContain('FROM "twin_raw" AS t ORDER BY');
    });
  });

  describe("ET-18 invalid geometries", () => {
    const stgKeys = sql.slice(sql.indexOf('"stg_keys" AS ('), sql.indexOf('"stg" AS ('));
    const stg = sql.slice(sql.indexOf('"stg" AS ('), sql.indexOf(",\n", sql.indexOf('"stg" AS (')));

    it("should skip invalid geometries in stg, next to the null and empty conditions", () => {
      expect(stg).toContain('s."geom" IS NOT NULL AND NOT ST_IsEmpty(s."geom") AND COALESCE(ST_IsValid(s."geom"), true)');
    });

    it("should not filter stg_keys on validity or on geometry at all, so a reftramo with only invalid rows stays present", () => {
      expect(stgKeys).not.toContain("ST_IsValid");
      expect(stgKeys).not.toContain("ST_IsEmpty");
      expect(stgKeys).not.toContain("geom");
      expect(stgKeys).toContain("WHERE NULLIF(btrim(s.\"reftramo\"::text), '') IS NOT NULL");
    });

    it("should still compare the current sections with stg_keys when looking for removed ones", () => {
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "stg_keys" AS k WHERE k.ref = c.ref)');
    });

    it("should use the validity predicate in the twin analysis too", () => {
      const twinRaw = sql.slice(sql.indexOf('"twin_raw" AS ('), sql.indexOf('"twin_groups" AS ('));

      expect(twinRaw).toContain('COALESCE(ST_IsValid(s."geom"), true)');
    });
  });

  describe("ET-12 locality names", () => {
    it("should collect in inside_localities the distinct upper-cased trimmed names of the locality polygons the twin intersects, only for the class NEITHER", () => {
      expect(sql).toContain(
        `CASE WHEN k.class = 'NEITHER' THEN ARRAY(SELECT DISTINCT upper(btrim(l."nomloc"::text)) FROM "bdj_carto"."ine_localidades_pg" AS l WHERE l."nomloc" IS NOT NULL AND ST_Intersects(l."geom", k.geom)) ELSE ARRAY[]::text[] END AS inside_localities`
      );
    });

    it("should compute inside_localities in its own twin_located CTE after the classification and before the drop rule", () => {
      const classed = sql.indexOf('"twin_classed" AS (');
      const located = sql.indexOf('"twin_located" AS (');
      const twins = sql.indexOf('"twins" AS (');

      expect(classed).toBeGreaterThan(0);
      expect(located).toBeGreaterThan(classed);
      expect(twins).toBeGreaterThan(located);
      expect(sql.slice(located, twins)).toContain("AS inside_localities");
      expect(sql.slice(located, twins)).toContain('FROM "twin_classed" AS k');
    });

    it("should not touch the localities polygons while measuring or classifying", () => {
      const early = sql.slice(sql.indexOf('"twin_measured" AS ('), sql.indexOf('"twin_located" AS ('));

      expect(early).not.toContain("ine_localidades_pg");
      expect(early).not.toContain("ST_Intersects");
    });

    it("should carry the section geometry through twin_measured so the located step can intersect it", () => {
      const measured = sql.slice(sql.indexOf('"twin_measured" AS ('), sql.indexOf('"twin_classed" AS ('));

      expect(measured).toContain("g.geom");
    });

    it("should use the physical nomloc and geom names of the localities layout", () => {
      const layouts = ejesLayouts();
      layouts["ejes-localidades"] = { schema: "x", table: "loc2", columns: { cloc_iso: "c", nomloc: "nombre_loc", geom: "the_geom" } };

      const renamed = buildEjesAnalysisSql(layouts);

      expect(renamed).toContain('l."nombre_loc"');
      expect(renamed).toContain('ST_Intersects(l."the_geom", k.geom)');
    });

    it("should throw when the localities layout has no nomloc column", () => {
      const layouts = ejesLayouts();
      delete layouts["ejes-localidades"].columns.nomloc;

      expect(() => buildEjesAnalysisSql(layouts)).toThrow(/nomloc/);
    });
  });

  describe("ET-10 localities to drop", () => {
    const dropSql = sql.slice(sql.indexOf('"twins" AS ('), sql.indexOf('"twins" AS (') + 2500);
    const rural = (alias: string): string => `upper(btrim(${alias})) LIKE '%${RURAL_LOCALITY_SUFFIX}'`;

    it("should take the rural suffix from the constant", () => {
      expect(RURAL_LOCALITY_SUFFIX).toBe(" RURAL");
      expect(sql).toContain(rural("l"));
    });

    it("should drop the rural-named localities of an URBAN row only when the group has a non-rural-named one", () => {
      expect(dropSql).toContain(
        `WHEN c.class = 'URBAN' AND EXISTS (SELECT 1 FROM unnest(c.localities) AS h WHERE NOT ${rural("h")}) THEN ARRAY(SELECT l FROM unnest(c.localities) AS l WHERE ${rural("l")} ORDER BY l)`
      );
    });

    it("should drop from a RURAL row the non-rural-named localities and every rural-named one but the first by name, when it has a rural-named one", () => {
      expect(dropSql).toContain(
        `WHEN (c.class = 'RURAL' OR (c.class = 'NEITHER' AND cardinality(c.inside_localities) = 0)) AND EXISTS (SELECT 1 FROM unnest(c.localities) AS h WHERE ${rural("h")}) THEN ARRAY(SELECT l FROM unnest(c.localities) AS l`
      );
      expect(dropSql).toContain(
        `WHERE NOT ${rural("l")} OR l <> (SELECT min(r) FROM unnest(c.localities) AS r WHERE ${rural("r")}) ORDER BY l)`
      );
    });

    it("should give an empty array to every other class, so BOTH and NEITHER drop nothing", () => {
      expect(dropSql).toContain("ELSE ARRAY[]::text[] END AS drop_localities");
      expect(dropSql).not.toContain("c.class = 'BOTH'");
    });

    it("should treat a NEITHER row inside no locality polygon like a RURAL row", () => {
      expect(dropSql).toContain("(c.class = 'RURAL' OR (c.class = 'NEITHER' AND cardinality(c.inside_localities) = 0))");
    });

    it("should drop from a NEITHER row inside some locality the copies whose name is not among the inside ones, only if a copy is inside", () => {
      expect(dropSql).toContain(
        "WHEN c.class = 'NEITHER' AND NOT cardinality(c.inside_localities) = 0 AND EXISTS (SELECT 1 FROM unnest(c.localities) AS h WHERE upper(btrim(h)) = ANY(c.inside_localities))"
      );
      expect(dropSql).toContain(
        "THEN ARRAY(SELECT l FROM unnest(c.localities) AS l WHERE NOT upper(btrim(l)) = ANY(c.inside_localities) ORDER BY l)"
      );
    });

    it("should guard each branch so a drop list is never every locality of the group", () => {
      expect(dropSql.split("AND EXISTS (SELECT 1 FROM unnest(c.localities)")).toHaveLength(4);
    });

    it("should read the classed twins and select drop_localities in the list", () => {
      expect(dropSql).toContain('FROM "twin_located" AS c');
      expect(sql).toContain('t.drop_localities AS "drop_localities"');
    });

    it("should count twins_drop as the rows with a non-empty list and twins_keep as the rows with none", () => {
      expect(sql).toContain('(SELECT count(*) FROM "twins" WHERE cardinality(drop_localities) > 0) AS "twins_drop"');
      expect(sql).toContain('(SELECT count(*) FROM "twins" WHERE cardinality(drop_localities) = 0) AS "twins_keep"');
    });
  });

  describe("ET-5 bounded cost", () => {
    it("should filter the padrones by ST_DWithin on the padron geometry before measuring, never with a cross join", () => {
      expect(sql).toContain(
        `FROM "carto"."padron" AS p WHERE upper(btrim(p."type_padron"::text)) = 'URBANO' AND ST_DWithin(p."geometry", g.geom, ${TWIN_PADRON_DISTANCE_M})`
      );
      expect(sql).not.toMatch(/CROSS JOIN "carto"\."padron"/i);
      expect(sql).not.toMatch(/JOIN "carto"\."padron"/);
    });

    it("should stay a single read-only statement", () => {
      expect(sql).toMatch(/^WITH /);
      expect(sql.match(/\bSELECT\b/g)?.length).toBeGreaterThan(1);
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE|GRANT)\b/i);
    });
  });

  it("should throw when a layout column is missing", () => {
    const layouts = ejesLayouts();
    delete layouts["ejes-localidades"].columns.cloc_iso;

    expect(() => buildEjesAnalysisSql(layouts)).toThrow(/cloc_iso/);
  });
});
