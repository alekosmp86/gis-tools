import { describe, expect, it } from "vitest";
import {
  GeometrySourceKind,
  buildInsertSelectSql,
  buildTextGeometryParse,
  type GeometryPlan,
  type InsertColumnPlan,
} from "@/core/services/server/shpReplace/replaceSql";

const COLUMNS: InsertColumnPlan[] = [
  { targetColumn: "nombre", dataType: "text", kind: "source", stageColumn: "c0" },
  { targetColumn: "geom", dataType: "geometry", kind: "geometry" },
];

const PARSE = `CASE WHEN NULLIF("geom_json",'') ~ '^[0-9A-Fa-f]+$' THEN ST_GeomFromEWKB(decode(NULLIF("geom_json",''),'hex')) ELSE ST_GeomFromEWKT(NULLIF("geom_json",'')) END`;
const TEXT_SOURCE = `ST_SetSRID(${PARSE},COALESCE(NULLIF(ST_SRID(${PARSE}),0),32721))`;

const textSql = (plan: GeometryPlan): string =>
  buildInsertSelectSql("public", "parcelas", COLUMNS, plan, {
    table: "shp_replace_stage",
    geometry: GeometrySourceKind.TEXT,
  });

const geometrySelectOf = (sql: string): string => {
  const start = sql.indexOf(", ") + 2;
  return sql.slice(start, sql.lastIndexOf(" FROM "));
};

describe("replaceSql TEXT geometry source", () => {
  describe("CR-8: buildTextGeometryParse", () => {
    it("should decode hexadecimal cells as EWKB and parse everything else as EWKT", () => {
      expect(buildTextGeometryParse()).toBe(PARSE);
    });

    it("should read the cell through NULLIF so that empty strings become NULL", () => {
      expect(buildTextGeometryParse()).toContain(`NULLIF("geom_json",'')`);
    });
  });

  describe("CR-8: buildInsertSelectSql with GeometrySourceKind.TEXT", () => {
    it("should keep the SRID of the cell and default to the source SRID, then transform to the target SRID", () => {
      const sql = textSql({ sourceSrid: 32721, targetSrid: 4326, multi: false });

      expect(geometrySelectOf(sql)).toBe(`ST_Transform(${TEXT_SOURCE},4326)`);
    });

    it("should still transform when the source SRID equals the target SRID because the cell may carry another SRID", () => {
      const sql = textSql({ sourceSrid: 4326, targetSrid: 4326, multi: false });

      expect(geometrySelectOf(sql)).toContain("ST_Transform(");
      expect(geometrySelectOf(sql)).toContain(",4326)");
    });

    it("should wrap the transformed geometry in ST_Multi when the target accepts multi geometries", () => {
      const sql = textSql({ sourceSrid: 32721, targetSrid: 4326, multi: true });

      expect(geometrySelectOf(sql)).toBe(`ST_Multi(ST_Transform(${TEXT_SOURCE},4326))`);
    });

    it("should not wrap in ST_Multi when the target is a non-Multi type", () => {
      const sql = textSql({ sourceSrid: 32721, targetSrid: 4326, multi: false });

      expect(sql).not.toContain("ST_Multi");
    });

    it("should skip ST_Transform and keep the SRID-tagged geometry when the target SRID is 0", () => {
      const sql = textSql({ sourceSrid: 32721, targetSrid: 0, multi: false });

      expect(geometrySelectOf(sql)).toBe(TEXT_SOURCE);
      expect(sql).not.toContain("ST_Transform");
    });

    it("should combine ST_Multi with the unconstrained target when the target SRID is 0 and multi is true", () => {
      const sql = textSql({ sourceSrid: 32721, targetSrid: 0, multi: true });

      expect(geometrySelectOf(sql)).toBe(`ST_Multi(${TEXT_SOURCE})`);
    });

    it("should not use GeoJSON parsing when the source is TEXT", () => {
      expect(textSql({ sourceSrid: 32721, targetSrid: 4326, multi: false })).not.toContain("ST_GeomFromGeoJSON");
    });

    it("should select from the stage table ordered by rec", () => {
      expect(textSql({ sourceSrid: 32721, targetSrid: 4326, multi: false })).toMatch(
        / FROM "shp_replace_stage" ORDER BY "rec"$/
      );
    });

    it("should reject an invalid source SRID", () => {
      expect(() => textSql({ sourceSrid: 0, targetSrid: 4326, multi: false })).toThrowError(/SRID/);
    });

    it("should reject a target SRID above the ceiling", () => {
      expect(() => textSql({ sourceSrid: 4326, targetSrid: 999000, multi: false })).toThrowError(/SRID/);
    });

    it("should keep the GeoJSON expression for the default source so that the shapefile path is unchanged", () => {
      const sql = buildInsertSelectSql("public", "parcelas", COLUMNS, {
        sourceSrid: 32721,
        targetSrid: 4326,
        multi: false,
      });

      expect(sql).toContain(`ST_SetSRID(ST_GeomFromGeoJSON(NULLIF("geom_json",'')),32721)`);
    });

    it("should keep the non-geometry columns identical between the TEXT and the default source", () => {
      const plan: GeometryPlan = { sourceSrid: 32721, targetSrid: 4326, multi: false };

      const text = textSql(plan);
      const json = buildInsertSelectSql("public", "parcelas", COLUMNS, plan);

      expect(text.startsWith('INSERT INTO "public"."parcelas" ("nombre","geom") SELECT "c0", ')).toBe(true);
      expect(json.startsWith('INSERT INTO "public"."parcelas" ("nombre","geom") SELECT "c0", ')).toBe(true);
    });
  });
});
