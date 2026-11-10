import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openCsvFile } from "@/core/services/server/csvReplace/csvRecordSource";
import { GeometrySourceKind } from "@/core/services/server/shpReplace/replaceSql";

const EWKB_HEX = "0101000020E6100000000000000000F03F0000000000000040";

describe("csvRecordSource", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "csv-source-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const open = (content: string | Uint8Array) => {
    const filePath = path.join(dir, "datos.csv");
    writeFileSync(filePath, content);
    return openCsvFile(filePath);
  };

  const rowsOf = (content: string | Uint8Array) => Array.from(open(content).records());

  describe("CR-4: encoding", () => {
    it("should drop the BOM so that the first header has its clean name", () => {
      const source = open(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("id,nombre\n1,a\n")]));

      expect(source.fieldNames).toEqual(["id", "nombre"]);
    });

    it("should refuse a Latin-1 file with a Spanish UTF-8 error when the source is opened", () => {
      expect(() => open(Buffer.from("id,nombre\n1,Mu\xf1oz\n", "latin1"))).toThrowError(/UTF-8/);
    });

    it("should refuse the file at open time even when the invalid byte is on the last line of a large file", () => {
      const body = Buffer.from("1,fila\n".repeat(20000));
      const bytes = Buffer.concat([Buffer.from("id,nombre\n"), body, Buffer.from([0x39, 0x2c, 0xe9, 0x0a])]);

      expect(() => open(bytes)).toThrowError(/UTF-8/);
    });

    it("should keep accents and ñ intact when the file is UTF-8", () => {
      const rows = rowsOf("id,nombre\n1,Muñoz Ávila\n");

      expect(rows[0].values.nombre).toBe("Muñoz Ávila");
    });
  });

  describe("CR-5: delimiters and headers", () => {
    it.each([
      ["comma", "id,nombre\n1,Ana\n"],
      ["semicolon", "id;nombre\n1;Ana\n"],
      ["tab", "id\tnombre\n1\tAna\n"],
    ])("should read the same rows when the delimiter is a %s", (_label, content) => {
      const source = open(content);

      expect(source.fieldNames).toEqual(["id", "nombre"]);
      expect(Array.from(source.records())[0].values).toEqual({ id: "1", nombre: "Ana" });
    });

    it("should trim whitespace around header names but keep cell values untouched", () => {
      const source = open("id , nombre \n1, Ana \n");

      expect(source.fieldNames).toEqual(["id", "nombre"]);
      expect(Array.from(source.records())[0].values).toEqual({ id: "1", nombre: " Ana " });
    });

    it("should refuse the file with a Spanish error naming the header when two headers are equal", () => {
      expect(() => open("id,nombre,id\n1,a,2\n")).toThrowError(/"id" está repetido/);
    });

    it("should refuse headers that only collide after trimming", () => {
      expect(() => open("id, id \n1,2\n")).toThrowError(/repetido/);
    });

    it("should refuse an empty file with a Spanish error", () => {
      expect(() => open("")).toThrowError(/vacío/);
    });

    it("should refuse a file made only of blank lines as empty", () => {
      expect(() => open("\n\r\n\n")).toThrowError(/vacío/);
    });

    it("should refuse a header-only file with a Spanish no-data-rows error", () => {
      expect(() => open("id,nombre\n")).toThrowError(/no contiene filas de datos/);
    });

    it("should refuse a header followed only by blank lines", () => {
      expect(() => open("id,nombre\n\n\n")).toThrowError(/no contiene filas de datos/);
    });
  });

  describe("CR-6: field count and numbering", () => {
    it("should throw an error with the physical line number when a row has fewer fields than the header", () => {
      expect(() => open("a,b,c\n1,2,3\n4,5\n")).toThrowError("La línea 3 tiene 2 campos y el encabezado tiene 3.");
    });

    it("should throw an error with the physical line number when a row has more fields than the header", () => {
      expect(() => open("a,b\n1,2,3\n")).toThrowError("La línea 2 tiene 3 campos y el encabezado tiene 2.");
    });

    it("should count blank lines and embedded line breaks in the reported line number", () => {
      const content = 'a,b\n"x\ny",1\n\n\n9\n';

      expect(() => open(content)).toThrowError("La línea 6 tiene 1 campos y el encabezado tiene 2.");
    });

    it("should throw the unclosed quote error when a quote is never closed", () => {
      expect(() => open('a,b\n1,"2\n')).toThrowError(/comilla abierta en la línea 2/);
    });

    it("should number rec from 1 and skip blank lines without leaving gaps", () => {
      const rows = rowsOf("id\n10\n\n20\n\n30\n");

      expect(rows.map((row) => row.rec)).toEqual([1, 2, 3]);
      expect(rows.map((row) => row.values.id)).toEqual(["10", "20", "30"]);
    });

    it("should report recordCount equal to the number of data rows", () => {
      const source = open("id\n1\n2\n\n3\n");

      expect(source.recordCount).toBe(3);
    });

    it("should be re-iterable and give the same rows on each call", () => {
      const source = open("id,n\n1,a\n2,b\n");

      expect(Array.from(source.records())).toEqual(Array.from(source.records()));
    });

    it("should read quoted cells with delimiters, quotes and line breaks as single values", () => {
      const rows = rowsOf('id,txt\n1,"a,b ""q"" \nz"\n');

      expect(rows[0].values.txt).toBe('a,b "q" \nz');
    });

    it("should keep empty cells as empty strings", () => {
      const rows = rowsOf("a,b\n1,\n");

      expect(rows[0].values).toEqual({ a: "1", b: "" });
    });

    it("should read CRLF files without carriage returns in the last cell", () => {
      const rows = rowsOf("a,b\r\n1,2\r\n3,4\r\n");

      expect(rows.map((row) => row.values.b)).toEqual(["2", "4"]);
    });
  });

  describe("CR-8: geometry from a geometry column", () => {
    it("should expose a text geometry source with CSV wording when a geom column exists", () => {
      const source = open(`id,geom\n1,${EWKB_HEX}\n`);

      expect(source.hasGeometry).toBe(true);
      expect(source.geometryFormat).toBe(GeometrySourceKind.TEXT);
      expect(source.wording?.geometryName).toBe("CSV");
      expect(source.wording?.missingFields).toBe("Columnas del CSV");
    });

    it("should report no geometry when the file has neither a geometry column nor a coordinate pair", () => {
      const source = open("id,nombre\n1,a\n");

      expect(source.hasGeometry).toBe(false);
      expect(Array.from(source.records())[0].geometryJson).toBeNull();
    });

    it.each([
      ["plain hex", EWKB_HEX, EWKB_HEX],
      ["a \\x prefix", `\\x${EWKB_HEX}`, EWKB_HEX],
      ["an upper-case \\X prefix", `\\X${EWKB_HEX}`, EWKB_HEX],
      ["a 0x prefix", `0x${EWKB_HEX}`, EWKB_HEX],
      ["a 0X prefix", `0X${EWKB_HEX}`, EWKB_HEX],
      ["surrounding spaces", `  ${EWKB_HEX} `, EWKB_HEX],
    ])("should give the bare hex when the cell has %s", (_label, cell, expected) => {
      const rows = rowsOf(`id,geom\n1,${cell}\n`);

      expect(rows[0].geometryJson).toBe(expected);
    });

    it("should leave a WKT cell untouched", () => {
      const rows = rowsOf('id,wkt\n1,"POINT(-56.2 -34.9)"\n');

      expect(rows[0].geometryJson).toBe("POINT(-56.2 -34.9)");
    });

    it("should leave an EWKT cell untouched", () => {
      const rows = rowsOf('id,geom\n1,"SRID=4326;POINT(1 2)"\n');

      expect(rows[0].geometryJson).toBe("SRID=4326;POINT(1 2)");
    });

    it("should not strip a 0x prefix when the rest is not hexadecimal", () => {
      const rows = rowsOf("id,geom\n1,0xZZ\n");

      expect(rows[0].geometryJson).toBe("0xZZ");
    });

    it.each([
      ["empty", ""],
      ["blank", "   "],
    ])("should give a null geometry when the cell is %s", (_label, cell) => {
      const rows = rowsOf(`id,geom\n1,${cell}\n`);

      expect(rows[0].geometryJson).toBeNull();
    });

    it.each(["geom", "GEOMETRY", "wkt", "the_geom", "wkb_geometry", "geom_wkt", "geom_wkb"])(
      "should recognise %s as the geometry column",
      (header) => {
        const source = open(`id,${header}\n1,POINT(1 2)\n`);

        expect(source.hasGeometry).toBe(true);
        expect(Array.from(source.records())[0].geometryJson).toBe("POINT(1 2)");
      }
    );

    it("should still expose the geometry column among the field names", () => {
      expect(open("id,geom\n1,POINT(1 2)\n").fieldNames).toEqual(["id", "geom"]);
    });
  });

  describe("CR-9: geometry from latitude and longitude", () => {
    it("should build POINT(lng lat) when both coordinates are numeric", () => {
      const rows = rowsOf("id,lat,lon\n1,-34.9011,-56.1645\n");

      expect(rows[0].geometryJson).toBe("POINT(-56.1645 -34.9011)");
    });

    it("should accept decimal commas when the delimiter is a semicolon", () => {
      const rows = rowsOf("id;latitud;longitud\n1;-34,9011;-56,1645\n");

      expect(rows[0].geometryJson).toBe("POINT(-56.1645 -34.9011)");
    });

    it("should accept decimal commas in quoted cells of a comma-delimited file", () => {
      const rows = rowsOf('id,lat,lng\n1,"-34,5","-56,25"\n');

      expect(rows[0].geometryJson).toBe("POINT(-56.25 -34.5)");
    });

    it("should expose the text geometry source when only the coordinate pair exists", () => {
      const source = open("id,lat,lng\n1,1,2\n");

      expect(source.hasGeometry).toBe(true);
      expect(source.geometryFormat).toBe(GeometrySourceKind.TEXT);
    });

    it("should give a null geometry when both coordinates are empty on a row", () => {
      const rows = rowsOf("id,lat,lon\n1,,\n2, , \n");

      expect(rows.map((row) => row.geometryJson)).toEqual([null, null]);
    });

    it("should throw an error naming the data row when only the latitude is present", () => {
      expect(() => rowsOf("id,lat,lon\n1,1,2\n2,5,\n")).toThrowError(/La fila 2 tiene solo una de las coordenadas/);
    });

    it("should throw an error naming the data row when only the longitude is present", () => {
      expect(() => rowsOf("id,lat,lon\n1,,7\n")).toThrowError(/La fila 1 tiene solo una de las coordenadas/);
    });

    it("should throw an error naming the data row and the label when the latitude is not numeric", () => {
      expect(() => rowsOf("id,lat,lon\n1,abc,2\n")).toThrowError(/La fila 1 tiene una latitud no numérica: "abc"/);
    });

    it("should throw an error naming the data row and the label when the longitude is not numeric", () => {
      expect(() => rowsOf("id,lat,lon\n1,1,xyz\n")).toThrowError(/La fila 1 tiene una longitud no numérica: "xyz"/);
    });

    it("should throw when a coordinate is not finite", () => {
      expect(() => rowsOf("id,lat,lon\n1,Infinity,2\n")).toThrowError(/no numérica/);
    });

    it("should use the geometry column and ignore the coordinates when both are present and the geometry is filled", () => {
      const rows = rowsOf("id,geom,lat,lon\n1,POINT(9 9),1,2\n");

      expect(rows[0].geometryJson).toBe("POINT(9 9)");
    });

    it("should fall back to the coordinates when the geometry cell is empty and the pair is present", () => {
      const rows = rowsOf("id,geom,lat,lon\n1,,1,2\n");

      expect(rows[0].geometryJson).toBe("POINT(2 1)");
    });

    it("should report no geometry when only a latitude column exists without a longitude column", () => {
      const source = open("id,lat\n1,5\n");

      expect(source.hasGeometry).toBe(false);
    });

    it("should number rows by data row, not by physical line, in coordinate errors", () => {
      expect(() => rowsOf("id,lat,lon\n\n\n1,1,2\n2,x,3\n")).toThrowError(/La fila 2 /);
    });
  });
});
