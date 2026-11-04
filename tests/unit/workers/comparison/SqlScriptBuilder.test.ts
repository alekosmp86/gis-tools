import { describe, expect, it } from "vitest";
import { SqlScriptBuilder } from "@/core/workers/comparison/SqlScriptBuilder";

const point = { type: "Point", coordinates: [-56.1, -34.9] };
const pointJson = JSON.stringify(point);

describe("SqlScriptBuilder", () => {
  describe("formatSqlValue", () => {
    const builder = new SqlScriptBuilder("public", "t");

    it.each([
      ["null", null],
      ["undefined", undefined],
      ["empty string", ""],
      ["whitespace only", "   "],
      ["quoted empty string", '""'],
    ])("should return NULL when the value is %s", (_label, value) => {
      expect(builder.formatSqlValue(value)).toBe("NULL");
    });

    it("should emit a bare number when the value is a JS number and no column type is known", () => {
      expect(builder.formatSqlValue(42)).toBe("42");
      expect(builder.formatSqlValue(-3.5)).toBe("-3.5");
    });

    it("should quote a numeric string when no column type is known", () => {
      expect(builder.formatSqlValue("42")).toBe("'42'");
    });

    it("should quote NaN because it is not a usable number", () => {
      expect(builder.formatSqlValue(Number.NaN)).toBe("'NaN'");
    });

    it("should escape single quotes by doubling them", () => {
      expect(builder.formatSqlValue("O'Higgins")).toBe("'O''Higgins'");
    });

    it("should clean surrounding quotes, float suffix and control characters before formatting", () => {
      expect(builder.formatSqlValue('"abc"')).toBe("'abc'");
      expect(builder.formatSqlValue("12.0")).toBe("'12'");
      expect(builder.formatSqlValue("a\tb\nc")).toBe("'abc'");
    });

    it("should repair mojibake before quoting", () => {
      expect(builder.formatSqlValue("Ã±")).toBe("'ñ'");
    });

    describe("with column types", () => {
      const typed = new SqlScriptBuilder("public", "t", {
        n_int: "integer",
        n_big: "bigint",
        n_num: "numeric(10,2)",
        n_dec: "decimal",
        n_flt: "double precision",
        n_real: "real",
        n_float: "float8",
        n_ser: "serial",
        txt: "text",
        vch: "character varying(20)",
      });

      it.each(["n_int", "n_big", "n_num", "n_dec", "n_flt", "n_real", "n_float", "n_ser"])(
        "should emit an unquoted number when column %s is numeric and the value is numeric",
        (column) => {
          expect(typed.formatSqlValue("7.50", column)).toBe("7.50");
          expect(typed.formatSqlValue(12, column)).toBe("12");
        }
      );

      it("should strip the .0 suffix of a numeric string for numeric columns", () => {
        expect(typed.formatSqlValue("1002.0", "n_int")).toBe("1002");
      });

      it("should quote the value when a numeric column receives a non-numeric string", () => {
        expect(typed.formatSqlValue("abc", "n_int")).toBe("'abc'");
        expect(typed.formatSqlValue("it's", "n_num")).toBe("'it''s'");
      });

      it.each(["txt", "vch"])("should quote numbers when column %s is textual", (column) => {
        expect(typed.formatSqlValue(5, column)).toBe("'5'");
        expect(typed.formatSqlValue("5", column)).toBe("'5'");
      });

      it("should match the numeric type case-insensitively", () => {
        const upper = new SqlScriptBuilder("public", "t", { id: "INTEGER" });

        expect(upper.formatSqlValue("3", "id")).toBe("3");
      });

      it("should fall back to the value type when the column is not in the type map", () => {
        expect(typed.formatSqlValue(9, "unknown")).toBe("9");
        expect(typed.formatSqlValue("9", "unknown")).toBe("'9'");
      });

      it("should fall back to the value type when no column name is given", () => {
        expect(typed.formatSqlValue(9)).toBe("9");
        expect(typed.formatSqlValue("9")).toBe("'9'");
      });

      it("should treat an empty type string as unknown", () => {
        const blank = new SqlScriptBuilder("public", "t", { c: "" });

        expect(blank.formatSqlValue(5, "c")).toBe("5");
        expect(blank.formatSqlValue("5", "c")).toBe("'5'");
      });

      it("should still return NULL for empty values on typed columns", () => {
        expect(typed.formatSqlValue("", "n_int")).toBe("NULL");
        expect(typed.formatSqlValue(null, "txt")).toBe("NULL");
      });
    });
  });

  describe("formatWhereCondition", () => {
    it("should use IS NULL when the value is empty", () => {
      const builder = new SqlScriptBuilder("public", "t");

      expect(builder.formatWhereCondition("suid", null)).toBe('"suid" IS NULL');
      expect(builder.formatWhereCondition("suid", "")).toBe('"suid" IS NULL');
    });

    it("should compare with equality for a quoted value", () => {
      const builder = new SqlScriptBuilder("public", "t");

      expect(builder.formatWhereCondition("name", "O'Neil")).toBe(`"name" = 'O''Neil'`);
    });

    it("should compare with an unquoted number for numeric columns", () => {
      const builder = new SqlScriptBuilder("public", "t", { id: "integer" });

      expect(builder.formatWhereCondition("id", "15")).toBe('"id" = 15');
    });
  });

  describe("serializeCompactGeoJson", () => {
    const builder = new SqlScriptBuilder("public", "t");

    it.each([[null], [undefined], ["text"], [5], [false]])("should return {} when the geometry is %j", (value) => {
      expect(builder.serializeCompactGeoJson(value)).toBe("{}");
    });

    it("should serialize an object geometry to JSON preserving float precision", () => {
      const geometry = { type: "Point", coordinates: [-56.123456789012345, -34.987654321098765] };

      expect(builder.serializeCompactGeoJson(geometry)).toBe(JSON.stringify(geometry));
    });
  });

  describe("buildPostgisGeomExpr", () => {
    const setSrid = (srid: number) => `ST_SetSRID(ST_GeomFromGeoJSON('${pointJson}'), ${srid})`;

    it("should set SRID 4326 without transform when the default builder has no source SRID", () => {
      const builder = new SqlScriptBuilder("public", "t");

      expect(builder.buildPostgisGeomExpr(point)).toBe(setSrid(4326));
    });

    it("should transform from the source SRID to the target SRID when they differ", () => {
      const builder = new SqlScriptBuilder("public", "t", undefined, 32721);

      expect(builder.buildPostgisGeomExpr(point, undefined, 4326)).toBe(`ST_Transform(${setSrid(4326)}, 32721)`);
    });

    it("should skip the transform when the source SRID equals the target SRID", () => {
      const builder = new SqlScriptBuilder("public", "t", undefined, 32721);

      expect(builder.buildPostgisGeomExpr(point, undefined, 32721)).toBe(setSrid(32721));
    });

    it("should assume the source already uses a non-4326 target SRID when no source SRID is given", () => {
      const builder = new SqlScriptBuilder("public", "t", undefined, 5381);

      expect(builder.buildPostgisGeomExpr(point)).toBe(setSrid(5381));
    });

    it.each([[0], [-1]])("should fall back to 4326 when the target SRID is %i", (srid) => {
      const builder = new SqlScriptBuilder("public", "t", undefined, srid);

      expect(builder.buildPostgisGeomExpr(point)).toBe(setSrid(4326));
    });

    it("should take the target SRID from the column type modifier", () => {
      const builder = new SqlScriptBuilder("public", "t", { geom: "geometry(Point,3857)" });

      expect(builder.buildPostgisGeomExpr(point, "geom", 4326)).toBe(`ST_Transform(${setSrid(4326)}, 3857)`);
    });

    it("should tolerate whitespace in the type modifier", () => {
      const builder = new SqlScriptBuilder("public", "t", { geom: "Geometry(Point, 3006 )" });

      expect(builder.buildPostgisGeomExpr(point, "geom", 3006)).toBe(setSrid(3006));
    });

    it("should ignore a type modifier SRID of 0 and keep the builder SRID", () => {
      const builder = new SqlScriptBuilder("public", "t", { geom: "geometry(Point,0)" }, 5381);

      expect(builder.buildPostgisGeomExpr(point, "geom", 5381)).toBe(setSrid(5381));
    });

    it("should keep the builder SRID when the column type has no modifier", () => {
      const builder = new SqlScriptBuilder("public", "t", { geom: "geometry" }, 5381);

      expect(builder.buildPostgisGeomExpr(point, "geom", 5381)).toBe(setSrid(5381));
    });

    it("should keep the builder SRID when the column is not in the type map", () => {
      const builder = new SqlScriptBuilder("public", "t", { other: "geometry(Point,3857)" });

      expect(builder.buildPostgisGeomExpr(point, "geom")).toBe(setSrid(4326));
    });

    it("should ignore column types when no target column is given", () => {
      const builder = new SqlScriptBuilder("public", "t", { geom: "geometry(Point,3857)" });

      expect(builder.buildPostgisGeomExpr(point)).toBe(setSrid(4326));
    });

    describe("ST_Multi wrapping", () => {
      const multiBuilder = new SqlScriptBuilder("public", "t", { geom: "geometry(MultiPolygon,4326)" });

      it.each(["Polygon", "LineString", "Point"])("should wrap a single %s in ST_Multi for a multi target", (type) => {
        const geometry = { type, coordinates: [] };

        expect(multiBuilder.buildPostgisGeomExpr(geometry, "geom")).toBe(
          `ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON('${JSON.stringify(geometry)}'), 4326))`
        );
      });

      it.each(["MultiPolygon", "MultiLineString", "MultiPoint", "GeometryCollection"])(
        "should not wrap a %s in ST_Multi",
        (type) => {
          const geometry = { type, coordinates: [] };

          expect(multiBuilder.buildPostgisGeomExpr(geometry, "geom")).toBe(
            `ST_SetSRID(ST_GeomFromGeoJSON('${JSON.stringify(geometry)}'), 4326)`
          );
        }
      );

      it("should not wrap a single geometry when the target column is not multi", () => {
        const builder = new SqlScriptBuilder("public", "t", { geom: "geometry(Polygon,4326)" });

        expect(builder.buildPostgisGeomExpr({ type: "Polygon", coordinates: [] }, "geom")).not.toContain("ST_Multi");
      });

      it("should wrap the transform when both the SRIDs differ and the target is multi", () => {
        const builder = new SqlScriptBuilder("public", "t", { geom: "geometry(MultiPolygon,32721)" });
        const geometry = { type: "Polygon", coordinates: [] };

        expect(builder.buildPostgisGeomExpr(geometry, "geom", 4326)).toBe(
          `ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('${JSON.stringify(geometry)}'), 4326), 32721))`
        );
      });

      it("should match the multi keyword case-insensitively", () => {
        const builder = new SqlScriptBuilder("public", "t", { geom: "GEOMETRY(MULTIPOLYGON,4326)" });

        expect(builder.buildPostgisGeomExpr({ type: "Polygon", coordinates: [] }, "geom")).toContain("ST_Multi(");
      });
    });

    it("should serialize a missing geometry as an empty GeoJSON object", () => {
      const builder = new SqlScriptBuilder("public", "t");

      expect(builder.buildPostgisGeomExpr(null)).toBe("ST_SetSRID(ST_GeomFromGeoJSON('{}'), 4326)");
    });

    it("should not wrap a missing geometry in ST_Multi even for a multi target", () => {
      const builder = new SqlScriptBuilder("public", "t", { geom: "geometry(MultiPolygon,4326)" });

      expect(builder.buildPostgisGeomExpr(undefined, "geom")).toBe("ST_SetSRID(ST_GeomFromGeoJSON('{}'), 4326)");
    });
  });

  describe("statement builders", () => {
    const builder = new SqlScriptBuilder("my_schema", "my_table");

    it("should build a composite UPDATE with quoted identifiers and the where clause", () => {
      const sql = builder.buildCompositeUpdateStatement(
        [
          { column: "a", valueExpr: "1" },
          { column: "b", valueExpr: "'x'" },
        ],
        '"id" = 5'
      );

      expect(sql).toBe(`UPDATE "my_schema"."my_table" SET "a" = 1, "b" = 'x' WHERE "id" = 5;`);
    });

    it("should build an UPDATE with a single assignment", () => {
      expect(builder.buildCompositeUpdateStatement([{ column: "a", valueExpr: "NULL" }], "true")).toBe(
        `UPDATE "my_schema"."my_table" SET "a" = NULL WHERE true;`
      );
    });

    it("should build an INSERT with columns and values in order", () => {
      expect(builder.buildInsertStatement(['"a"', '"b"'], ["1", "'x'"])).toBe(
        `INSERT INTO "my_schema"."my_table" ("a", "b") VALUES (1, 'x');`
      );
    });
  });
});
