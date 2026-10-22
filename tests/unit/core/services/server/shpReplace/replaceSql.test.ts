import { describe, it, expect } from "vitest";
import {
  GEOMETRY_STAGE_COLUMN,
  STAGE_TABLE,
  assertSafeSridNumber,
  buildCopySql,
  buildCreateStageSql,
  buildInsertSelectSql,
  stageColumnName,
  type GeometryPlan,
  type InsertColumnPlan,
} from "@/core/services/server/shpReplace/replaceSql";

const STAGE_FROM = ' FROM "shp_replace_stage" ORDER BY "rec"';

function selectListOf(sql: string): string {
  const separator = ") SELECT ";
  const start = sql.indexOf(separator) + separator.length;
  return sql.slice(start, sql.length - STAGE_FROM.length);
}

function compact(sql: string): string {
  return sql.replace(/\s+/g, "");
}

const sourceColumn = (
  targetColumn: string,
  dataType: string,
  stageColumn: string
): InsertColumnPlan => ({ targetColumn, dataType, kind: "source", stageColumn });

const geometryColumn = (targetColumn = "geom", dataType = "geometry"): InsertColumnPlan => ({
  targetColumn,
  dataType,
  kind: "geometry",
});

const defaultColumn = (targetColumn: string, dataType: string, defaultSql: string): InsertColumnPlan => ({
  targetColumn,
  dataType,
  kind: "default",
  defaultSql,
});

describe("replaceSql", () => {
  describe("constants and stage column names", () => {
    it("should name the stage table shp_replace_stage", () => {
      expect(STAGE_TABLE).toBe("shp_replace_stage");
    });

    it("should name the geometry stage column geom_json", () => {
      expect(GEOMETRY_STAGE_COLUMN).toBe("geom_json");
    });

    it.each([
      [0, "c0"],
      [1, "c1"],
      [12, "c12"],
    ])("should return %s-th stage column name as %s", (index, expected) => {
      expect(stageColumnName(index)).toBe(expected);
    });
  });

  describe("buildCreateStageSql", () => {
    it("should declare rec and one text column per mapped field when there is no geometry", () => {
      expect(buildCreateStageSql(2, false)).toBe(
        'CREATE TEMP TABLE "shp_replace_stage" ("rec" integer, "c0" text, "c1" text) ON COMMIT DROP'
      );
    });

    it("should append a geom_json text column when the geometry is mapped", () => {
      expect(buildCreateStageSql(2, true)).toBe(
        'CREATE TEMP TABLE "shp_replace_stage" ("rec" integer, "c0" text, "c1" text, "geom_json" text) ON COMMIT DROP'
      );
    });

    it("should declare only rec when there are no field columns and no geometry", () => {
      expect(buildCreateStageSql(0, false)).toBe(
        'CREATE TEMP TABLE "shp_replace_stage" ("rec" integer) ON COMMIT DROP'
      );
    });

    it("should declare rec and geom_json only when there are no field columns but geometry is mapped", () => {
      expect(buildCreateStageSql(0, true)).toBe(
        'CREATE TEMP TABLE "shp_replace_stage" ("rec" integer, "geom_json" text) ON COMMIT DROP'
      );
    });

    it("should create the stage as a temporary table dropped on commit", () => {
      const sql = buildCreateStageSql(1, false);

      expect(sql.startsWith('CREATE TEMP TABLE "shp_replace_stage" (')).toBe(true);
      expect(sql.endsWith("ON COMMIT DROP")).toBe(true);
    });
  });

  describe("buildCopySql", () => {
    it("should copy into rec and the field columns when there is no geometry", () => {
      expect(buildCopySql(2, false)).toBe('COPY "shp_replace_stage" ("rec","c0","c1") FROM STDIN');
    });

    it("should copy into geom_json as the last column when the geometry is mapped", () => {
      expect(buildCopySql(2, true)).toBe(
        'COPY "shp_replace_stage" ("rec","c0","c1","geom_json") FROM STDIN'
      );
    });

    it("should copy only rec when there are no field columns and no geometry", () => {
      expect(buildCopySql(0, false)).toBe('COPY "shp_replace_stage" ("rec") FROM STDIN');
    });

    it("should copy rec and geom_json when there are no field columns but geometry is mapped", () => {
      expect(buildCopySql(0, true)).toBe('COPY "shp_replace_stage" ("rec","geom_json") FROM STDIN');
    });

    it("should name exactly the same stage columns as buildCreateStageSql", () => {
      const create = buildCreateStageSql(3, true);
      const copy = buildCopySql(3, true);
      const copyColumns = copy.slice(copy.indexOf("(") + 1, copy.indexOf(")")).split(",");

      for (const column of copyColumns) {
        expect(create).toContain(`${column} `);
      }
      expect(copyColumns).toEqual(['"rec"', '"c0"', '"c1"', '"c2"', '"geom_json"']);
    });
  });

  describe("buildInsertSelectSql identifiers", () => {
    it("should qualify the table with public and build a single source column insert when the schema is undefined", () => {
      const sql = buildInsertSelectSql(undefined, "parcels", [sourceColumn("nombre", "text", "c0")]);

      expect(sql).toBe(
        'INSERT INTO "public"."parcels" ("nombre") SELECT "c0" FROM "shp_replace_stage" ORDER BY "rec"'
      );
    });

    it.each([null, "", "   "])("should default the schema to public when the schema is %j", (schema) => {
      const sql = buildInsertSelectSql(schema as string | undefined, "parcels", [
        sourceColumn("nombre", "text", "c0"),
      ]);

      expect(sql.startsWith('INSERT INTO "public"."parcels" (')).toBe(true);
    });

    it("should keep a provided schema case-sensitive", () => {
      const sql = buildInsertSelectSql("Cartografia", "parcels", [sourceColumn("nombre", "text", "c0")]);

      expect(sql.startsWith('INSERT INTO "Cartografia"."parcels" (')).toBe(true);
    });

    it("should double embedded quotes in schema and table names", () => {
      const sql = buildInsertSelectSql('Geo "Data"', 'odd"name', [sourceColumn("a", "text", "c0")]);

      expect(sql).toBe(
        'INSERT INTO "Geo ""Data"""."odd""name" ("a") SELECT "c0" FROM "shp_replace_stage" ORDER BY "rec"'
      );
    });

    it("should double embedded quotes in a target column name", () => {
      const sql = buildInsertSelectSql("public", "parcels", [sourceColumn('we"ird', "text", "c0")]);

      expect(sql).toBe(
        'INSERT INTO "public"."parcels" ("we""ird") SELECT "c0" FROM "shp_replace_stage" ORDER BY "rec"'
      );
    });

    it("should keep a target column with SQL metacharacters inside one quoted identifier", () => {
      const hostile = 'x"; DROP TABLE t; --';
      const sql = buildInsertSelectSql("public", "parcels", [sourceColumn(hostile, "text", "c0")]);

      expect(sql).toBe(
        'INSERT INTO "public"."parcels" ("x""; DROP TABLE t; --") SELECT "c0" FROM "shp_replace_stage" ORDER BY "rec"'
      );
    });

    it("should keep the target column list in the order the columns were given", () => {
      const sql = buildInsertSelectSql("public", "parcels", [
        sourceColumn("b", "text", "c0"),
        sourceColumn("a", "text", "c1"),
      ]);

      expect(sql).toContain('("b","a")');
      expect(selectListOf(sql).indexOf('"c0"')).toBeLessThan(selectListOf(sql).indexOf('"c1"'));
    });

    it("should always end with FROM the stage table ordered by rec", () => {
      const sql = buildInsertSelectSql("public", "parcels", [sourceColumn("a", "text", "c0")]);

      expect(sql.endsWith(STAGE_FROM)).toBe(true);
    });
  });

  describe("buildInsertSelectSql source casts", () => {
    it.each(["text", "character varying", "character", "varchar", "char", "citext", "name"])(
      "should pass the stage column through unchanged when the source type is %s",
      (dataType) => {
        const sql = buildInsertSelectSql("public", "parcels", [sourceColumn("nombre", dataType, "c3")]);

        expect(sql).toBe(
          'INSERT INTO "public"."parcels" ("nombre") SELECT "c3" FROM "shp_replace_stage" ORDER BY "rec"'
        );
      }
    );

    it.each(["numeric", "integer", "bigint", "boolean", "date", "timestamp without time zone", "double precision"])(
      "should cast the NULLIF of an empty stage cell to %s when the source type is not text-like",
      (dataType) => {
        const sql = buildInsertSelectSql("public", "parcels", [sourceColumn("valor", dataType, "c0")]);

        expect(sql).toBe(
          `INSERT INTO "public"."parcels" ("valor") SELECT NULLIF("c0",'')::${dataType} FROM "shp_replace_stage" ORDER BY "rec"`
        );
      }
    );

    it.each(["uuid", "json", "jsonb", "bytea", "inet", "interval"])(
      "should cast the NULLIF of an empty stage cell to %s when the source type is not text-like and was never cast before",
      (dataType) => {
        const sql = buildInsertSelectSql("public", "parcels", [sourceColumn("valor", dataType, "c0")]);

        expect(sql).toBe(
          `INSERT INTO "public"."parcels" ("valor") SELECT NULLIF("c0",'')::${dataType} FROM "shp_replace_stage" ORDER BY "rec"`
        );
      }
    );

    it("should not wrap text-like columns in NULLIF so that an empty string is kept", () => {
      const sql = buildInsertSelectSql("public", "parcels", [sourceColumn("nombre", "text", "c0")]);

      expect(sql).not.toContain("NULLIF");
    });

    it("should wrap a numeric cast around each non-text column when the columns mix types", () => {
      const sql = buildInsertSelectSql("public", "parcels", [
        sourceColumn("nombre", "text", "c0"),
        sourceColumn("area", "numeric", "c1"),
      ]);

      expect(selectListOf(sql)).toContain('"c0"');
      expect(selectListOf(sql)).toContain(`NULLIF("c1",'')::numeric`);
    });
  });

  describe("buildInsertSelectSql defaults", () => {
    it("should emit the default SQL verbatim for a default column", () => {
      const sql = buildInsertSelectSql("public", "parcels", [defaultColumn("estado", "text", "'activo'")]);

      expect(sql).toBe(
        `INSERT INTO "public"."parcels" ("estado") SELECT 'activo' FROM "shp_replace_stage" ORDER BY "rec"`
      );
    });

    it("should emit a function default verbatim", () => {
      const sql = buildInsertSelectSql("public", "parcels", [
        defaultColumn("creado_en", "timestamp with time zone", "now()"),
      ]);

      expect(selectListOf(sql)).toBe("now()");
    });

    it("should build a valid insert that references no stage column when every column is a default", () => {
      const sql = buildInsertSelectSql("public", "parcels", [
        defaultColumn("estado", "text", "'activo'"),
        defaultColumn("creado_en", "timestamp with time zone", "now()"),
      ]);

      expect(sql).toBe(
        `INSERT INTO "public"."parcels" ("estado","creado_en") SELECT 'activo', now() FROM "shp_replace_stage" ORDER BY "rec"`
      );
    });

    it("should quote a default target column name like any other identifier", () => {
      const sql = buildInsertSelectSql("public", "parcels", [defaultColumn('a"b', "text", "'x'")]);

      expect(sql).toContain('("a""b")');
    });
  });

  describe("buildInsertSelectSql geometry", () => {
    it("should wrap ST_Multi around the transform when the SRIDs differ and the target is multi", () => {
      const geometry: GeometryPlan = { sourceSrid: 25830, targetSrid: 4326, multi: true };

      const sql = buildInsertSelectSql("public", "parcels", [geometryColumn("geom")], geometry);

      expect(compact(selectListOf(sql))).toBe(
        'ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",\'\')),25830),4326))'
      );
    });

    it("should skip ST_Transform and keep ST_Multi when the source and target SRIDs are equal", () => {
      const geometry: GeometryPlan = { sourceSrid: 4326, targetSrid: 4326, multi: true };

      const sql = buildInsertSelectSql("public", "parcels", [geometryColumn("geom")], geometry);

      expect(compact(selectListOf(sql))).toBe(
        'ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",\'\')),4326))'
      );
      expect(sql).not.toContain("ST_Transform");
    });

    it("should skip ST_Multi and keep ST_Transform when the target is not multi", () => {
      const geometry: GeometryPlan = { sourceSrid: 25830, targetSrid: 4326, multi: false };

      const sql = buildInsertSelectSql("public", "parcels", [geometryColumn("geom")], geometry);

      expect(compact(selectListOf(sql))).toBe(
        'ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",\'\')),25830),4326)'
      );
      expect(sql).not.toContain("ST_Multi");
    });

    it("should skip both ST_Transform and ST_Multi when the SRIDs are equal and the target is not multi", () => {
      const geometry: GeometryPlan = { sourceSrid: 4326, targetSrid: 4326, multi: false };

      const sql = buildInsertSelectSql("public", "parcels", [geometryColumn("geom")], geometry);

      expect(compact(selectListOf(sql))).toBe('ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",\'\')),4326)');
    });

    it("should read the geometry from the geom_json stage column and not from a field column", () => {
      const geometry: GeometryPlan = { sourceSrid: 25830, targetSrid: 25830, multi: false };

      const sql = buildInsertSelectSql("public", "parcels", [sourceColumn("nombre", "text", "c0"), geometryColumn("geom")], geometry);

      expect(sql).toContain('NULLIF("geom_json",\'\')');
      expect(selectListOf(sql)).toContain('"c0"');
    });

    it("should quote a geometry target column name containing quotes", () => {
      const geometry: GeometryPlan = { sourceSrid: 4326, targetSrid: 4326, multi: true };

      const sql = buildInsertSelectSql("public", "parcels", [geometryColumn('ge"om')], geometry);

      expect(sql.startsWith('INSERT INTO "public"."parcels" ("ge""om") SELECT ')).toBe(true);
    });

    it("should not reference geom_json or any ST_ function when no geometry column is planned", () => {
      const sql = buildInsertSelectSql("public", "parcels", [
        sourceColumn("nombre", "text", "c0"),
        defaultColumn("estado", "text", "'activo'"),
      ]);

      expect(sql).not.toContain("geom_json");
      expect(sql).not.toContain("ST_");
    });

    it.each([
      ["source SRID is a SQL injection string", "4326; DROP TABLE parcels"],
      ["source SRID has a closing parenthesis", "4326)"],
      ["source SRID is a quoted literal", "'4326'"],
      ["source SRID is an OR clause", "4326 OR 1=1"],
      ["source SRID is an empty string", ""],
    ])("should throw when the %s", (_label, injected) => {
      const geometry = {
        sourceSrid: injected as unknown as number,
        targetSrid: 4326,
        multi: true,
      };

      expect(() =>
        buildInsertSelectSql("public", "parcels", [geometryColumn("geom")], geometry)
      ).toThrow(Error);
    });

    it("should throw when the target SRID is out of range", () => {
      const geometry: GeometryPlan = { sourceSrid: 4326, targetSrid: 999000, multi: true };

      expect(() => buildInsertSelectSql("public", "parcels", [geometryColumn("geom")], geometry)).toThrow(
        Error
      );
    });

    it("should throw when the target SRID is negative", () => {
      const geometry: GeometryPlan = { sourceSrid: 4326, targetSrid: -1, multi: true };

      expect(() => buildInsertSelectSql("public", "parcels", [geometryColumn("geom")], geometry)).toThrow(Error);
    });

    it("should throw when the source SRID is zero even though the target SRID may be zero", () => {
      const geometry: GeometryPlan = { sourceSrid: 0, targetSrid: 0, multi: true };

      expect(() => buildInsertSelectSql("public", "parcels", [geometryColumn("geom")], geometry)).toThrow(Error);
    });

    it("should skip ST_Transform and keep ST_Multi when the target SRID is 0 for an unconstrained geometry column", () => {
      const geometry: GeometryPlan = { sourceSrid: 25830, targetSrid: 0, multi: true };

      const sql = buildInsertSelectSql("public", "parcels", [geometryColumn("geom")], geometry);

      expect(compact(selectListOf(sql))).toBe(
        'ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",\'\')),25830))'
      );
      expect(sql).not.toContain("ST_Transform");
    });

    it("should skip ST_Transform and ST_Multi when the target SRID is 0 and the target is not multi", () => {
      const geometry: GeometryPlan = { sourceSrid: 25830, targetSrid: 0, multi: false };

      const sql = buildInsertSelectSql("public", "parcels", [geometryColumn("geom")], geometry);

      expect(compact(selectListOf(sql))).toBe('ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",\'\')),25830)');
    });
  });

  describe("assertSafeSridNumber", () => {
    it.each([1, 4326, 25830, 998999])("should return %s unchanged when it is an integer within 1..998999", (srid) => {
      expect(assertSafeSridNumber(srid)).toBe(srid);
    });

    it.each([
      ["zero", 0],
      ["negative", -1],
      ["above the upper bound", 999000],
      ["fractional", 4326.5],
      ["NaN", Number.NaN],
      ["positive infinity", Number.POSITIVE_INFINITY],
      ["negative infinity", Number.NEGATIVE_INFINITY],
    ])("should throw an Error when the SRID is %s", (_label, value) => {
      expect(() => assertSafeSridNumber(value)).toThrow(Error);
    });

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["an object", {}],
      ["a boolean", true],
      ["an injection string", "4326; DROP TABLE spatial_ref_sys"],
      ["a numeric string", "4326"],
    ])("should throw an Error when the SRID value is %s", (_label, value) => {
      expect(() => assertSafeSridNumber(value)).toThrow(Error);
    });
  });
});
