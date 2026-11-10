import { describe, expect, it } from "vitest";
import {
  detectCsvDelimiter,
  hasSpatialColumns,
  resolveSpatialColumnHeaders,
} from "@/core/services/parsers/csvDialect";
import { CsvParser } from "@/core/services/parsers/CsvParser";

describe("csvDialect", () => {
  describe("CR-5: detectCsvDelimiter", () => {
    it.each([
      ["id,nombre,zona", ","],
      ["id;nombre;zona", ";"],
      ["id\tnombre\tzona", "\t"],
    ])("should detect the delimiter of %j as %j", (line, expected) => {
      expect(detectCsvDelimiter(line)).toBe(expected);
    });

    it("should default to comma when the line has no delimiter at all", () => {
      expect(detectCsvDelimiter("solo_una_columna")).toBe(",");
    });

    it("should default to comma when the line is empty", () => {
      expect(detectCsvDelimiter("")).toBe(",");
    });

    it("should default to comma when the counts tie", () => {
      expect(detectCsvDelimiter("a,b;c")).toBe(",");
      expect(detectCsvDelimiter("a;b\tc")).toBe(",");
    });

    it("should ignore delimiters inside quotes when counting", () => {
      expect(detectCsvDelimiter('"a,b,c,d";e;f')).toBe(";");
    });

    it("should pick the semicolon when it outnumbers commas used as decimal separators", () => {
      expect(detectCsvDelimiter("id;1,5;2,5;x")).toBe(";");
    });

    it("should pick tab over comma when tabs are more frequent", () => {
      expect(detectCsvDelimiter("a\tb\tc,d")).toBe("\t");
    });
  });

  describe("CR-9: resolveSpatialColumnHeaders", () => {
    it.each(["geom", "GEOMETRY", "Wkt", "wkb_geometry", "the_geom", "geom_wkt", "geom_wkb"])(
      "should recognise %s as the geometry column",
      (header) => {
        expect(resolveSpatialColumnHeaders(["id", header]).geomColHeader).toBe(header);
      }
    );

    it.each(["lat", "Latitude", "latitud", "y_coord", "Y"])("should recognise %s as the latitude column", (header) => {
      expect(resolveSpatialColumnHeaders(["id", header]).latColHeader).toBe(header);
    });

    it.each(["lng", "lon", "long", "Longitude", "longitud", "x_coord", "X"])(
      "should recognise %s as the longitude column",
      (header) => {
        expect(resolveSpatialColumnHeaders(["id", header]).lngColHeader).toBe(header);
      }
    );

    it("should match headers regardless of surrounding spaces and return the original header", () => {
      expect(resolveSpatialColumnHeaders([" lat ", " lon "])).toMatchObject({ latColHeader: " lat ", lngColHeader: " lon " });
    });

    it("should return undefined for each role when no header matches", () => {
      expect(resolveSpatialColumnHeaders(["id", "nombre", "latitud_x"])).toEqual({
        geomColHeader: undefined,
        latColHeader: undefined,
        lngColHeader: undefined,
      });
    });

    it("should return all undefined when there are no headers", () => {
      expect(resolveSpatialColumnHeaders([])).toEqual({
        geomColHeader: undefined,
        latColHeader: undefined,
        lngColHeader: undefined,
      });
    });

    it("should pick the first header when several match the same role", () => {
      expect(resolveSpatialColumnHeaders(["wkt", "geom"]).geomColHeader).toBe("wkt");
    });
  });

  describe("CR-9: hasSpatialColumns", () => {
    it("should be true when a geometry column exists", () => {
      expect(hasSpatialColumns(["id", "geom"])).toBe(true);
    });

    it("should be true when both latitude and longitude exist", () => {
      expect(hasSpatialColumns(["id", "lat", "lon"])).toBe(true);
    });

    it("should be false when only one coordinate column exists", () => {
      expect(hasSpatialColumns(["id", "lat"])).toBe(false);
      expect(hasSpatialColumns(["id", "lon"])).toBe(false);
    });

    it("should be false when there are no spatial headers", () => {
      expect(hasSpatialColumns(["id", "nombre"])).toBe(false);
    });
  });

  describe("CR-5: CsvParser regression after extracting the dialect functions", () => {
    const parser = new CsvParser();
    const parse = (content: string, name = "datos.csv") => parser.parse(new File([content], name, { type: "text/csv" }));

    it.each([
      ["comma", "id,nombre\n1,Ana\n2,Beto"],
      ["semicolon", "id;nombre\n1;Ana\n2;Beto"],
      ["tab", "id\tnombre\n1\tAna\n2\tBeto"],
    ])("should parse the same attributes and rows for a %s file", async (_label, content) => {
      const parsed = await parse(content);

      expect(parsed.attributes).toEqual(["id", "nombre"]);
      expect(parsed.featureCount).toBe(2);
      expect(parsed.recordsMap.get("2")?.nombre).toBe("Beto");
    });

    it("should still detect the geometry column through the shared header resolver", async () => {
      const parsed = await parse("id,wkt\n1,POINT(-56.1 -34.9)");

      expect(parsed.geometryType).toBe("Point");
      expect(parsed.geojson?.features).toHaveLength(1);
    });

    it("should still build points from the shared latitude and longitude resolver", async () => {
      const parsed = await parse("id,latitud,longitud\n1,-34.9,-56.1");

      expect(parsed.geojson?.features[0]?.geometry.type).toBe("Point");
    });

    it("should not produce geometry when the file has no spatial columns", async () => {
      const parsed = await parse("id,nombre\n1,Ana");

      expect(parsed.geojson?.features ?? []).toHaveLength(0);
    });

    it("should agree with detectCsvDelimiter about a quoted header that contains commas", async () => {
      const content = 'id;"a,b,c";x\n1;2;3';

      expect(detectCsvDelimiter(content.split("\n")[0])).toBe(";");
      expect((await parse(content)).attributes).toEqual(["id", "a,b,c", "x"]);
    });

    it("should still reject an empty file with the Spanish error", async () => {
      await expect(parse("")).rejects.toThrowError("El archivo CSV está vacío.");
    });
  });
});
