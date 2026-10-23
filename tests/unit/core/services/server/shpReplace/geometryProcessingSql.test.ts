import { describe, it, expect } from "vitest";
import {
  AreaMode,
  BASE_TABLE,
  OVERLAP_TABLE,
  UNIFIED_TABLE,
  buildBaseTableSql,
  buildConflictCountSql,
  buildConflictSamplesSql,
  buildGroupStatsSql,
  buildIncompatibleGeometryCountSql,
  buildInvalidCountSql,
  buildLargestGroupsSql,
  buildNullKeyCountSql,
  buildOverlapCountSql,
  buildOverlapInputSql,
  buildOverlapSamplesSql,
  buildRepairSql,
  buildUnifySql,
  type ProcessingLayout,
} from "@/core/services/server/shpReplace/geometryProcessingSql";

const compact = (sql: string): string => sql.replace(/\s+/g, "");

const layoutOf = (overrides: Partial<ProcessingLayout> = {}): ProcessingLayout => ({
  stageFields: ["c0", "c1", "c2"],
  keyFields: ["c0"],
  sourceSrid: 25830,
  ...overrides,
});

const hostileSql = 'c0"; DROP TABLE shp_replace_stage; --';

describe("geometryProcessingSql", () => {
  describe("table name constants", () => {
    it("should name the base work table shp_proc_base", () => {
      expect(BASE_TABLE).toBe("shp_proc_base");
    });

    it("should name the unified work table shp_proc_unified", () => {
      expect(UNIFIED_TABLE).toBe("shp_proc_unified");
    });

    it("should name the overlap work table shp_proc_overlap", () => {
      expect(OVERLAP_TABLE).toBe("shp_proc_overlap");
    });
  });

  describe("AreaMode", () => {
    it("should expose planar and geography modes with their literal values", () => {
      expect(AreaMode).toEqual({ PLANAR: "planar", GEOGRAPHY: "geography" });
    });
  });

  describe("buildBaseTableSql", () => {
    it("should build the base table from the stage with rec, field columns and a SRID-tagged geometry", () => {
      const sql = buildBaseTableSql(layoutOf({ stageFields: ["c0", "c1"], sourceSrid: 25830 }));

      expect(compact(sql)).toBe(
        compact(
          `CREATE TEMP TABLE "shp_proc_base" ON COMMIT DROP AS
           SELECT "rec", "c0", "c1", ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",'')), 25830) AS "geom"
           FROM "shp_replace_stage"`
        )
      );
    });

    it("should select only rec and the geometry when there are no stage fields", () => {
      const sql = buildBaseTableSql(layoutOf({ stageFields: [], keyFields: [], sourceSrid: 4326 }));

      expect(compact(sql)).toBe(
        compact(
          `CREATE TEMP TABLE "shp_proc_base" ON COMMIT DROP AS
           SELECT "rec", ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",'')), 4326) AS "geom"
           FROM "shp_replace_stage"`
        )
      );
    });

    it("should quote a stage field name containing a double quote", () => {
      const sql = buildBaseTableSql(layoutOf({ stageFields: ['c"0'], keyFields: [] }));

      expect(sql).toContain('"c""0"');
    });

    it("should embed the source SRID as a bare integer literal", () => {
      const sql = buildBaseTableSql(layoutOf({ sourceSrid: 32721 }));

      expect(compact(sql)).toContain(compact(", 32721) AS \"geom\""));
    });

    it.each([
      ["an injection string", "25830; DROP TABLE spatial_ref_sys"],
      ["a numeric string", "25830"],
      ["a closing parenthesis", "25830)"],
    ])("should throw when the source SRID is %s", (_label, sourceSrid) => {
      expect(() => buildBaseTableSql(layoutOf({ sourceSrid: sourceSrid as unknown as number }))).toThrow(Error);
    });

    it.each([
      ["zero", 0],
      ["negative", -1],
      ["fractional", 4326.5],
      ["NaN", Number.NaN],
      ["above the SRID upper bound", 999000],
    ])("should throw when the source SRID is %s", (_label, sourceSrid) => {
      expect(() => buildBaseTableSql(layoutOf({ sourceSrid }))).toThrow(Error);
    });
  });

  describe("buildIncompatibleGeometryCountSql", () => {
    it("should count the non-null multi-part geometries of the given work table as one incompatible column", () => {
      const sql = buildIncompatibleGeometryCountSql(UNIFIED_TABLE);

      expect(compact(sql)).toBe(
        compact(
          `SELECT count(*) AS incompatible FROM "shp_proc_unified"
           WHERE "geom" IS NOT NULL AND GeometryType("geom") LIKE 'MULTI%'`
        )
      );
    });

    it("should select from the table it is given rather than the base table", () => {
      const sql = buildIncompatibleGeometryCountSql(BASE_TABLE);

      expect(sql).toContain('FROM "shp_proc_base"');
      expect(sql).not.toContain("shp_proc_unified");
    });

    it("should never count NULL geometries as incompatible", () => {
      const sql = buildIncompatibleGeometryCountSql(BASE_TABLE);

      expect(compact(sql)).toContain('"geom"ISNOTNULL');
      expect(compact(sql)).not.toMatch(/"geom"ISNULLOR/);
    });

    it("should quote a work table name containing a double quote", () => {
      expect(buildIncompatibleGeometryCountSql('odd"name')).toContain('FROM "odd""name"');
    });

    it("should quote a hostile work table name as a single escaped identifier", () => {
      expect(buildIncompatibleGeometryCountSql(hostileSql)).toContain('FROM "c0""; DROP TABLE shp_replace_stage; --"');
    });
  });

  describe("buildInvalidCountSql", () => {
    it("should count as invalid only the non-null geometries that fail ST_IsValid in the given work table", () => {
      const sql = buildInvalidCountSql(BASE_TABLE);

      expect(sql.trimStart().toUpperCase().startsWith("SELECT")).toBe(true);
      expect(sql).toContain('FROM "shp_proc_base"');
      expect(compact(sql)).toContain('"geom"ISNOTNULLANDNOTST_IsValid("geom")');
    });

    it("should never count NULL geometries as invalid", () => {
      const sql = buildInvalidCountSql(BASE_TABLE);

      expect(compact(sql)).not.toMatch(/"geom"ISNULLOR/);
      expect(compact(sql)).not.toMatch(/ISNULLORNOTST_IsValid/);
    });

    it("should count NULL geometries in a separate nulls column", () => {
      const sql = buildInvalidCountSql(BASE_TABLE);

      expect(compact(sql)).toMatch(/"geom"ISNULL/);
      expect(compact(sql)).toMatch(/AS"?nulls"?/i);
    });

    it("should not reference the stage table", () => {
      expect(buildInvalidCountSql(BASE_TABLE)).not.toContain("shp_replace_stage");
    });

    it("should quote a work table name containing a double quote", () => {
      expect(buildInvalidCountSql('odd"name')).toContain('FROM "odd""name"');
    });
  });

  describe("buildUnifySql", () => {
    it("should collapse each key group into one row with min rec, first-row attributes and a collected MultiPolygon", () => {
      const sql = buildUnifySql(layoutOf({ stageFields: ["c0", "c1", "c2"], keyFields: ["c0"] }));

      expect(compact(sql)).toBe(
        compact(
          `CREATE TEMP TABLE "shp_proc_unified" ON COMMIT DROP AS
           SELECT min("rec") AS "rec", "c0", (array_agg("c1" ORDER BY "rec"))[1] AS "c1",
                  (array_agg("c2" ORDER BY "rec"))[1] AS "c2",
                  ST_Multi(ST_CollectionExtract(ST_Collect("geom"), 3)) AS "geom"
           FROM "shp_proc_base" GROUP BY "c0", CASE WHEN "c0" IS NULL THEN "rec" END`
        )
      );
    });

    it("should group by every key column when several key fields are given", () => {
      const sql = buildUnifySql(layoutOf({ stageFields: ["c0", "c1", "c2"], keyFields: ["c0", "c2"] }));

      expect(compact(sql)).toBe(
        compact(
          `CREATE TEMP TABLE "shp_proc_unified" ON COMMIT DROP AS
           SELECT min("rec") AS "rec", "c0", (array_agg("c1" ORDER BY "rec"))[1] AS "c1", "c2",
                  ST_Multi(ST_CollectionExtract(ST_Collect("geom"), 3)) AS "geom"
           FROM "shp_proc_base" GROUP BY "c0", "c2", CASE WHEN "c0" IS NULL OR "c2" IS NULL THEN "rec" END`
        )
      );
    });

    it("should keep a row with a NULL key as its own group by grouping it on its record number", () => {
      const sql = buildUnifySql(layoutOf({ keyFields: ["c0"] }));

      expect(compact(sql)).toContain(compact('GROUP BY "c0", CASE WHEN "c0" IS NULL THEN "rec" END'));
    });

    it("should keep a row with any NULL key among several key fields as its own group", () => {
      const sql = buildUnifySql(layoutOf({ keyFields: ["c0", "c2"] }));

      expect(compact(sql)).toContain(compact('GROUP BY "c0", "c2"'));
      expect(compact(sql)).toContain(compact('CASE WHEN "c0" IS NULL OR "c2" IS NULL THEN "rec" END'));
    });

    it("should collect geometries with ST_Collect and never dissolve them with ST_Union", () => {
      const sql = buildUnifySql(layoutOf());

      expect(sql).toContain("ST_Collect(");
      expect(sql).not.toContain("ST_Union");
    });

    it("should not aggregate a column when every stage field is a key", () => {
      const sql = buildUnifySql(layoutOf({ stageFields: ["c0"], keyFields: ["c0"] }));

      expect(compact(sql)).toBe(
        compact(
          `CREATE TEMP TABLE "shp_proc_unified" ON COMMIT DROP AS
           SELECT min("rec") AS "rec", "c0", ST_Multi(ST_CollectionExtract(ST_Collect("geom"), 3)) AS "geom"
           FROM "shp_proc_base" GROUP BY "c0", CASE WHEN "c0" IS NULL THEN "rec" END`
        )
      );
    });

    it("should quote a key and a value column whose names contain double quotes", () => {
      const sql = buildUnifySql(layoutOf({ stageFields: ['a"b', 'c"d'], keyFields: ['a"b'] }));

      expect(sql).toContain('"a""b"');
      expect(sql).toContain('(array_agg("c""d" ORDER BY "rec"))[1] AS "c""d"');
      expect(sql).toContain('GROUP BY "a""b"');
    });

    it("should throw an Error when no key field is given because unify requires at least one key", () => {
      expect(() => buildUnifySql(layoutOf({ keyFields: [] }))).toThrow(Error);
    });

    it("should throw an Error when a key field is not among the stage fields", () => {
      expect(() => buildUnifySql(layoutOf({ keyFields: ["c9"] }))).toThrow(Error);
    });

    it("should throw an Error when a key field is an injection string", () => {
      expect(() => buildUnifySql(layoutOf({ keyFields: [hostileSql] }))).toThrow(Error);
    });
  });

  describe("buildNullKeyCountSql", () => {
    it("should count base rows where the single key column is NULL", () => {
      const sql = buildNullKeyCountSql(layoutOf({ keyFields: ["c0"] }));

      expect(compact(sql)).toBe(
        compact('SELECT count(*) AS null_key_rows FROM "shp_proc_base" WHERE "c0" IS NULL')
      );
    });

    it("should count base rows where any of several key columns is NULL", () => {
      const sql = buildNullKeyCountSql(layoutOf({ keyFields: ["c0", "c2"] }));

      expect(compact(sql)).toBe(
        compact('SELECT count(*) AS null_key_rows FROM "shp_proc_base" WHERE "c0" IS NULL OR "c2" IS NULL')
      );
    });

    it("should quote a key column whose name contains a double quote", () => {
      const sql = buildNullKeyCountSql(layoutOf({ stageFields: ['a"b'], keyFields: ['a"b'] }));

      expect(sql).toContain('WHERE "a""b" IS NULL');
    });

    it("should throw the unify key error when no key field is given", () => {
      expect(() => buildNullKeyCountSql(layoutOf({ keyFields: [] }))).toThrow(/requiere al menos un campo clave/);
    });

    it("should throw the unknown stage column error when a key field is not among the stage fields", () => {
      expect(() => buildNullKeyCountSql(layoutOf({ keyFields: ["c9"] }))).toThrow(/no existe en el stage/);
    });

    it("should throw the unknown stage column error and never emit SQL when a key field is an injection string", () => {
      expect(() => buildNullKeyCountSql(layoutOf({ keyFields: [hostileSql] }))).toThrow(/no existe en el stage/);
    });
  });

  describe("buildGroupStatsSql", () => {
    it("should count groups and merged rows from the base table grouped by the keys", () => {
      const sql = buildGroupStatsSql(layoutOf({ keyFields: ["c0"] }));

      expect(sql).toContain('"shp_proc_base"');
      expect(sql).toContain('GROUP BY "c0"');
      expect(sql).toMatch(/AS\s+"?groups"?/i);
      expect(sql).toMatch(/AS\s+"?rows_merged"?/i);
    });

    it("should not reference the stage table", () => {
      expect(buildGroupStatsSql(layoutOf())).not.toContain("shp_replace_stage");
    });
  });

  describe("buildLargestGroupsSql", () => {
    it("should return the key columns and the group size ordered by size descending with the limit", () => {
      const sql = buildLargestGroupsSql(layoutOf({ keyFields: ["c0"] }), 5);

      expect(sql).toContain('GROUP BY "c0"');
      expect(sql).toMatch(/ORDER BY\s+"?size"?\s+DESC/i);
      expect(sql).toMatch(/LIMIT 5\b/);
      expect(sql).toMatch(/AS\s+"?size"?/i);
    });

    it("should keep only groups with more than one row through a HAVING clause on the group count", () => {
      const sql = buildLargestGroupsSql(layoutOf({ keyFields: ["c0"] }), 5);

      expect(compact(sql)).toContain(compact('GROUP BY "c0", CASE WHEN "c0" IS NULL THEN "rec" END HAVING count(*) > 1'));
    });

    it("should place the HAVING clause between the grouping and the ordering", () => {
      const sql = buildLargestGroupsSql(layoutOf({ keyFields: ["c0"] }), 5);

      expect(compact(sql)).toBe(
        compact(
          `SELECT "c0", count(*) AS "size" FROM "shp_proc_base"
           GROUP BY "c0", CASE WHEN "c0" IS NULL THEN "rec" END
           HAVING count(*) > 1
           ORDER BY "size" DESC, "c0" LIMIT 5`
        )
      );
    });

    it("should select every key column when several keys are given", () => {
      const sql = buildLargestGroupsSql(layoutOf({ keyFields: ["c0", "c2"] }), 10);

      expect(sql).toContain('"c0"');
      expect(sql).toContain('"c2"');
      expect(compact(sql)).toContain('GROUPBY"c0","c2"');
      expect(sql).toMatch(/LIMIT 10\b/);
    });

    it("should accept a limit of one", () => {
      expect(buildLargestGroupsSql(layoutOf(), 1)).toMatch(/LIMIT 1\b/);
    });

    it.each([
      ["a fraction", 1.5],
      ["negative", -1],
      ["NaN", Number.NaN],
      ["infinity", Number.POSITIVE_INFINITY],
      ["an injection string", "5; DROP TABLE shp_proc_base" as unknown as number],
    ])("should throw when the limit is %s", (_label, limit) => {
      expect(() => buildLargestGroupsSql(layoutOf(), limit)).toThrow(Error);
    });

    it("should throw an Error when a key field is not among the stage fields", () => {
      expect(() => buildLargestGroupsSql(layoutOf({ keyFields: ["c9"] }), 5)).toThrow(Error);
    });
  });

  describe("buildConflictCountSql", () => {
    it("should group the base table by the keys and test the compared columns", () => {
      const sql = buildConflictCountSql(layoutOf({ keyFields: ["c0"] }), ["c1", "c2"]);

      expect(sql).toContain('FROM "shp_proc_base"');
      expect(sql).toContain('GROUP BY "c0"');
      expect(sql).toContain('"c1"');
      expect(sql).toContain('"c2"');
    });

    it("should treat a NULL next to a value as a conflict through explicit null handling", () => {
      const sql = buildConflictCountSql(layoutOf(), ["c1"]);

      expect(sql).toMatch(/IS\s+(NOT\s+)?NULL|FILTER|bool_or|COALESCE|count\(\s*"c1"\s*\)/i);
    });

    it("should throw an Error when a compared column is not among the stage fields", () => {
      expect(() => buildConflictCountSql(layoutOf(), ["c9"])).toThrow(Error);
    });

    it("should throw an Error when a compared column is an injection string", () => {
      expect(() => buildConflictCountSql(layoutOf(), [hostileSql])).toThrow(Error);
    });

    it("should throw an Error when a key field is not among the stage fields", () => {
      expect(() => buildConflictCountSql(layoutOf({ keyFields: ["c9"] }), ["c1"])).toThrow(Error);
    });
  });

  describe("buildConflictSamplesSql", () => {
    it("should return only conflicting groups ordered by the key columns with the limit", () => {
      const sql = buildConflictSamplesSql(layoutOf({ keyFields: ["c0"] }), ["c1", "c2"], 20);

      expect(sql).toContain('GROUP BY "c0"');
      expect(sql).toContain("HAVING");
      expect(compact(sql)).toContain('ORDERBY"c0"');
      expect(sql).toMatch(/LIMIT 20\b/);
    });

    it("should return the distinct values of each compared column capped at five", () => {
      const sql = buildConflictSamplesSql(layoutOf(), ["c1"], 20);

      expect(sql).toContain("DISTINCT");
      expect(sql).toMatch(/\[\s*1\s*:\s*5\s*\]/);
    });

    it("should take the kept first value of each compared column in rec order", () => {
      const sql = buildConflictSamplesSql(layoutOf(), ["c1"], 20);

      expect(compact(sql)).toContain('ORDERBY"rec"');
    });

    it("should select the key columns and the compared columns", () => {
      const sql = buildConflictSamplesSql(layoutOf({ keyFields: ["c0"] }), ["c1", "c2"], 3);

      expect(sql).toContain('"c0"');
      expect(sql).toContain('"c1"');
      expect(sql).toContain('"c2"');
    });

    it.each([
      ["a fraction", 2.5],
      ["negative", -1],
      ["NaN", Number.NaN],
      ["infinity", Number.POSITIVE_INFINITY],
      ["an injection string", "20; DROP TABLE shp_proc_base" as unknown as number],
    ])("should throw when the limit is %s", (_label, limit) => {
      expect(() => buildConflictSamplesSql(layoutOf(), ["c1"], limit)).toThrow(Error);
    });

    it("should throw an Error when a compared column is not among the stage fields", () => {
      expect(() => buildConflictSamplesSql(layoutOf(), ["c9"], 20)).toThrow(Error);
    });
  });

  describe("buildRepairSql", () => {
    it("should return two statements, the first repairing invalid geometries into polygonal parts", () => {
      const [repair] = buildRepairSql(BASE_TABLE);

      expect(compact(repair)).toBe(
        compact(
          `UPDATE "shp_proc_base" SET "geom" = ST_CollectionExtract(ST_MakeValid("geom"), 3)
           WHERE "geom" IS NOT NULL AND NOT ST_IsValid("geom")`
        )
      );
    });

    it("should return two statements, the second nulling geometries that are empty after repair", () => {
      const [, nulling] = buildRepairSql(BASE_TABLE);

      expect(compact(nulling)).toBe(
        compact(
          `UPDATE "shp_proc_base" SET "geom" = NULL
           WHERE "geom" IS NOT NULL AND ST_IsEmpty("geom")`
        )
      );
    });

    it("should return exactly two statements", () => {
      expect(buildRepairSql(BASE_TABLE)).toHaveLength(2);
    });

    it("should quote a work table name containing a double quote in every statement", () => {
      const statements = buildRepairSql('odd"name');

      for (const statement of statements) {
        expect(statement).toContain('UPDATE "odd""name"');
      }
    });
  });

  describe("buildOverlapInputSql", () => {
    it("should return three statements in creation order", () => {
      expect(buildOverlapInputSql(BASE_TABLE)).toHaveLength(3);
    });

    it("should copy only valid, non-empty, non-null geometries into the overlap table", () => {
      const [copy] = buildOverlapInputSql(BASE_TABLE);

      expect(compact(copy)).toBe(
        compact(
          `CREATE TEMP TABLE "shp_proc_overlap" ON COMMIT DROP AS
           SELECT "rec", "geom" FROM "shp_proc_base"
           WHERE "geom" IS NOT NULL AND ST_IsValid("geom") AND NOT ST_IsEmpty("geom")`
        )
      );
    });

    it("should create a GiST index on the geometry of the overlap table", () => {
      const [, index] = buildOverlapInputSql(BASE_TABLE);

      expect(compact(index)).toBe(compact('CREATE INDEX ON "shp_proc_overlap" USING gist ("geom")'));
    });

    it("should analyze the overlap table after it is indexed", () => {
      const [, , analyze] = buildOverlapInputSql(BASE_TABLE);

      expect(compact(analyze)).toBe(compact('ANALYZE "shp_proc_overlap"'));
    });

    it("should quote a work table name containing a double quote", () => {
      const [copy] = buildOverlapInputSql('odd"name');

      expect(copy).toContain('FROM "odd""name"');
    });
  });

  describe("buildOverlapCountSql", () => {
    it("should count planar overlaps above the threshold without a geography cast", () => {
      const sql = buildOverlapCountSql(1, AreaMode.PLANAR);

      expect(compact(sql)).toBe(
        compact(
          `SELECT count(*) AS overlaps FROM "shp_proc_overlap" a
           JOIN "shp_proc_overlap" b ON a.rec < b.rec AND a.geom && b.geom AND ST_Intersects(a.geom, b.geom)
           WHERE ST_Area(ST_Intersection(a.geom, b.geom)) > 1`
        )
      );
      expect(sql).not.toContain("geography");
    });

    it("should measure the intersection area as a geography when the mode is geography", () => {
      const sql = buildOverlapCountSql(0.5, AreaMode.GEOGRAPHY);

      expect(compact(sql)).toBe(
        compact(
          `SELECT count(*) AS overlaps FROM "shp_proc_overlap" a
           JOIN "shp_proc_overlap" b ON a.rec < b.rec AND a.geom && b.geom AND ST_Intersects(a.geom, b.geom)
           WHERE ST_Area(ST_Intersection(a.geom, b.geom)::geography) > 0.5`
        )
      );
    });

    it("should use a zero threshold as a literal when the minimum area is zero", () => {
      expect(buildOverlapCountSql(0, AreaMode.PLANAR)).toMatch(/> 0$/);
    });

    it("should embed a fractional threshold as a numeric literal", () => {
      expect(buildOverlapCountSql(0.25, AreaMode.PLANAR)).toMatch(/> 0\.25$/);
    });

    it.each([
      ["NaN", Number.NaN],
      ["positive infinity", Number.POSITIVE_INFINITY],
      ["negative infinity", Number.NEGATIVE_INFINITY],
      ["a numeric string", "1" as unknown as number],
      ["an injection string", "1 OR 1=1" as unknown as number],
      ["a statement terminator", "1; DROP TABLE shp_proc_overlap" as unknown as number],
    ])("should throw when the minimum area is %s", (_label, minAreaM2) => {
      expect(() => buildOverlapCountSql(minAreaM2, AreaMode.PLANAR)).toThrow(Error);
    });
  });

  describe("buildOverlapSamplesSql", () => {
    it("should pair overlapping records once and join both sides back to the work table", () => {
      const sql = buildOverlapSamplesSql(layoutOf(), BASE_TABLE, 1, AreaMode.PLANAR, 20);

      expect(sql).toContain('FROM "shp_proc_overlap" a');
      expect(sql).toContain('JOIN "shp_proc_overlap" b');
      expect(sql).toContain("a.rec < b.rec");
      expect(sql).toContain("a.geom && b.geom");
      expect(sql).toContain("ST_Intersects(a.geom, b.geom)");
      expect(sql).toContain('"shp_proc_base"');
    });

    it("should filter by the planar intersection area above the threshold", () => {
      const sql = buildOverlapSamplesSql(layoutOf(), BASE_TABLE, 1, AreaMode.PLANAR, 20);

      expect(compact(sql)).toContain("ST_Area(ST_Intersection(a.geom,b.geom))>1");
      expect(sql).not.toContain("geography");
    });

    it("should filter by the geography intersection area when the mode is geography", () => {
      const sql = buildOverlapSamplesSql(layoutOf(), BASE_TABLE, 2, AreaMode.GEOGRAPHY, 20);

      expect(compact(sql)).toContain("ST_Area(ST_Intersection(a.geom,b.geom)::geography)>2");
    });

    it("should return the rec pair, the area and the key columns of both records", () => {
      const sql = buildOverlapSamplesSql(layoutOf({ keyFields: ["c0"] }), BASE_TABLE, 1, AreaMode.PLANAR, 20);

      expect(sql).toMatch(/AS\s+"?rec_a"?/i);
      expect(sql).toMatch(/AS\s+"?rec_b"?/i);
      expect(sql).toMatch(/AS\s+"?area"?/i);
      expect(sql.match(/"c0"/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    });

    it("should order by area descending then by the rec pair with the limit", () => {
      const sql = buildOverlapSamplesSql(layoutOf(), BASE_TABLE, 1, AreaMode.PLANAR, 20);

      expect(sql).toMatch(/ORDER BY\s+"?area"?\s+DESC\s*,\s*"?rec_a"?\s*,\s*"?rec_b"?/i);
      expect(sql).toMatch(/LIMIT 20\b/);
    });

    it("should quote a work table name containing a double quote", () => {
      const sql = buildOverlapSamplesSql(layoutOf(), 'odd"name', 1, AreaMode.PLANAR, 20);

      expect(sql).toContain('"odd""name"');
    });

    it.each([
      ["a fraction", 2.5],
      ["negative", -1],
      ["NaN", Number.NaN],
      ["an injection string", "20; DROP TABLE shp_proc_overlap" as unknown as number],
    ])("should throw when the limit is %s", (_label, limit) => {
      expect(() => buildOverlapSamplesSql(layoutOf(), BASE_TABLE, 1, AreaMode.PLANAR, limit)).toThrow(Error);
    });

    it.each([
      ["NaN", Number.NaN],
      ["an injection string", "1 OR 1=1" as unknown as number],
    ])("should throw when the minimum area is %s", (_label, minAreaM2) => {
      expect(() => buildOverlapSamplesSql(layoutOf(), BASE_TABLE, minAreaM2, AreaMode.PLANAR, 20)).toThrow(Error);
    });

    it("should throw an Error when a key field is not among the stage fields", () => {
      expect(() =>
        buildOverlapSamplesSql(layoutOf({ keyFields: ["c9"] }), BASE_TABLE, 1, AreaMode.PLANAR, 20)
      ).toThrow(Error);
    });
  });

  describe("identifier safety across builders", () => {
    it.each([
      ["unify", () => buildUnifySql(layoutOf({ keyFields: [hostileSql] }))],
      ["group stats", () => buildGroupStatsSql(layoutOf({ keyFields: [hostileSql] }))],
      ["largest groups", () => buildLargestGroupsSql(layoutOf({ keyFields: [hostileSql] }), 5)],
      ["conflict count", () => buildConflictCountSql(layoutOf({ keyFields: [hostileSql] }), ["c1"])],
      ["conflict samples", () => buildConflictSamplesSql(layoutOf({ keyFields: [hostileSql] }), ["c1"], 5)],
      [
        "overlap samples",
        () => buildOverlapSamplesSql(layoutOf({ keyFields: [hostileSql] }), BASE_TABLE, 1, AreaMode.PLANAR, 5),
      ],
    ])("should throw and never emit the hostile key name when building %s SQL", (_label, build) => {
      expect(build).toThrow(Error);
    });
  });
});
