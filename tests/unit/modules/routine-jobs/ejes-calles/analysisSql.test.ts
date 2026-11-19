import { describe, expect, it } from "vitest";
import {
  ANALYSIS_LIST_ALIAS,
  buildEjesAnalysisSql,
  comparableLineSql,
  coverageThresholdSql,
  geometriesDifferSql,
} from "@/modules/routine-jobs/jobs/ejes-calles/domain/analysisSql";
import {
  COVERAGE_TOLERANCE_M,
  GEOMETRY_TOLERANCE_M,
  PIECE_OWN_FRACTION,
  RURAL_LOCALITY_SUFFIX,
  SPLIT_PIECE_MIN_COVER_M,
  TWIN_NEAR_MIN_LENGTH_M,
  TWIN_PADRON_DISTANCE_M,
} from "@/modules/routine-jobs/jobs/ejes-calles/constants";
import { DETAIL_LIST_LIMIT } from "@/modules/routine-jobs/jobs/shared/limits";
import { ejesLayouts } from "./ejesFixtures";

const CANONICAL_REFTRAMO =
  "CASE WHEN NULLIF(btrim(s.\"reftramo\"::text), '') ~ '^[0-9]+$' THEN (NULLIF(btrim(s.\"reftramo\"::text), ''))::numeric::text ELSE NULLIF(btrim(s.\"reftramo\"::text), '') END";

const ACCESS_POINT_CANONICAL =
  "CASE WHEN NULLIF(btrim(a.\"id_road_section\"::text), '') ~ '^[0-9]+$' THEN (NULLIF(btrim(a.\"id_road_section\"::text), ''))::numeric::text ELSE NULLIF(btrim(a.\"id_road_section\"::text), '') END";

const positionOf = (text: string, fragment: string): number => {
  const index = text.indexOf(fragment);
  expect(index, `missing ${fragment}`).toBeGreaterThanOrEqual(0);
  return index;
};

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
      expect(sql).toContain("ST_Buffer(ST_Collect(p.geom), 1)");
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
      expect(sql).toContain("ORDER BY COALESCE(ap.points, 0) + COALESCE(apid.points, 0) DESC, p.ref");
      expect(sql).toContain('AS "plain_held"');
    });

    it("should describe each new street with its departments, localities and type", () => {
      for (const alias of ["tipos", "departments", "localities"]) expect(sql).toContain(`AS "${alias}"`);
      expect(sql).toContain("string_agg(DISTINCT c.localidad");
    });

    it("should measure the old length, the new length and the new length outside the old section of splits and merges", () => {
      for (const alias of ["old_length", "new_length", "outside_length"]) expect(sql).toContain(`AS "${alias}"`);
      expect(sql).toContain("ST_Difference(ST_Union(p.geom)");
      expect(sql).toContain("ST_Difference((array_agg(p.new_geom))[1]");
    });

    it("should report access points of each removed section", () => {
      expect(sql).toContain('LEFT JOIN "ap" AS ap ON ap.ref = s.ref');
      expect(sql).toContain("count(*) AS points");
      expect(sql).toContain('AS "points"');
    });
  });

  describe("EJ-10 touching neighbours and id-linked points (SPLIT_PIECE_MIN_COVER_M, PIECE_OWN_FRACTION, EJ-21)", () => {
    it("should set the minimum cover of a split piece or a merge member to 10 m, and its own-length share to 50%", () => {
      expect(COVERAGE_TOLERANCE_M).toBe(1);
      expect(SPLIT_PIECE_MIN_COVER_M).toBe(10);
      expect(PIECE_OWN_FRACTION).toBe(0.5);
    });

    it("should measure the cover of each neighbour piece in piece_cover, one row per (removed section, new section)", () => {
      const pieceCover = sql.slice(sql.indexOf('"piece_cover" AS ('), sql.indexOf('"removed_cover" AS ('));

      expect(pieceCover).toContain("ST_Length(ST_Intersection(r.geometry, ST_Buffer(n.geom, 1))) AS piece_covered");
      expect(pieceCover).toContain('FROM "removed_rest" AS r JOIN "new_rest" AS n ON n.idcalle = r.idcalle AND ST_DWithin(r.geometry, n.geom, 1)');
      expect(pieceCover).not.toContain("GROUP BY");
    });

    it("should count only the pieces that absorb 95% of the old section or cover more than 10 m and half their own length in removed_cover", () => {
      const removedCover = sql.slice(sql.indexOf('"removed_cover" AS ('), sql.indexOf('"splits" AS ('));

      expect(removedCover).toContain(
        'FROM "piece_cover" AS p WHERE (p.piece_covered >= 0.95 * p.len OR (p.piece_covered > 10 AND p.piece_covered >= 0.5 * p.piece_len))'
      );
      expect(removedCover).toContain("count(p.new_ref) AS new_count");
      expect(removedCover).toContain("ST_Length(ST_Intersection(p.geometry, ST_Buffer(ST_Collect(p.geom), 1))) AS covered");
      expect(sql).not.toMatch(/piece_covered >= 2\b/);
    });

    it("should take a merge member only when it absorbs 95% of the old section or covers more than 10 m and half its own length, in the merge sums and in merged_ids", () => {
      const mergeBlock = sql.slice(sql.indexOf('"merge_pairs" AS ('), sql.indexOf('"plain" AS ('));

      expect(mergeBlock).toContain(
        "WHERE (p.covered >= 0.95 * p.len OR (p.covered > 10 AND p.covered >= 0.5 * p.piece_len)) GROUP BY p.new_ref HAVING count(*) >= 2 AND sum(p.covered) >= 0.95 * sum(p.len)"
      );
      expect(mergeBlock).toContain(
        'JOIN "merges" AS m ON m.new_ref = p.new_ref WHERE (p.covered >= 0.95 * p.len OR (p.covered > 10 AND p.covered >= 0.5 * p.piece_len))'
      );
      expect(sql).not.toContain("covered > 0");
    });

    it("should add the points matched by road_section.id to the points of a split, from the split list", () => {
      expect(sql).toContain('COALESCE(ap.points, 0) + COALESCE(apid.points, 0) AS "points",');
      expect(sql).toContain('s.covered / NULLIF(s.len, 0) AS "coverage"');
      expect(sql).toContain('LEFT JOIN "ap" AS apid ON apid.ref = s.id::text');
      expect(sql).toContain("ORDER BY s.ref");
    });

    it("should add the points matched by road_section.id to the points of a merge, summed over its members", () => {
      expect(sql).toContain('COALESCE(sum(ap.points), 0) + COALESCE(sum(apid.points), 0) AS points FROM "merge_pairs" AS p');
      expect(sql).toContain(
        'LEFT JOIN "ap" AS apid ON apid.ref = p.id::text WHERE (p.covered >= 0.95 * p.len OR (p.covered > 10 AND p.covered >= 0.5 * p.piece_len))'
      );
    });

    it("should add the points matched by road_section.id to the points of a plain removal and sort the list by both", () => {
      expect(sql).toContain('COALESCE(ap.points, 0) + COALESCE(apid.points, 0) AS "points" FROM "plain" AS p');
      expect(sql).toContain('LEFT JOIN "ap" AS apid ON apid.ref = p.id::text ORDER BY COALESCE(ap.points, 0) + COALESCE(apid.points, 0) DESC, p.ref');
    });

    it("should count a plain removal as held when either its reftramo or its road_section.id has points", () => {
      expect(sql).toContain(
        '(SELECT count(*) FROM "plain" AS p WHERE EXISTS (SELECT 1 FROM "ap" AS ap WHERE ap.ref = p.ref AND ap.points > 0) OR EXISTS (SELECT 1 FROM "ap" AS apid WHERE apid.ref = p.id::text AND apid.points > 0)) AS "plain_held"'
      );
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

    it("should compute it only for NEW and GEOM sections, leaving out the NEW reftramos held by a skipped renumber or a split or merge group (EJL-12)", () => {
      expect(sql).toContain('WHERE (c.is_new AND c.ref NOT IN (SELECT new_ref FROM "renum_skipped") AND c.ref NOT IN (SELECT ref FROM "group_pieces")) OR c.geom_changed');
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
    it("should read only staging rows with a non-empty geometry and an integer reftramo, grouped by the canonical reftramo (EJL-19)", () => {
      expect(sql).toContain("twin_raw");
      expect(sql).toContain(`${CANONICAL_REFTRAMO} AS ref,`);
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

    it("should choose the department of each multi-department reftramo before grouping, and group only the copies of that department (ET-2a)", () => {
      expect(positionOf(sql, '"twin_dept" AS (')).toBeLessThan(positionOf(sql, '"twin_groups" AS ('));
      expect(sql).toContain('LEFT JOIN "twin_dept" AS d ON d.ref = t.ref');
      expect(sql).toContain("WHERE (d.department IS NULL OR t.departamento IS NULL OR upper(btrim(t.departamento)) = d.department) GROUP BY t.ref");
    });

    it("should pick the department whose polygon the section overlaps most, the lowest name on a tie, and none when no polygon intersects (ET-2a)", () => {
      expect(sql).toContain('FROM "carto"."mv_country_province" AS dp WHERE dp."name_dpto" IS NOT NULL AND ST_Intersects(dp."geometry", m.geom) GROUP BY 1) AS d');
      expect(sql).toContain("ORDER BY d.len DESC, d.name LIMIT 1) AS department");
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
    const stgKeys = sql.slice(sql.indexOf('"stg_keys" AS ('), sql.indexOf(",\n", sql.indexOf('"stg_keys" AS (')));
    const stg = sql.slice(sql.indexOf('"stg" AS ('), sql.indexOf(",\n", sql.indexOf('"stg" AS (')));

    it("should skip invalid and short geometries in stg, next to the null and empty conditions", () => {
      expect(stg).toContain(
        `s."geom" IS NOT NULL AND NOT ST_IsEmpty(s."geom") AND COALESCE(ST_IsEmpty(s."geom") OR (ST_IsValid(s."geom") AND ST_Length(s."geom") >= 0.001 AND (CASE WHEN ST_Length(s."geom") >= 1 THEN true ELSE EXISTS (SELECT 1 FROM "carto"."access_point" AS a WHERE ${ACCESS_POINT_CANONICAL} = ${CANONICAL_REFTRAMO}) END)), true) AND ${CANONICAL_REFTRAMO} ~ '^[0-9]+$'`
      );
    });

    it("should read stg_keys from the kept rows only, so a reftramo whose rows are all discarded is not present", () => {
      expect(stgKeys).toContain(`AS ref FROM "bdj_carto"."ide_ejesviacirculacion" AS s WHERE s."geom" IS NOT NULL AND NOT ST_IsEmpty(s."geom") AND COALESCE(`);
      expect(stgKeys).toContain("ST_IsValid(s.\"geom\")");
      expect(stgKeys).toContain(`${CANONICAL_REFTRAMO} ~ '^[0-9]+$'`);
    });

    it("should still compare the current sections with stg_keys when looking for removed ones", () => {
      expect(sql).toContain('NOT EXISTS (SELECT 1 FROM "stg_keys" AS k WHERE k.ref = c.ref)');
    });

    it("should use the validity predicate in the twin analysis too", () => {
      const twinRaw = sql.slice(sql.indexOf('"twin_raw" AS ('), sql.indexOf('"twin_groups" AS ('));

      expect(twinRaw).toContain(
        `COALESCE(ST_IsEmpty(s."geom") OR (ST_IsValid(s."geom") AND ST_Length(s."geom") >= 0.001 AND (CASE WHEN ST_Length(s."geom") >= 1 THEN true ELSE EXISTS (SELECT 1 FROM "carto"."access_point" AS a WHERE ${ACCESS_POINT_CANONICAL} = ${CANONICAL_REFTRAMO}) END)), true)`
      );
    });
  });

  describe("ET-12 locality names", () => {
    it("should collect in inside_localities the distinct upper-cased trimmed names of the locality polygons the twin intersects, ordered by overlap length descending then name, for every class", () => {
      expect(sql).toContain(
        `SELECT COALESCE(array_agg(t.n ORDER BY t.len DESC, t.n), ARRAY[]::text[]) AS inside_localities, COALESCE(max(t.len), 0) AS inside_len FROM (SELECT upper(btrim(l."nomloc"::text)) AS n, sum(ST_Length(ST_Intersection(k.geom, ST_MakeValid(l."geom")))) AS len FROM "bdj_carto"."ine_localidades_pg" AS l WHERE l."nomloc" IS NOT NULL AND ST_Intersects(l."geom", k.geom) GROUP BY 1) AS t`
      );
      expect(sql).not.toContain("k.class IN ('NEITHER', 'BOTH')");
    });

    it("should compute inside_localities in its own twin_located CTE after the classification and before the drop rule", () => {
      const classed = sql.indexOf('"twin_classed" AS (');
      const located = sql.indexOf('"twin_located" AS (');
      const twins = sql.indexOf('"twins" AS (');

      expect(classed).toBeGreaterThan(0);
      expect(located).toBeGreaterThan(classed);
      expect(twins).toBeGreaterThan(located);
      expect(sql.slice(located, twins)).toContain("AS inside_localities");
      expect(sql.slice(located, twins)).toContain('FROM "twin_classed" AS k CROSS JOIN LATERAL (');
      expect(sql.slice(located, twins)).toContain("AS inside_cover");
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
    const dropSql = sql.slice(sql.indexOf('"twins" AS ('), sql.indexOf('"copy_raw" AS ('));
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

    it("should keep one copy of a BOTH row: drop every copy but the winner, the rural copy of its department when the section lies mostly outside the polygons, else the highest-ranked inside its polygons by overlap, else the non-rural-named, else the first by name", () => {
      expect(dropSql).toContain(
        "WHEN c.class = 'BOTH' THEN ARRAY(SELECT l FROM unnest(c.localities) AS l WHERE l <> (CASE WHEN c.inside_cover < 0.5 AND EXISTS (SELECT 1 FROM unnest(c.localities) AS h WHERE upper(btrim(h)) LIKE '% RURAL') THEN (SELECT r FROM unnest(c.localities) AS r WHERE upper(btrim(r)) LIKE '% RURAL' ORDER BY COALESCE(upper(btrim(r)) = (upper(btrim(c.department)) || ' RURAL'), false) DESC, r ASC LIMIT 1) ELSE (SELECT r FROM unnest(c.localities) AS r ORDER BY array_position(c.inside_localities, upper(btrim(r))) ASC NULLS LAST, (upper(btrim(r)) LIKE '% RURAL') ASC, r ASC LIMIT 1) END) ORDER BY l)"
      );
    });

    it("should give an empty base to every other class, so a NEITHER row with nothing inside and no rural-named copy drops nothing", () => {
      expect(dropSql).toContain("ELSE ARRAY[]::text[] END AS base) AS twin_drop_base,");
      expect(dropSql).toContain("ELSE twin_drop_base.base END");
    });

    it("should apply the single-copy step only when more than one copy remains and one remaining copy is inside, or the section lies mostly outside with a rural-named copy remaining", () => {
      expect(dropSql).toContain(
        "(SELECT CASE WHEN cardinality(twin_drop_rest.remaining) > 1 AND (EXISTS (SELECT 1 FROM unnest(twin_drop_rest.remaining) AS h WHERE upper(btrim(h)) = ANY(c.inside_localities)) OR (c.inside_cover < 0.5 AND EXISTS (SELECT 1 FROM unnest(twin_drop_rest.remaining) AS h WHERE upper(btrim(h)) LIKE '% RURAL')))"
      );
    });

    it("should keep the rural copy of the department among the remaining ones when the section lies mostly outside, the highest-ranked inside copy otherwise, and drop every other remaining copy", () => {
      expect(dropSql).toContain(
        "THEN ARRAY(SELECT l FROM unnest(c.localities) AS l WHERE l = ANY(twin_drop_base.base) OR l <> (CASE WHEN (c.inside_cover < 0.5 AND EXISTS (SELECT 1 FROM unnest(twin_drop_rest.remaining) AS h WHERE upper(btrim(h)) LIKE '% RURAL')) THEN (SELECT r FROM unnest(twin_drop_rest.remaining) AS r WHERE upper(btrim(r)) LIKE '% RURAL' ORDER BY COALESCE(upper(btrim(r)) = (upper(btrim(c.department)) || ' RURAL'), false) DESC, r ASC LIMIT 1) ELSE (SELECT r FROM unnest(twin_drop_rest.remaining) AS r ORDER BY array_position(c.inside_localities, upper(btrim(r))) ASC NULLS LAST, (upper(btrim(r)) LIKE '% RURAL') ASC, r ASC LIMIT 1) END) ORDER BY l) ELSE twin_drop_base.base END"
      );
    });

    it("should compute the remaining copies as the localities not in the base drop, for the single-copy step", () => {
      expect(dropSql).toContain(
        "LATERAL (SELECT ARRAY(SELECT l FROM unnest(c.localities) AS l WHERE NOT l = ANY(twin_drop_base.base)) AS remaining) AS twin_drop_rest) AS drop_localities"
      );
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
      expect(dropSql.split("AND EXISTS (SELECT 1 FROM unnest(c.localities)")).toHaveLength(5);
    });

    it("should read the classed twins and select drop_localities in the list", () => {
      expect(dropSql).toContain('FROM "twin_located" AS c');
      expect(sql).toContain('t.drop_localities AS "drop_localities"');
      expect(sql).toContain('t.inside_localities AS "inside_localities"');
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

const canonicalOf = (column: string): string => {
  const text = `NULLIF(btrim(${column}::text), '')`;
  return `CASE WHEN ${text} ~ '^[0-9]+$' THEN (${text})::numeric::text ELSE ${text} END`;
};

describe("buildEjesAnalysisSql real-run analysis (EJL-12, EJL-17, EJL-19, EJL-20, EJL-23)", () => {
  const SINKS = {
    renumbered: 'pg_temp."ej_renum"',
    skipped: 'pg_temp."ej_held"',
    merged: 'pg_temp."ej_merge"',
    plain: 'pg_temp."ej_plain"',
    split: 'pg_temp."ej_split"',
    splitPoints: 'pg_temp."ej_split_pts"',
    geoTwins: 'pg_temp."ej_geo_twins"',
  };
  const sql = buildEjesAnalysisSql(ejesLayouts());
  const withSinks = buildEjesAnalysisSql(ejesLayouts(), SINKS);

  describe("CTE order: twins, then the kept copies, then the renumber (EJL-23)", () => {
    it("should define twins before copy_raw, copy_kept and copy_refs, and those before the renumber candidates", () => {
      const order = [
        '"twins" AS (',
        '"copy_raw" AS (',
        '"twin_picks" AS (',
        '"copy_kept" AS (',
        '"copy_refs" AS (',
        '"renum_cand" AS (',
        '"renum_status" AS (',
        '"renumbered" AS (',
        '"renum_skipped" AS (',
        '"removed_rest" AS (',
        '"new_rest" AS (',
        '"splits" AS (',
      ].map((fragment) => positionOf(sql, fragment));

      expect([...order].sort((first, second) => first - second)).toEqual(order);
    });

    it("should build copy_raw one row per kept copy of reftramo, localidad and departamento, with canonical reftramo and idcalle", () => {
      expect(sql).toContain(
        `"copy_raw" AS (SELECT DISTINCT ON (raw.ref, raw.localidad, raw.departamento) raw.* FROM (SELECT ${CANONICAL_REFTRAMO} AS ref, ${canonicalOf('s."idcalle"')} AS idcalle,`
      );
    });

    it("should keep a copy of the chosen department unless the twin rules drop its locality, and keep only the picked copy of a picked reftramo naming a copy (copy_kept reads the twins, the twin department and the picks)", () => {
      expect(sql).toContain(
        '"copy_kept" AS (SELECT r.* FROM "copy_raw" AS r LEFT JOIN "twins" AS w ON w.ref = r.ref LEFT JOIN "twin_dept" AS d ON d.ref = r.ref WHERE (NOT EXISTS (SELECT 1 FROM "twin_picks" AS p JOIN "copy_raw" AS x ON p.ref = x.ref AND p.department = x.departamento AND p.locality = x.localidad WHERE p.ref = r.ref) AND (d.department IS NULL OR r.departamento IS NULL OR upper(btrim(r.departamento)) = d.department) AND (w.ref IS NULL OR r.localidad IS NULL OR NOT (r.localidad = ANY (w.drop_localities)))) OR EXISTS (SELECT 1 FROM "twin_picks" AS p WHERE p.ref = r.ref AND p.department = r.departamento AND p.locality = r.localidad))'
      );
    });

    it("should count the kept copies per reftramo with one GROUP BY, the count the renumber reads", () => {
      expect(sql).toContain('"copy_refs" AS (SELECT k.ref, count(*) AS copies FROM "copy_final" AS k GROUP BY k.ref)');
      expect(sql).toContain('LEFT JOIN "copy_refs" AS kc ON kc.ref = c.new_ref');
      expect(sql).not.toMatch(/SELECT count\(\*\) FROM "copy_kept" AS k WHERE k\.ref = c\.new_ref/);
    });
  });

  describe("sinks for the real run (EJL-23)", () => {
    it("should write the renumbered pairs into the sink table by a data-modifying CTE", () => {
      expect(withSinks).toContain(
        'INSERT INTO pg_temp."ej_renum" (old_id, old_ref, new_ref, points) SELECT r.old_id, r.old_ref, r.new_ref, r.points FROM "renumbered" AS r RETURNING 1'
      );
    });

    it("should write the skipped pairs into the second sink table by a data-modifying CTE", () => {
      expect(withSinks).toContain(
        'INSERT INTO pg_temp."ej_held" (old_id, old_ref, new_ref, idcalle, points, reason) SELECT r.old_id, r.old_ref, r.new_ref, r.idcalle, r.points, r.reason FROM "renum_skipped" AS r RETURNING 1'
      );
    });

    it("should run the sinks right after the renumber, before the splits", () => {
      expect(positionOf(withSinks, '"renum_sink" AS (')).toBeGreaterThan(positionOf(withSinks, '"renum_skipped" AS ('));
      expect(positionOf(withSinks, '"held_sink" AS (')).toBeGreaterThan(positionOf(withSinks, '"renum_sink" AS ('));
      expect(positionOf(withSinks, '"splits" AS (')).toBeGreaterThan(positionOf(withSinks, '"held_sink" AS ('));
    });

    it("should write nothing when no sinks are given, so the dry run stays read-only", () => {
      expect(sql).not.toMatch(/\bINSERT\b/);
      expect(sql).not.toContain("RETURNING 1");
    });

    it("should write only the six sink tables, and read the counts from the CTEs, not from the sinks", () => {
      expect(withSinks.match(/\bINSERT INTO\b/g)).toHaveLength(7);
      expect(withSinks).toContain('AS "renumbered"');
      expect(withSinks).not.toMatch(/FROM pg_temp\."ej_renum"/);
    });
  });

  describe("removed sections of the real run: members and their points (EJ-10, EJ-21, EJS-1)", () => {
    const mergeMembers = withSinks.slice(withSinks.indexOf('"merge_members" AS ('), withSinks.indexOf('"plain_members" AS ('));
    const plainMembers = withSinks.slice(withSinks.indexOf('"plain_members" AS ('), withSinks.indexOf('"merge_sink" AS ('));
    const splitMembers = withSinks.slice(withSinks.indexOf('"split_members" AS ('), withSinks.indexOf('"group_pieces" AS ('));

    it("should take a merge member only when it absorbs 95% of the old section or covers more than 10 m and half its own length, and record its reftramo and road_section.id points apart", () => {
      expect(mergeMembers).toContain("WHERE (p.covered >= 0.95 * p.len OR (p.covered > 10 AND p.covered >= 0.5 * p.piece_len))");
      expect(mergeMembers).toContain("COALESCE(ap.points, 0) AS points, COALESCE(apid.points, 0) AS id_points");
      expect(mergeMembers).toContain("LEFT JOIN \"ap\" AS apid ON apid.ref = p.id::text");
      expect(mergeMembers).not.toContain("covered > 0");
    });

    it("should count a plain member's points as its reftramo points plus its road_section.id points", () => {
      expect(plainMembers).toContain("COALESCE(ap.points, 0) + COALESCE(apid.points, 0) AS points");
      expect(plainMembers).toContain("LEFT JOIN \"ap\" AS apid ON apid.ref = p.id::text");
    });

    it("should count a split member's points as its reftramo points plus its road_section.id points", () => {
      expect(splitMembers).toContain("COALESCE(ap.points, 0) + COALESCE(apid.points, 0) AS points");
      expect(splitMembers).toContain("LEFT JOIN \"ap\" AS apid ON apid.ref = s.id::text");
    });

    it("should write the id points of every merge member to the merge sink, next to its reftramo points", () => {
      expect(withSinks).toContain(
        'INSERT INTO pg_temp."ej_merge" (new_ref, idcalle, old_id, old_ref, points, id_points, old_rows) SELECT m.new_ref, m.idcalle, m.old_id, m.old_ref, m.points, m.id_points, m.old_rows FROM "merge_members" AS m RETURNING 1'
      );
    });
  });

  describe("held renumber pairs (EJL-12)", () => {
    it("should leave a held old section out of the removed count and out of the removed rest", () => {
      expect(sql).toContain('WHERE id NOT IN (SELECT old_id FROM "renum_skipped")) AS "removed"');
      expect(sql).toContain('"removed_rest" AS (SELECT r.* FROM "removed" AS r WHERE r.id NOT IN (SELECT old_id FROM "renumbered") AND r.id NOT IN (SELECT old_id FROM "renum_skipped"))');
    });

    it("should leave a held new reftramo out of the new section count, the new streets and the new rest", () => {
      expect(sql).toContain('WHERE is_new AND ref NOT IN (SELECT new_ref FROM "renum_skipped") AND ref NOT IN (SELECT ref FROM "group_pieces")) AS "new_sections"');
      expect(sql).toContain('FROM "classified" AS c WHERE c.is_new AND c.ref NOT IN (SELECT new_ref FROM "renum_skipped") AND c.ref NOT IN (SELECT ref FROM "group_pieces") AND NOT EXISTS');
      expect(sql).toContain('"new_rest" AS (SELECT n.* FROM "new_sections" AS n WHERE n.ref NOT IN (SELECT new_ref FROM "renumbered") AND n.ref NOT IN (SELECT new_ref FROM "renum_skipped"))');
    });
  });

  describe("canonical references (EJL-19)", () => {
    it("should compare the access point reference in canonical form", () => {
      expect(sql).toContain(`${canonicalOf('a."id_road_section"')} AS ref, count(*) AS points FROM "carto"."access_point" AS a`);
    });

    it("should compare the section reference, idcalle and the circulation way idcalle in canonical form", () => {
      expect(sql).toContain(`${canonicalOf('r."reftramo_ideuy"')} AS ref,`);
      expect(sql).toContain(`${canonicalOf('r."id_circulation_way"')} AS idcalle,`);
      expect(sql).toContain(`${canonicalOf('w."id_calle"')} AS idcalle, `);
    });

    it("should read the staging row used for classification by its full content, so the choice is deterministic", () => {
      expect(sql).toContain(
        "ORDER BY raw.ref, raw.idcalle, raw.nombre, raw.tipo, raw.fuente, raw.departamento, raw.localidad, ST_AsEWKB(raw.geom)"
      );
    });
  });

  describe("staging fingerprint (EJL-20)", () => {
    it("should select the row count and the digest of the staging as the summary columns", () => {
      expect(sql).toContain('(SELECT row_count FROM "staging_fp") AS "staging_rows"');
      expect(sql).toContain('(SELECT digest FROM "staging_fp") AS "staging_digest"');
    });

    it("should count every staging row, not only the ones the analysis reads", () => {
      expect(sql).toContain('SELECT count(*) AS row_count, COALESCE(md5(string_agg(f.digest, \'\' ORDER BY f.digest)), \'\') AS digest');
      expect(sql).toContain('FROM (SELECT md5(concat_ws(\',\', ') ;
      expect(sql).toContain('FROM "bdj_carto"."ide_ejesviacirculacion" AS s) AS f');
    });

    it.each(["reftramo", "idcalle", "nombre", "tipo_vialidad", "fuente", "departamento", "localidad"])(
      "should digest the %s field with NULLs distinguished",
      (field) => {
        expect(sql).toContain(`quote_nullable(s."${field}"::text)`);
      }
    );

    it("should digest the geometry by the md5 of its EWKB, NULLs distinguished", () => {
      expect(sql).toContain('quote_nullable(md5(ST_AsEWKB(s."geom")))');
    });
  });
});
