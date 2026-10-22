import { describe, it, expect } from "vitest";
import {
  openShapefileZip,
  SHP_GEOMETRY_SOURCE,
  type OpenShapefile,
  type ShpRecordRow,
} from "@/core/services/server/shpReplace/shpRecordSource";
import { buildDbfBuffer, type DbfFieldSpec } from "../../../binary/support/dbfBuilder";
import { buildShpBuffer, nullRecord, pointRecord, polygonRecord } from "../../../binary/support/shpBuilder";
import { buildStoredZip, type StoredZipEntry } from "../../../binary/support/storedZip";

interface ShapefileZipParts {
  readonly shp?: Uint8Array;
  readonly dbf?: Uint8Array;
  readonly prj?: string;
  readonly cpg?: string;
}

const FIELDS: DbfFieldSpec[] = [
  { name: "SUID", type: "C", length: 10 },
  { name: "NOMBRE", type: "C", length: 30 },
  { name: "AREA", type: "N", length: 12, decimalCount: 2 },
  { name: "FECHA", type: "D", length: 8 },
  { name: "ACTIVO", type: "L", length: 1 },
];

const SQUARE_RING: number[][] = [
  [500000, 4649000],
  [500000, 4649010],
  [500010, 4649010],
  [500010, 4649000],
  [500000, 4649000],
];

function toBytes(buffer: ArrayBuffer): Uint8Array {
  return new Uint8Array(buffer);
}

function buildShapefileZip(parts: ShapefileZipParts): Uint8Array {
  const base = "parcelas";
  const entries: StoredZipEntry[] = [];
  const encoder = new TextEncoder();
  if (parts.shp) entries.push({ name: `${base}.shp`, data: parts.shp });
  if (parts.dbf) entries.push({ name: `${base}.dbf`, data: parts.dbf });
  if (parts.prj !== undefined) entries.push({ name: `${base}.prj`, data: encoder.encode(parts.prj) });
  if (parts.cpg !== undefined) entries.push({ name: `${base}.cpg`, data: encoder.encode(parts.cpg) });
  return buildStoredZip(entries);
}

async function collectRows(source: OpenShapefile): Promise<ShpRecordRow[]> {
  return [...source.records()];
}

describe("shpRecordSource", () => {
  describe("openShapefileZip", () => {
    describe("metadata", () => {
      it("should expose the DBF field names in file order when shp and dbf are present", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { SUID: "1" } }] });
        const shp = toBytes(buildShpBuffer([pointRecord([500000, 4649000])]));

        const source = await openShapefileZip(buildShapefileZip({ shp, dbf }));

        expect(source.fieldNames).toEqual(["SUID", "NOMBRE", "AREA", "FECHA", "ACTIVO"]);
      });

      it("should report the DBF header record count including deleted records", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [
            { values: { SUID: "1" } },
            { values: { SUID: "2" }, deleted: true },
            { values: { SUID: "3" } },
          ],
        });
        const shp = toBytes(
          buildShpBuffer([pointRecord([1, 1]), pointRecord([2, 2]), pointRecord([3, 3])])
        );

        const source = await openShapefileZip(buildShapefileZip({ shp, dbf }));

        expect(source.recordCount).toBe(3);
      });

      it("should expose the .shp record count separately when the .shp has fewer records than the .dbf", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [{ values: { SUID: "1" } }, { values: { SUID: "2" } }, { values: { SUID: "3" } }],
        });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1]), pointRecord([2, 2])]));

        const source = await openShapefileZip(buildShapefileZip({ shp, dbf }));

        expect(source.recordCount).toBe(3);
        expect(source.shapeRecordCount).toBe(2);
      });

      it("should expose a shape record count equal to the DBF count when both files agree", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [{ values: { SUID: "1" } }, { values: { SUID: "2" } }],
        });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1]), pointRecord([2, 2])]));

        const source = await openShapefileZip(buildShapefileZip({ shp, dbf }));

        expect(source.shapeRecordCount).toBe(source.recordCount);
        expect(source.shapeRecordCount).toBe(2);
      });

      it("should return the .prj text verbatim when a .prj entry is present", async () => {
        const prj = 'GEOGCS["GCS_ETRS_1989",DATUM["D_ETRS_1989"]]';
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { SUID: "1" } }] });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        const source = await openShapefileZip(buildShapefileZip({ shp, dbf, prj }));

        expect(source.prjText).toBe(prj);
      });

      it("should return null prjText when no .prj entry is present", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { SUID: "1" } }] });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        const source = await openShapefileZip(buildShapefileZip({ shp, dbf }));

        expect(source.prjText).toBeNull();
      });

      it("should accept upper-case entry names when the extensions are .SHP and .DBF", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { SUID: "A" } }] });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        const source = await openShapefileZip(
          buildStoredZip([
            { name: "PARCELAS.SHP", data: shp },
            { name: "PARCELAS.DBF", data: dbf },
          ])
        );

        expect(source.recordCount).toBe(1);
        expect(source.fieldNames).toEqual(FIELDS.map((field) => field.name));
      });
    });

    describe("records", () => {
      it("should yield one row per record with 1-based rec numbers when no record is deleted", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [{ values: { SUID: "A" } }, { values: { SUID: "B" } }],
        });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1]), pointRecord([2, 2])]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(rows.map((row) => row.rec)).toEqual([1, 2]);
      });

      it("should skip deleted DBF records while keeping the original 1-based rec numbers", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [
            { values: { SUID: "A" } },
            { values: { SUID: "B" }, deleted: true },
            { values: { SUID: "C" } },
          ],
        });
        const shp = toBytes(
          buildShpBuffer([pointRecord([1, 1]), pointRecord([2, 2]), pointRecord([3, 3])])
        );

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(rows.map((row) => row.rec)).toEqual([1, 3]);
        expect(rows.map((row) => row.values.SUID)).toEqual(["A", "C"]);
      });

      it("should yield an empty list when every DBF record is deleted", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [{ values: { SUID: "A" }, deleted: true }],
        });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        const source = await openShapefileZip(buildShapefileZip({ shp, dbf }));

        expect(await collectRows(source)).toEqual([]);
      });

      it("should yield every field name as a key of each row's values", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { SUID: "A" } }] });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(Object.keys(rows[0].values).sort()).toEqual([...FIELDS.map((field) => field.name)].sort());
      });

      it("should yield the same rows when records() is called a second time", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [{ values: { SUID: "A" } }, { values: { SUID: "B" } }],
        });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1]), pointRecord([2, 2])]));
        const source = await openShapefileZip(buildShapefileZip({ shp, dbf }));

        const first = await collectRows(source);
        const second = await collectRows(source);

        expect(second).toEqual(first);
      });

      it("should trim padded text and keep interior spaces when a text cell is space padded", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [{ values: { SUID: "  7  ", NOMBRE: "Calle Mayor 12" } }],
        });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(rows[0].values.SUID).toBe("7");
        expect(rows[0].values.NOMBRE).toBe("Calle Mayor 12");
      });

      it("should stringify numeric DBF values when the field is numeric", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [
            { values: { AREA: "12.50" } },
            { values: { AREA: "0.00" } },
            { values: { AREA: "-7.5" } },
          ],
        });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1]), pointRecord([2, 2]), pointRecord([3, 3])]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(rows.map((row) => row.values.AREA)).toEqual(["12.5", "0", "-7.5"]);
      });

      it("should format date DBF values as YYYY-MM-DD when the field is a date", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { FECHA: "20240131" } }] });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(rows[0].values.FECHA).toBe("2024-01-31");
      });

      it("should stringify logical DBF values as text when the field is logical", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [{ values: { ACTIVO: "T" } }, { values: { ACTIVO: "F" } }],
        });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1]), pointRecord([2, 2])]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(rows.map((row) => row.values.ACTIVO)).toEqual(["true", "false"]);
      });

      it("should return null for a blank DBF cell", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { NOMBRE: "" } }] });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(rows[0].values.NOMBRE).toBeNull();
      });

      it("should decode text with windows-1252 when no .cpg entry is present", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [{ values: { NOMBRE: "Peña Blanca" } }],
          encoding: "windows-1252",
        });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(rows[0].values.NOMBRE).toBe("Peña Blanca");
      });

      it("should decode text with the .cpg encoding when a .cpg entry declares UTF-8", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [{ values: { NOMBRE: "Peña Blanca" } }],
          encoding: "utf-8",
        });
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        const rows = await collectRows(
          await openShapefileZip(buildShapefileZip({ shp, dbf, cpg: "UTF-8" }))
        );

        expect(rows[0].values.NOMBRE).toBe("Peña Blanca");
      });
    });

    describe("geometryJson", () => {
      it("should return GeoJSON Point coordinates in the raw file CRS without transformation", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { SUID: "A" } }] });
        const shp = toBytes(buildShpBuffer([pointRecord([500000.5, 4649000.25])]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(JSON.parse(rows[0].geometryJson as string)).toEqual({
          type: "Point",
          coordinates: [500000.5, 4649000.25],
        });
      });

      it("should return GeoJSON Polygon geometry for a polygon record", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { SUID: "A" } }] });
        const shp = toBytes(buildShpBuffer([polygonRecord([SQUARE_RING])]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(JSON.parse(rows[0].geometryJson as string)).toEqual({
          type: "Polygon",
          coordinates: [SQUARE_RING],
        });
      });

      it("should return null geometryJson when the shape record is NULL", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { SUID: "A" } }] });
        const shp = toBytes(buildShpBuffer([nullRecord()]));

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(rows[0].geometryJson).toBeNull();
      });

      it("should keep each geometry aligned with its DBF row when a NULL shape sits between shapes", async () => {
        const dbf = buildDbfBuffer({
          fields: FIELDS,
          records: [{ values: { SUID: "A" } }, { values: { SUID: "B" } }, { values: { SUID: "C" } }],
        });
        const shp = toBytes(
          buildShpBuffer([pointRecord([1, 2]), nullRecord(), polygonRecord([SQUARE_RING])])
        );

        const rows = await collectRows(await openShapefileZip(buildShapefileZip({ shp, dbf })));

        expect(rows.map((row) => row.values.SUID)).toEqual(["A", "B", "C"]);
        expect(rows[0].geometryJson).toBe(JSON.stringify({ type: "Point", coordinates: [1, 2] }));
        expect(rows[1].geometryJson).toBeNull();
        expect(JSON.parse(rows[2].geometryJson as string).type).toBe("Polygon");
      });

      it("should expose the geometry source constant as a double-underscore sentinel", () => {
        expect(SHP_GEOMETRY_SOURCE).toBe("__geometry__");
      });
    });

    describe("errors", () => {
      it("should reject with an Error naming .shp when the zip has no .shp entry", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [{ values: { SUID: "A" } }] });

        await expect(openShapefileZip(buildShapefileZip({ dbf }))).rejects.toThrow(/\.shp/i);
      });

      it("should reject with an Error naming .dbf when the zip has no .dbf entry", async () => {
        const shp = toBytes(buildShpBuffer([pointRecord([1, 1])]));

        await expect(openShapefileZip(buildShapefileZip({ shp }))).rejects.toThrow(/\.dbf/i);
      });

      it("should reject with the Spanish message when the DBF and SHP hold zero records", async () => {
        const dbf = buildDbfBuffer({ fields: FIELDS, records: [] });
        const shp = toBytes(buildShpBuffer([]));

        await expect(openShapefileZip(buildShapefileZip({ shp, dbf }))).rejects.toThrow(
          "El archivo no contiene registros"
        );
      });

      it("should reject with an Error when the bytes are not a ZIP archive", async () => {
        await expect(openShapefileZip(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toThrow(Error);
      });

      it("should reject with an Error when the zip is empty", async () => {
        await expect(openShapefileZip(buildStoredZip([]))).rejects.toThrow(Error);
      });
    });
  });
});
