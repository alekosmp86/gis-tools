import { describe, it, expect } from "vitest";
import {
  applyGeometryDefault,
  buildShapefileSourceColumns,
  SHP_GEOMETRY_LABEL,
} from "@/core/services/shpReplaceSource";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";
import { SHP_GEOMETRY_SOURCE as SERVER_SHP_GEOMETRY_SOURCE } from "@/core/services/server/shpReplace/shpRecordSource";
import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { DbColumnMetadata } from "@/core/types/db";

const col = (
  column_name: string,
  data_type: string,
  is_nullable = true,
  column_default: string | null = null
): DbColumnMetadata => ({ column_name, data_type, is_nullable, column_default });

describe("shpReplaceSource", () => {
  describe("SHP_GEOMETRY_SOURCE", () => {
    it("should be the same sentinel exported by the server record source", () => {
      expect(SHP_GEOMETRY_SOURCE).toBe("__geometry__");
      expect(SERVER_SHP_GEOMETRY_SOURCE).toBe(SHP_GEOMETRY_SOURCE);
    });
  });

  describe("SHP_GEOMETRY_LABEL", () => {
    it("should be the Spanish label shown for the geometry source", () => {
      expect(SHP_GEOMETRY_LABEL).toBe("Geometría del archivo");
    });
  });

  describe("buildShapefileSourceColumns", () => {
    it("should list DBF fields followed by the geometry sentinel when the file has geometry", () => {
      const result = buildShapefileSourceColumns(["NOMBRE", "AREA"], true);
      expect(result.columns).toEqual(["NOMBRE", "AREA", SHP_GEOMETRY_SOURCE]);
    });

    it("should type DBF fields as nullable text", () => {
      const result = buildShapefileSourceColumns(["NOMBRE"], false);
      expect(result.details).toEqual([
        expect.objectContaining({ column_name: "NOMBRE", data_type: "text", is_nullable: true }),
      ]);
    });

    it("should type the geometry entry as geometry", () => {
      const result = buildShapefileSourceColumns(["NOMBRE"], true);
      expect(result.details[1]).toEqual(
        expect.objectContaining({ column_name: SHP_GEOMETRY_SOURCE, data_type: "geometry" })
      );
    });

    it("should omit the geometry entry when the file has no geometry", () => {
      const result = buildShapefileSourceColumns(["NOMBRE", "AREA"], false);
      expect(result.columns).toEqual(["NOMBRE", "AREA"]);
      expect(result.details.map((detail) => detail.column_name)).toEqual(["NOMBRE", "AREA"]);
    });

    it("should keep details aligned one-to-one with columns", () => {
      const result = buildShapefileSourceColumns(["A", "B", "C"], true);
      expect(result.details.map((detail) => detail.column_name)).toEqual(result.columns);
    });

    it("should de-duplicate repeated DBF field names keeping the first occurrence", () => {
      const result = buildShapefileSourceColumns(["A", "B", "A"], false);
      expect(result.columns).toEqual(["A", "B"]);
      expect(result.details.map((detail) => detail.column_name)).toEqual(["A", "B"]);
    });

    it("should keep DBF field names as-is without trimming or renaming them", () => {
      const result = buildShapefileSourceColumns(["COD_MUNICI"], false);
      expect(result.columns).toEqual(["COD_MUNICI"]);
    });

    it("should return only the geometry entry when there are no attributes but there is geometry", () => {
      const result = buildShapefileSourceColumns([], true);
      expect(result.columns).toEqual([SHP_GEOMETRY_SOURCE]);
      expect(result.details).toHaveLength(1);
    });

    it("should return empty columns and details when there are no attributes and no geometry", () => {
      const result = buildShapefileSourceColumns([], false);
      expect(result).toEqual({ columns: [], details: [] });
    });
  });

  describe("applyGeometryDefault", () => {
    const targetWithGeometry = [col("id", "integer", false), col("nombre", "text"), col("geom", "geometry(MultiPolygon,32721)")];

    it("should map the single target geometry column to the geometry sentinel when it is unmapped", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { id: "ID", nombre: "NOMBRE", geom: null }, defaults: {} };
      const result = applyGeometryDefault(mapping, targetWithGeometry, true);
      expect(result.sourceByTarget.geom).toBe(SHP_GEOMETRY_SOURCE);
    });

    it("should map the geometry sentinel when the target geometry key is absent from the mapping", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { id: "ID", nombre: "NOMBRE" }, defaults: {} };
      const result = applyGeometryDefault(mapping, targetWithGeometry, true);
      expect(result.sourceByTarget.geom).toBe(SHP_GEOMETRY_SOURCE);
    });

    it("should keep the existing source when the target geometry column is already mapped", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { geom: "OTHER_FIELD" }, defaults: {} };
      const result = applyGeometryDefault(mapping, targetWithGeometry, true);
      expect(result.sourceByTarget.geom).toBe("OTHER_FIELD");
    });

    it("should leave other mapped columns untouched", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { id: "ID", nombre: "NOMBRE", geom: null }, defaults: {} };
      const result = applyGeometryDefault(mapping, targetWithGeometry, true);
      expect(result.sourceByTarget).toEqual({ id: "ID", nombre: "NOMBRE", geom: SHP_GEOMETRY_SOURCE });
    });

    it("should map a geography target column as geometry", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { geog: null }, defaults: {} };
      const result = applyGeometryDefault(mapping, [col("geog", "geography(Point,4326)")], true);
      expect(result.sourceByTarget.geog).toBe(SHP_GEOMETRY_SOURCE);
    });

    it("should return the mapping unchanged when the file has no geometry", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { geom: null }, defaults: {} };
      const result = applyGeometryDefault(mapping, targetWithGeometry, false);
      expect(result).toEqual(mapping);
    });

    it("should return the mapping unchanged when the target has no geometry column", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { nombre: null }, defaults: {} };
      const result = applyGeometryDefault(mapping, [col("nombre", "text")], true);
      expect(result).toEqual(mapping);
    });

    it("should return the mapping unchanged when the target has more than one geometry column", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { geom: null, geom_b: null }, defaults: {} };
      const targets = [col("geom", "geometry(Point,4326)"), col("geom_b", "geometry(Polygon,4326)")];
      const result = applyGeometryDefault(mapping, targets, true);
      expect(result).toEqual(mapping);
    });

    it("should not treat a text column whose name contains geom as geometry", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { geom_txt: null }, defaults: {} };
      const result = applyGeometryDefault(mapping, [col("geom_txt", "text")], true);
      expect(result).toEqual(mapping);
    });

    it("should return a new object and not mutate the input mapping", () => {
      const mapping: ReplaceColumnMapping = { sourceByTarget: { geom: null }, defaults: {} };
      const result = applyGeometryDefault(mapping, [col("geom", "geometry")], true);
      expect(result).not.toBe(mapping);
      expect(result.sourceByTarget).not.toBe(mapping.sourceByTarget);
      expect(mapping.sourceByTarget.geom).toBeNull();
    });

    it("should preserve fixed defaults unchanged", () => {
      const fixed = { fieldName: "estado", value: "activo", useRawExpression: false };
      const mapping: ReplaceColumnMapping = { sourceByTarget: { geom: null }, defaults: { estado: fixed } };
      const result = applyGeometryDefault(mapping, [col("geom", "geometry")], true);
      expect(result.defaults).toEqual({ estado: fixed });
    });
  });
});
