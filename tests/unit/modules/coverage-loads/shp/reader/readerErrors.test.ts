import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import {
  CorruptShapefileError,
  NotAShapefileError,
  ShapefileNotFoundError,
  ShapefileReaderError,
  UnsupportedShapeError,
  iterateRecordEwkb,
  scanShapefile,
} from "@/modules/coverage-loads/shp/job/reader/index.ts";
import { drain } from "../helpers/readerTestEwkb.ts";
import { buildShp, cwSquare, makeTempDir, recordOffset } from "../helpers/readerTestShp.ts";
import type { TempShpDir } from "../helpers/readerTestShp.ts";

let tmp: TempShpDir;
beforeEach(async () => {
  tmp = await makeTempDir();
});
afterEach(async () => {
  await tmp.cleanup();
});

const good = (): Buffer => buildShp([[cwSquare(0, 0, 10)], [cwSquare(20, 20, 10)]]);

async function expectBoth(file: string, ctor: new (...a: never[]) => Error): Promise<Error[]> {
  const a = await scanShapefile(file).catch((e: unknown) => e);
  const b = await drain(iterateRecordEwkb(file)).catch((e: unknown) => e);
  expect(a).toBeInstanceOf(ctor);
  expect(b).toBeInstanceOf(ctor);
  return [a as Error, b as Error];
}

describe("file level errors", () => {
  it("should throw ShapefileNotFoundError with a Spanish message when the file is missing", async () => {
    const missing = path.join(tmp.dir, "nope.shp");

    const [a] = await expectBoth(missing, ShapefileNotFoundError);

    expect(a!.message).toContain("No se encontró el archivo shapefile");
    expect(a!.message).toContain(missing);
  });

  it("should throw NotAShapefileError when the file code is wrong", async () => {
    const buf = good();
    buf.writeInt32BE(1234, 0);
    const file = await tmp.write("t.shp", buf);

    const [a] = await expectBoth(file, NotAShapefileError);

    expect(a!.message).toContain("no es un shapefile válido");
    expect(a!.message).toContain("1234");
  });

  it("should throw NotAShapefileError when the file is shorter than the 100-byte header", async () => {
    const file = await tmp.write("t.shp", Buffer.alloc(40));

    await expectBoth(file, NotAShapefileError);
  });

  it("should throw CorruptShapefileError when the header declares more bytes than the file has", async () => {
    const buf = good();
    buf.writeInt32BE(buf.length / 2 + 1000, 24);
    const file = await tmp.write("t.shp", buf);

    const [a] = await expectBoth(file, CorruptShapefileError);

    expect(a!.message).toContain("Shapefile truncado o corrupto");
  });

  it("should throw UnsupportedShapeError when the header shape type is not polygon", async () => {
    const buf = good();
    buf.writeInt32LE(3, 32);
    const file = await tmp.write("t.shp", buf);

    const [a] = await expectBoth(file, UnsupportedShapeError);

    expect((a as UnsupportedShapeError).shapeType).toBe(3);
    expect((a as UnsupportedShapeError).recordNumber).toBeNull();
    expect(a!.message).toContain("Tipo de geometría no soportado (3)");
    expect(a!.message).toContain("encabezado");
  });

  it("should expose every typed error as a ShapefileReaderError", async () => {
    const buf = good();
    buf.writeInt32BE(1, 0);
    const file = await tmp.write("t.shp", buf);

    const error = await scanShapefile(file).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ShapefileReaderError);
    expect((error as Error).name).toBe("NotAShapefileError");
  });
});

describe("record level errors", () => {
  const second = (buf: Buffer): number => recordOffset(buf, 1);

  it("should throw CorruptShapefileError when a record length runs beyond the end of the file", async () => {
    const buf = good();
    buf.writeInt32BE(100000, second(buf) + 4);
    const file = await tmp.write("t.shp", buf);

    const [a] = await expectBoth(file, CorruptShapefileError);

    expect((a as CorruptShapefileError).recordNumber).toBe(2);
    expect(a!.message).toContain("registro 2");
  });

  it("should throw CorruptShapefileError when the record content length is too small", async () => {
    const buf = good();
    buf.writeInt32BE(1, second(buf) + 4);
    const file = await tmp.write("t.shp", buf);

    await expectBoth(file, CorruptShapefileError);
  });

  it("should throw CorruptShapefileError when the file ends with a partial record prefix", async () => {
    const file = await tmp.write("t.shp", Buffer.concat([good(), Buffer.alloc(6)]));

    await expectBoth(file, CorruptShapefileError);
  });

  it("should throw CorruptShapefileError for negative part or point counts", async () => {
    const neg = good();
    neg.writeInt32LE(-1, second(neg) + 8 + 36);
    const negPoints = good();
    negPoints.writeInt32LE(-5, second(negPoints) + 8 + 40);

    for (const [name, buf] of [["neg.shp", neg], ["negp.shp", negPoints]] as const) {
      const [a] = await expectBoth(await tmp.write(name, buf), CorruptShapefileError);
      expect(a!.message).toContain("conteos negativos");
    }
  });

  it("should throw CorruptShapefileError when parts[0] is not 0", async () => {
    const buf = good();
    buf.writeInt32LE(1, second(buf) + 8 + 44);
    const file = await tmp.write("t.shp", buf);

    const [a] = await expectBoth(file, CorruptShapefileError);

    expect(a!.message).toContain("se esperaba 0");
  });

  it("should throw CorruptShapefileError when a parts offset is out of range", async () => {
    const buf = buildShp([[cwSquare(0, 0, 10), cwSquare(20, 20, 10)]]);
    buf.writeInt32LE(99, recordOffset(buf, 0) + 8 + 44 + 4);
    const file = await tmp.write("t.shp", buf);

    const [a] = await expectBoth(file, CorruptShapefileError);

    expect(a!.message).toContain("fuera de rango");
  });

  it("should throw CorruptShapefileError when the content length does not match the counts", async () => {
    const buf = good();
    buf.writeInt32LE(6, second(buf) + 8 + 40);
    const file = await tmp.write("t.shp", buf);

    const [a] = await expectBoth(file, CorruptShapefileError);

    expect(a!.message).toContain("no coincide");
  });

  it("should throw UnsupportedShapeError in Spanish when a record is not a polygon or null", async () => {
    const buf = good();
    buf.writeInt32LE(3, second(buf) + 8);
    const file = await tmp.write("t.shp", buf);

    const [a] = await expectBoth(file, UnsupportedShapeError);

    expect((a as UnsupportedShapeError).recordNumber).toBe(2);
    expect(a!.message).toContain("el registro 2");
    expect(a!.message).toContain("solo se admiten polígonos");
  });

  it("should throw CorruptShapefileError from iterateRecordEwkb but only count it in scanShapefile when a ring is unclosed", async () => {
    const open = [[0, 0], [0, 5], [5, 5], [5, 0]] as [number, number][];
    const file = await tmp.write("t.shp", buildShp([[open]]));

    const scan = await scanShapefile(file);
    const error = await drain(iterateRecordEwkb(file)).catch((e: unknown) => e);

    expect(scan.unclosedRingCount).toBe(1);
    expect(error).toBeInstanceOf(CorruptShapefileError);
    expect((error as Error).message).toContain("sin cerrar");
    expect((error as CorruptShapefileError).recordNumber).toBe(1);
  });

  it("should not echo file contents in error messages", async () => {
    const secret = "SECRETCANARY-PASSWORD-999";
    const garbage = Buffer.from(secret.repeat(10));
    const notShp = await tmp.write("a.shp", garbage);
    const buf = good();
    buf.write(secret, recordOffset(buf, 1) + 8 + 4, "latin1");
    buf.writeInt32LE(7, recordOffset(buf, 1) + 8);
    const badRecord = await tmp.write("b.shp", buf);

    const errors = [
      ...(await expectBoth(notShp, NotAShapefileError)),
      ...(await expectBoth(badRecord, UnsupportedShapeError)),
    ];

    for (const e of errors) expect(e.message).not.toContain("SECRETCANARY");
  });
});
