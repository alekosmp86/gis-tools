import { describe, it, expect } from "vitest";
import {
  GEOMETRY_REPAIR_DEFAULT_DECIMALS,
  GEOMETRY_REPAIR_MAX_DECIMALS,
  GEOMETRY_REPAIR_MIN_DECIMALS,
  buildGeometryRepairCountStatement,
  buildGeometryRepairUpdateStatement,
  isRepairableGeometryColumnType,
  isUnsupportedPolygonalColumnType,
  isValidGeometryRepairDecimalsInput,
  normalizeGeometryRepairDecimals,
  parseGeometryRepairCount,
} from "@/core/services/geometryRepairSql";

const SCHEMA = "geo";
const TABLE = "dst";
const COLUMN = "geom";
const DEFAULT_TOLERANCE = "0.0001";

const countOf = (decimals: unknown, schema: string | null | undefined = SCHEMA, table = TABLE, column = COLUMN): string =>
  buildGeometryRepairCountStatement(schema, table, column, decimals as number);

const updateOf = (decimals: unknown, schema: string | null | undefined = SCHEMA, table = TABLE, column = COLUMN): string =>
  buildGeometryRepairUpdateStatement(schema, table, column, decimals as number);

const snapTo = (tolerance: string): string => `ST_SnapToGrid(ST_Transform(part, 4326), ${tolerance})`;

const BUILDERS = [
  ["count", countOf],
  ["update", updateOf],
] as const;

describe("geometryRepairSql", () => {
  describe("constants", () => {
    it("should default to 4 decimals and accept the range 0..8", () => {
      expect(GEOMETRY_REPAIR_DEFAULT_DECIMALS).toBe(4);
      expect(GEOMETRY_REPAIR_MIN_DECIMALS).toBe(0);
      expect(GEOMETRY_REPAIR_MAX_DECIMALS).toBe(8);
    });
  });

  describe("normalizeGeometryRepairDecimals", () => {
    it.each([0, 1, 4, 8])("should keep the integer %i inside the 0..8 range", (decimals) => {
      expect(normalizeGeometryRepairDecimals(decimals)).toBe(decimals);
    });

    it.each([
      ["minus one below the range", -1],
      ["nine above the range", 9],
      ["fractional value", 2.5],
      ["NaN", Number.NaN],
      ["Infinity", Number.POSITIVE_INFINITY],
      ["undefined", undefined],
      ["null", null],
      ["boolean", true],
      ["object", {}],
      ["non-numeric text", "x"],
      ["empty text", ""],
      ["whitespace-only text", "   "],
      ["fractional numeric text", "2.5"],
      ["out-of-range numeric text", "9"],
      ["negative numeric text", "-1"],
    ])("should fall back to the default 4 when the value is %s", (_label, value) => {
      expect(normalizeGeometryRepairDecimals(value)).toBe(GEOMETRY_REPAIR_DEFAULT_DECIMALS);
    });

    it.each([
      ["3", 3],
      ["0", 0],
      ["8", 8],
      [" 6 ", 6],
    ])("should accept the numeric text %j as the integer %i", (value, expected) => {
      expect(normalizeGeometryRepairDecimals(value)).toBe(expected);
    });
  });

  describe("isValidGeometryRepairDecimalsInput", () => {
    it.each([
      ["0", "0"],
      ["4", "4"],
      ["8", "8"],
      [" 6 ", "6 with surrounding spaces"],
    ])("should accept the typed decimals %j (%s)", (input) => {
      expect(isValidGeometryRepairDecimalsInput(input)).toBe(true);
    });

    it.each([
      ["empty text", ""],
      ["whitespace-only text", "   "],
      ["one above the range", "9"],
      ["negative", "-1"],
      ["fractional", "2.5"],
      ["scientific notation", "1e1"],
      ["explicit plus sign", "+3"],
      ["non-numeric text", "abc"],
    ])("should reject the typed decimals when the input is %s", (_label, input) => {
      expect(isValidGeometryRepairDecimalsInput(input)).toBe(false);
    });
  });

  describe("isRepairableGeometryColumnType", () => {
    it.each([
      "geometry",
      "geometry(Geometry,4326)",
      "geometry(MultiPolygon,32721)",
      "geometry(MULTIPOLYGON,4326)",
      "geometry(MultiPolygonZ,32721)",
      "geometry(MultiPolygon, 32721)",
      "geometry(MultiPolygon)",
      "  geometry(MultiPolygon,32721)  ",
      "public.geometry(MultiPolygon,32721)",
      "\"public\".geometry",
      "public.geometry",
    ])("should treat the column type %j as repairable", (columnType) => {
      expect(isRepairableGeometryColumnType(columnType)).toBe(true);
    });

    it.each([
      "geometry(Polygon,32721)",
      "geometry(Point,4326)",
      "geometry(MultiPoint,4326)",
      "geometry(LineString,4326)",
      "geometry(MultiLineString,4326)",
      "geometry(GeometryCollection,4326)",
      "geometry(MultiPolygonM,32721)",
      "geometry(MultiPolygonZM,32721)",
      "geometry(PolygonM,32721)",
      "public.geometry(Polygon,32721)",
      "geography(MultiPolygon,4326)",
      "geography",
      "geometry[]",
      "geometry(MultiPolygon,32721)[]",
      "geometryfoo",
      "geometry_extra(MultiPolygon,32721)",
      "integer",
      "text",
    ])("should not treat the column type %j as repairable", (columnType) => {
      expect(isRepairableGeometryColumnType(columnType)).toBe(false);
    });

    it.each([["empty text", ""], ["whitespace-only text", "   "], ["null", null], ["undefined", undefined]])(
      "should not treat %s as repairable",
      (_label, columnType) => {
        expect(isRepairableGeometryColumnType(columnType)).toBe(false);
      }
    );
  });

  describe("isUnsupportedPolygonalColumnType", () => {
    it.each([
      "geometry(Polygon,32721)",
      "public.geometry(Polygon,32721)",
      "geometry(MultiPolygonM,32721)",
      "geometry(MultiPolygonZM,32721)",
    ])("should flag the polygonal column type %j as unsupported", (columnType) => {
      expect(isUnsupportedPolygonalColumnType(columnType)).toBe(true);
    });

    it.each([
      "geometry(MultiPolygon,32721)",
      "geometry(MultiPolygonZ,32721)",
      "geometry",
      "geometry(Point,4326)",
      "geography(MultiPolygon,4326)",
      "geometry[]",
      "geometryfoo",
      "text",
      "",
      null,
      undefined,
    ])("should not flag the column type %j as an unsupported polygonal column", (columnType) => {
      expect(isUnsupportedPolygonalColumnType(columnType)).toBe(false);
    });
  });

  describe("parseGeometryRepairCount", () => {
    it.each([
      ["5,3", 5, 3],
      ["0,0", 0, 0],
      ["0,3", 0, 3],
      [" 12,4 ", 12, 4],
    ])("should parse the count text %j into changed %i and unrepairable %i", (text, changedRows, unrepairableRows) => {
      expect(parseGeometryRepairCount(text)).toEqual({ changedRows, unrepairableRows });
    });

    it.each([
      ["a bare number", 5],
      ["a bare numeric text", "5"],
      ["a negative part", "5,-1"],
      ["non-numeric parts", "a,b"],
      ["three parts", "1,2,3"],
      ["a space before the comma", "5 ,3"],
      ["an empty text", ""],
      ["a whitespace-only text", "   "],
      ["null", null],
      ["undefined", undefined],
      ["an object", { changedRows: 1, unrepairableRows: 0 }],
    ])("should return null when the count value is %s", (_label, value) => {
      expect(parseGeometryRepairCount(value)).toBeNull();
    });
  });

  describe("tolerance literal", () => {
    it.each([
      [0, "1"],
      [3, "0.001"],
      [4, DEFAULT_TOLERANCE],
      [8, "0.00000001"],
    ])("should snap with tolerance %s for decimals %i in both statements", (decimals, tolerance) => {
      expect(countOf(decimals)).toContain(snapTo(tolerance));
      expect(updateOf(decimals)).toContain(snapTo(tolerance));
    });

    it.each([
      ["minus one", -1],
      ["nine", 9],
      ["fractional 2.5", 2.5],
      ["NaN", Number.NaN],
      ["undefined", undefined],
    ])("should snap with the default tolerance when decimals is %s", (_label, decimals) => {
      expect(countOf(decimals)).toContain(snapTo(DEFAULT_TOLERANCE));
      expect(updateOf(decimals)).toContain(snapTo(DEFAULT_TOLERANCE));
    });

    it("should snap with tolerance 0.001 when decimals is the numeric text \"3\"", () => {
      expect(countOf("3")).toContain(snapTo("0.001"));
      expect(updateOf("3")).toContain(snapTo("0.001"));
    });
  });

  describe("statement shape", () => {
    it.each(BUILDERS)("should emit the %s statement as a single line terminated by a semicolon", (_name, build) => {
      const statement = build(4);
      expect(statement).not.toMatch(/[\n\r]/);
      expect(statement.endsWith(";")).toBe(true);
    });

    it.each(BUILDERS)("should stay a single line for every decimals value in the %s statement", (_name, build) => {
      for (let decimals = GEOMETRY_REPAIR_MIN_DECIMALS; decimals <= GEOMETRY_REPAIR_MAX_DECIMALS; decimals++) {
        expect(build(decimals)).not.toMatch(/[\n\r]/);
      }
    });

    it.each(BUILDERS)("should start with a WITH clause in the %s statement", (_name, build) => {
      expect(build(4).startsWith("WITH ")).toBe(true);
    });

    it.each(BUILDERS)("should filter the %s statement to non-null geometries with a positive SRID", (_name, build) => {
      expect(build(4)).toContain('"geom" IS NOT NULL AND ST_SRID("geom") > 0');
    });

    it.each(BUILDERS)("should keep only geometries whose SRID exists in spatial_ref_sys in the %s statement", (_name, build) => {
      expect(build(4)).toContain('ST_SRID("geom") IN (SELECT srid FROM spatial_ref_sys)');
    });

    it.each(BUILDERS)("should filter the %s statement to Polygon and MultiPolygon geometries only", (_name, build) => {
      expect(build(4)).toContain("GeometryType(\"geom\") IN ('POLYGON', 'MULTIPOLYGON')");
    });

    it.each(BUILDERS)("should keep a part only when it has at least 4 snapped points in the %s statement", (_name, build) => {
      expect(build(4)).toContain(`ST_NPoints(${snapTo(DEFAULT_TOLERANCE)}) >= 4`);
    });

    it.each(BUILDERS)("should drop zero-area parts after snapping in the %s statement", (_name, build) => {
      expect(build(4)).toContain(`ST_Area(${snapTo(DEFAULT_TOLERANCE)}) > 0`);
    });

    it.each(BUILDERS)("should split the geometry with ST_MakeValid and polygon extraction in the %s statement", (_name, build) => {
      expect(build(4)).toContain('ST_Dump(ST_CollectionExtract(ST_MakeValid("geom"), 3))');
    });

    it.each(BUILDERS)("should rebuild the kept parts as ST_Multi of ST_Collect with the original SRID in the %s statement", (_name, build) => {
      expect(build(4)).toContain("ST_SetSRID(ST_Multi(ST_Collect(part)), max(srid))");
    });

    it.each(BUILDERS)("should key rows by tableoid and ctid without text casts in the %s statement", (_name, build) => {
      const statement = build(4);
      expect(statement).toContain("tableoid AS toid");
      expect(statement).toContain("ctid AS rid");
      expect(statement).toContain("GROUP BY toid, rid");
      expect(statement).not.toMatch(/(?:ctid|tableoid)::text/);
    });

    it.each(BUILDERS)("should join the repaired rows back on tableoid and ctid in the %s statement", (_name, build) => {
      expect(build(4)).toContain("t.tableoid = r.toid AND t.ctid = r.rid");
    });
  });

  describe("count statement", () => {
    it("should return one text value built with concat_ws as changed and unrepairable counts", () => {
      const statement = countOf(4);
      expect(statement).toContain("SELECT concat_ws(',',");
      expect(statement).toContain("::text, ");
    });

    it("should count the changed rows with the same row condition as the update", () => {
      expect(countOf(4)).toContain('NOT ST_IsValid(t."geom") OR ST_NumGeometries(t."geom") <> ST_NumGeometries(r.ng)');
    });

    it("should count the unrepairable rows as candidates missing from the repaired set plus invalid repaired geometries", () => {
      const statement = countOf(4);
      expect(statement).toContain("NOT EXISTS (SELECT 1 FROM r WHERE r.toid = f.tableoid AND r.rid = f.ctid)");
      expect(statement).toContain("SELECT count(*) FROM r WHERE NOT ST_IsValid(r.ng)");
    });

    it("should not write to the table", () => {
      expect(countOf(4)).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
    });
  });

  describe("update statement", () => {
    it("should update only the geometry column of the target table through the repaired rows", () => {
      expect(updateOf(4)).toContain('UPDATE "geo"."dst" AS t SET "geom" = r.ng FROM r WHERE');
    });

    it("should write only rows whose repaired geometry is valid", () => {
      expect(updateOf(4)).toContain("ST_IsValid(r.ng)");
    });

    it("should write only rows that are invalid or whose part count would change", () => {
      expect(updateOf(4)).toContain('NOT ST_IsValid(t."geom") OR ST_NumGeometries(t."geom") <> ST_NumGeometries(r.ng)');
    });
  });

  describe("identifiers", () => {
    it("should quote schema, table and column identifiers in both statements", () => {
      expect(countOf(4)).toContain('FROM "geo"."dst" WHERE');
      expect(countOf(4)).toContain('JOIN "geo"."dst" AS t');
      expect(countOf(4)).toContain('ST_SRID("geom")');
      expect(updateOf(4)).toContain('UPDATE "geo"."dst" AS t SET "geom" = r.ng');
    });

    it("should double embedded double quotes in the table name", () => {
      expect(countOf(4, SCHEMA, 'we"ird')).toContain('FROM "geo"."we""ird" WHERE');
      expect(countOf(4, SCHEMA, 'we"ird')).toContain('JOIN "geo"."we""ird" AS t');
      expect(updateOf(4, SCHEMA, 'we"ird')).toContain('UPDATE "geo"."we""ird" AS t');
    });

    it("should double embedded double quotes in the column name", () => {
      expect(countOf(4, SCHEMA, TABLE, 'ge"om')).toContain('ST_SRID("ge""om")');
      expect(updateOf(4, SCHEMA, TABLE, 'ge"om')).toContain('SET "ge""om" = r.ng');
    });

    it.each([undefined, null, "", "   "])("should default the schema to public when schema is %j", (schema) => {
      expect(buildGeometryRepairCountStatement(schema, TABLE, COLUMN, 4)).toContain('JOIN "public"."dst" AS t');
      expect(buildGeometryRepairUpdateStatement(schema, TABLE, COLUMN, 4)).toContain('UPDATE "public"."dst" AS t');
    });
  });
});
