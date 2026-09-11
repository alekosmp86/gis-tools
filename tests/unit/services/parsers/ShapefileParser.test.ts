import { describe, it, expect } from "vitest";
import { ShapefileParser } from "@/core/services/parsers/ShapefileParser";

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
