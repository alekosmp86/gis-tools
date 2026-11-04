import { beforeEach, describe, it, expect, vi } from "vitest";
import type { Feature, FeatureCollection, Geometry } from "geojson";

const { extractMock, shpMock } = vi.hoisted(() => ({ extractMock: vi.fn(), shpMock: vi.fn() }));
vi.mock("@/core/binary/ZipShapefileExtractor", () => ({ extractShapefileZip: extractMock }));
vi.mock("shpjs", () => ({ default: shpMock }));

import { ShapefileParser } from "@/core/services/parsers/ShapefileParser";
import { buildDbfBuffer } from "../../core/binary/support/dbfBuilder";
import { buildShpBuffer, nullRecord, pointRecord, polygonRecord } from "../../core/binary/support/shpBuilder";

describe("ShapefileParser", () => {
  const parser = new ShapefileParser();

  it("should parse GeoJSON file and report progress upon completion", async () => {
    // Arrange
    const sampleGeoJson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "1", name: "Point A" },
          geometry: { type: "Point", coordinates: [-56.1, -34.9] },
        },
        {
          type: "Feature",
          properties: { id: "2", name: "Point B" },
          geometry: { type: "Point", coordinates: [-56.2, -34.8] },
        },
      ],
    };
    const file = new File([JSON.stringify(sampleGeoJson)], "test.geojson", {
      type: "application/geo+json",
    });
    const progressCalls: Array<{ phase: string; current: number; total: number }> = [];

    // Act
    const parsed = await parser.parse(file, (phase: string, current: number, total: number) => {
      progressCalls.push({ phase, current, total });
    });

    // Assert
    expect(parsed.featureCount).toBe(2);
    expect(parsed.geometryType).toBe("Point");
    expect(parsed.attributes).toContain("name");
    expect(progressCalls).toHaveLength(1);
    expect(progressCalls[0]).toEqual({
      phase: "Procesando entidades GeoJSON...",
      current: 2,
      total: 2,
    });
  });

  it("should parse GeoJSON without onProgress callback without errors", async () => {
    // Arrange
    const sampleGeoJson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { codigo: "100" },
          geometry: { type: "Point", coordinates: [-56.0, -34.0] },
        },
      ],
    };
    const file = new File([JSON.stringify(sampleGeoJson)], "single.geojson", {
      type: "application/geo+json",
    });

    // Act
    const parsed = await parser.parse(file);

    // Assert
    expect(parsed.featureCount).toBe(1);
    expect(parsed.recordsMap.get("feat-0")?.codigo).toBe("100");
  });

  it("should report chunk progress when GeoJSON features exceed PARSE_PROGRESS_CHUNK_SIZE", async () => {
    // Arrange
    const featureCount = 2100;
    const generatedFeatures = [];
    for (let featureIndex = 0; featureIndex < featureCount; featureIndex++) {
      generatedFeatures.push({
        type: "Feature",
        properties: { id: String(featureIndex) },
        geometry: { type: "Point", coordinates: [-56.0, -34.0] },
      });
    }
    const sampleGeoJson = {
      type: "FeatureCollection",
      features: generatedFeatures,
    };
    const file = new File([JSON.stringify(sampleGeoJson)], "large.geojson", {
      type: "application/geo+json",
    });
    const progressCalls: Array<{ phase: string; current: number; total: number }> = [];

    // Act
    const parsed = await parser.parse(file, (phase: string, current: number, total: number) => {
      progressCalls.push({ phase, current, total });
    });

    // Assert
    expect(parsed.featureCount).toBe(featureCount);
    expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    expect(progressCalls[0]).toEqual({
      phase: "Procesando entidades GeoJSON...",
      current: 2000,
      total: featureCount,
    });
    expect(progressCalls[progressCalls.length - 1]).toEqual({
      phase: "Procesando entidades GeoJSON...",
      current: featureCount,
      total: featureCount,
    });
  });

  it("should throw error for unsupported file extension", async () => {
    // Arrange
    const file = new File(["dummy"], "test.pdf", { type: "application/pdf" });

    // Act & Assert
    await expect(parser.parse(file)).rejects.toThrow(
      "Formato no soportado. Por favor suba un archivo .zip (SHP+DBF) o .geojson."
    );
  });
});

const NAME_FIELD = [{ name: "NAME", type: "C" as const, length: 10 }];
const dbfOf = (...names: string[]) =>
  buildDbfBuffer({ fields: NAME_FIELD, records: names.map((name) => ({ values: { NAME: name } })) });
const zipFile = (name = "data.zip") =>
  new File([new Uint8Array([1, 2, 3, 4])], name, { lastModified: Date.UTC(2024, 0, 15) });
const PROGRESS_LABEL = "Extrayendo geometrías...";

function shpHeaderOnly(shapeType: number): Uint8Array {
  const bytes = new Uint8Array(100);
  new DataView(bytes.buffer).setInt32(32, shapeType, true);
  return bytes;
}

describe("ShapefileParser zip with DBF", () => {
  const parser = new ShapefileParser();

  beforeEach(() => {
    extractMock.mockReset();
    shpMock.mockReset();
  });

  it.each([
    ["Point", 1],
    ["Point", 11],
    ["Point", 21],
    ["LineString", 3],
    ["LineString", 13],
    ["LineString", 23],
    ["Polygon", 5],
    ["Polygon", 15],
    ["Polygon", 25],
    ["MultiPoint", 8],
    ["MultiPoint", 18],
    ["MultiPoint", 28],
    ["Desconocido", 0],
    ["Desconocido", 31],
    ["Desconocido", 999],
  ])("should report geometryType %s when the SHP header shape type is %i", async (expected, shapeType) => {
    extractMock.mockResolvedValue({ dbfBuffer: dbfOf(), shpBuffer: shpHeaderOnly(shapeType) });

    const parsed = await parser.parse(zipFile());

    expect(parsed.geometryType).toBe(expected);
  });

  it("should report Desconocido and no features when the zip has no SHP", async () => {
    extractMock.mockResolvedValue({ dbfBuffer: dbfOf("a", "b") });

    const parsed = await parser.parse(zipFile());

    expect(parsed.geometryType).toBe("Desconocido");
    expect(parsed.featureCount).toBe(2);
    expect(parsed.geojson?.features).toEqual([]);
    expect(parsed.recordsMap.size).toBe(2);
    expect(parsed.attributes).toEqual(["NAME"]);
  });

  it("should report Desconocido when the SHP is too small to hold a header", async () => {
    extractMock.mockResolvedValue({ dbfBuffer: dbfOf("a"), shpBuffer: new Uint8Array(10) });

    const parsed = await parser.parse(zipFile());

    expect(parsed.geometryType).toBe("Desconocido");
    expect(parsed.geojson?.features).toEqual([]);
    expect(parsed.recordsMap.get("feat-0")).toBeDefined();
  });

  it("should join each DBF record to its geometry and keep the record index as feature id", async () => {
    extractMock.mockResolvedValue({
      dbfBuffer: dbfOf("alpha", "beta"),
      shpBuffer: new Uint8Array(buildShpBuffer([pointRecord([1, 2]), pointRecord([3, 4])])),
    });

    const parsed = await parser.parse(zipFile());

    expect(parsed.geometryType).toBe("Point");
    expect(parsed.featureCount).toBe(2);
    expect(parsed.geojson?.features.map((feature) => feature.id)).toEqual([0, 1]);
    expect(parsed.geojson?.features.map((feature) => feature.geometry)).toEqual([
      { type: "Point", coordinates: [1, 2] },
      { type: "Point", coordinates: [3, 4] },
    ]);
    expect(parsed.recordsMap.get("feat-1")).toEqual(parsed.geojson?.features[1].properties);
    expect(parsed.recordsMap.get("feat-1")?.NAME).toBe("beta");
  });

  it("should skip the feature of a null-shape record but keep its attributes and the following ids", async () => {
    extractMock.mockResolvedValue({
      dbfBuffer: dbfOf("a", "b", "c"),
      shpBuffer: new Uint8Array(buildShpBuffer([pointRecord([1, 1]), nullRecord(), pointRecord([2, 2])])),
    });

    const parsed = await parser.parse(zipFile());

    expect(parsed.featureCount).toBe(3);
    expect(parsed.recordsMap.size).toBe(3);
    expect(parsed.geojson?.features.map((feature) => feature.id)).toEqual([0, 2]);
  });

  it("should read polygon geometries and report Polygon", async () => {
    const ring = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
    extractMock.mockResolvedValue({
      dbfBuffer: dbfOf("p"),
      shpBuffer: new Uint8Array(buildShpBuffer([polygonRecord([ring])])),
    });

    const parsed = await parser.parse(zipFile());

    expect(parsed.geometryType).toBe("Polygon");
    expect(parsed.geojson?.features[0].geometry).toEqual({ type: "Polygon", coordinates: [ring] });
  });

  it("should expose the raw buffers, prj and cpg text and a non-large flag", async () => {
    const dbfBuffer = dbfOf("a");
    const shpBuffer = shpHeaderOnly(1);
    extractMock.mockResolvedValue({ dbfBuffer, shpBuffer, prjText: "EPSG:4326", cpgText: "UTF-8" });

    const parsed = await parser.parse(zipFile("Data.ZIP"));

    expect(parsed.dbfBuffer).toBe(dbfBuffer);
    expect(parsed.shpBuffer).toBe(shpBuffer);
    expect(parsed.prjText).toBe("EPSG:4326");
    expect(parsed.cpgText).toBe("UTF-8");
    expect(parsed.isLargeDataset).toBe(false);
    expect(parsed.fileName).toBe("Data.ZIP");
    expect(parsed.fileSize).toBe(4);
  });

  it("should fall back to the file last-modified date when the zip carries no entry dates", async () => {
    extractMock.mockResolvedValue({ dbfBuffer: dbfOf() });

    const parsed = await parser.parse(zipFile());

    expect(parsed.modifiedAt).toBe(new Date(Date.UTC(2024, 0, 15)).toISOString());
  });

  it("should report final progress when the zip has records and none when it is empty", async () => {
    extractMock.mockResolvedValue({ dbfBuffer: dbfOf("a", "b") });
    const withRecords = vi.fn();
    const empty = vi.fn();

    await parser.parse(zipFile(), withRecords);
    extractMock.mockResolvedValue({ dbfBuffer: dbfOf() });
    await parser.parse(zipFile(), empty);

    expect(withRecords).toHaveBeenCalledWith(PROGRESS_LABEL, 2, 2);
    expect(empty).not.toHaveBeenCalled();
  });

  it("should report intermediate progress every PARSE_PROGRESS_CHUNK_SIZE records", async () => {
    const names = Array.from({ length: 2100 }, (_unused, index) => String(index));
    extractMock.mockResolvedValue({ dbfBuffer: dbfOf(...names) });
    const onProgress = vi.fn();

    await parser.parse(zipFile(), onProgress);

    expect(onProgress.mock.calls).toEqual([
      [PROGRESS_LABEL, 2000, 2100],
      [PROGRESS_LABEL, 2100, 2100],
    ]);
  });
});

describe("ShapefileParser zip without DBF and GeoJSON building", () => {
  const parser = new ShapefileParser();
  const pointFeature = (
    properties: Record<string, unknown> | null,
    geometry: Geometry | null = { type: "Point", coordinates: [0, 0] }
  ) => ({ type: "Feature", properties, geometry }) as Feature<Geometry>;
  const collection = (features: Array<Feature<Geometry>>): FeatureCollection<Geometry> => ({
    type: "FeatureCollection",
    features,
  });

  beforeEach(() => {
    extractMock.mockReset();
    shpMock.mockReset();
    extractMock.mockResolvedValue({});
  });

  it("should build the dataset from the shpjs collection when the zip has no DBF", async () => {
    shpMock.mockResolvedValue(collection([pointFeature({ a: 1, b: 2 }), pointFeature({ b: 3, c: 4 })]));

    const parsed = await parser.parse(zipFile());

    expect(parsed.featureCount).toBe(2);
    expect(parsed.geometryType).toBe("Point");
    expect(parsed.attributes).toEqual(["a", "b", "c"]);
    expect(parsed.recordsMap.get("feat-1")).toEqual({ b: 3, c: 4 });
  });

  it("should use the first collection when shpjs returns an array", async () => {
    shpMock.mockResolvedValue([collection([pointFeature({ first: 1 })]), collection([pointFeature({ second: 1 })])]);

    const parsed = await parser.parse(zipFile());

    expect(parsed.attributes).toEqual(["first"]);
  });

  it("should throw when shpjs returns nothing usable", async () => {
    shpMock.mockResolvedValue(undefined);

    await expect(parser.parse(zipFile())).rejects.toThrow("No se encontraron entidades vectoriales en el archivo.");
  });

  it("should throw when the collection has no features array", async () => {
    shpMock.mockResolvedValue({ type: "FeatureCollection" });

    await expect(parser.parse(zipFile())).rejects.toThrow("No se encontraron entidades vectoriales en el archivo.");
  });

  it("should report an empty collection with Desconocido and no progress", async () => {
    shpMock.mockResolvedValue(collection([]));
    const onProgress = vi.fn();

    const parsed = await parser.parse(zipFile(), onProgress);

    expect(parsed).toMatchObject({ featureCount: 0, geometryType: "Desconocido", attributes: [], isLargeDataset: false });
    expect(onProgress).not.toHaveBeenCalled();
  });

  it("should report Desconocido when the first feature has no geometry", async () => {
    shpMock.mockResolvedValue(collection([pointFeature({ a: 1 }, null), pointFeature({ a: 2 })]));

    const parsed = await parser.parse(zipFile());

    expect(parsed.geometryType).toBe("Desconocido");
    expect(parsed.featureCount).toBe(2);
  });

  it("should map a feature with null properties to an empty record without adding attributes", async () => {
    shpMock.mockResolvedValue(collection([pointFeature(null), pointFeature({ k: "v" })]));

    const parsed = await parser.parse(zipFile());

    expect(parsed.recordsMap.get("feat-0")).toEqual({});
    expect(parsed.attributes).toEqual(["k"]);
  });

  it("should truncate the preview to MAX_MAP_PREVIEW_FEATURES and flag the dataset as large", async () => {
    shpMock.mockResolvedValue(collection(Array.from({ length: 150_001 }, () => pointFeature({}))));

    const parsed = await parser.parse(zipFile());

    expect(parsed.isLargeDataset).toBe(true);
    expect(parsed.featureCount).toBe(150_001);
    expect(parsed.geojson?.features).toHaveLength(150_000);
    expect(parsed.recordsMap.size).toBe(150_000);
  });

  it("should not flag a dataset with exactly MAX_MAP_PREVIEW_FEATURES features as large", async () => {
    shpMock.mockResolvedValue(collection(Array.from({ length: 150_000 }, () => pointFeature({}))));

    const parsed = await parser.parse(zipFile());

    expect(parsed.isLargeDataset).toBe(false);
    expect(parsed.geojson?.features).toHaveLength(150_000);
  });

  it("should reject a GeoJSON file that is not a feature collection", async () => {
    const file = new File([JSON.stringify({ type: "Feature" })], "bad.json");

    await expect(parser.parse(file)).rejects.toThrow("No se encontraron entidades vectoriales en el archivo.");
  });

  it("should accept an uppercase .GEOJSON extension and use the file last-modified date", async () => {
    const file = new File([JSON.stringify(collection([pointFeature({ x: 1 })]))], "A.GEOJSON", {
      lastModified: Date.UTC(2023, 5, 1),
    });

    const parsed = await parser.parse(file);

    expect(parsed.featureCount).toBe(1);
    expect(parsed.modifiedAt).toBe(new Date(Date.UTC(2023, 5, 1)).toISOString());
  });
});
