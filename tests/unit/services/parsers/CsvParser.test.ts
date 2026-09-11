import { describe, it, expect } from "vitest";
import { CsvParser } from "@/core/services/parsers/CsvParser";

describe("CsvParser", () => {
  const parser = new CsvParser();

  it("should parse standard comma-delimited CSV with headers and rows", async () => {
    // Arrange
    const csvContent = "id,nombre,departamento\n1,SALTO GRANDE,SALTO\n2,PAYSANDU,PAYSANDU";
    const file = new File([csvContent], "ciudades.csv", { type: "text/csv" });

    // Act
    const parsed = await parser.parse(file);

    // Assert
    expect(parsed.fileName).toBe("ciudades.csv");
    expect(parsed.featureCount).toBe(2);
    expect(parsed.attributes).toEqual(["id", "nombre", "departamento"]);
    expect(parsed.recordsMap.get("1")?.nombre).toBe("SALTO GRANDE");
    expect(parsed.recordsMap.get("2")?.departamento).toBe("PAYSANDU");
  });

  it("should autodetect semicolon delimiter (;)", async () => {
    // Arrange
    const csvContent = "suid;departamento;zona\n101;MONTEVIDEO;URBANA\n102;CANELONES;RURAL";
    const file = new File([csvContent], "datos.csv", { type: "text/csv" });

    // Act
    const parsed = await parser.parse(file);

    // Assert
    expect(parsed.attributes).toEqual(["suid", "departamento", "zona"]);
    expect(parsed.featureCount).toBe(2);
    expect(parsed.recordsMap.get("101")?.departamento).toBe("MONTEVIDEO");
  });

  it("should parse WKT spatial geometry columns into GeoJSON features", async () => {
    // Arrange
    const csvContent = "id,nombre,wkt\n10,MONTEVIDEO,POINT(-56.1645 -34.9011)";
    const file = new File([csvContent], "puntos.csv", { type: "text/csv" });

    // Act
    const parsed = await parser.parse(file);

    // Assert
    expect(parsed.geojson).toBeDefined();
    expect(parsed.geojson?.features).toHaveLength(1);
    expect(parsed.geometryType).toBe("Point");
    expect(parsed.geojson?.features[0]?.geometry.type).toBe("Point");
  });

  it("should parse lat/lng columns into GeoJSON Point features", async () => {
    // Arrange
    const csvContent = "id,nombre,lat,lon\n20,PLAZA INDEPENDENCIA,-34.9065,-56.1996";
    const file = new File([csvContent], "plazas.csv", { type: "text/csv" });

    // Act
    const parsed = await parser.parse(file);

    // Assert
    expect(parsed.geojson).toBeDefined();
    expect(parsed.geojson?.features).toHaveLength(1);
    expect(parsed.geometryType).toBe("Point");
    const feature = parsed.geojson?.features[0];
    if (feature && feature.geometry.type === "Point") {
      expect(feature.geometry.coordinates[0]).toBeCloseTo(-56.1996, 4);
      expect(feature.geometry.coordinates[1]).toBeCloseTo(-34.9065, 4);
    }
  });

  it("should throw error for empty CSV file", async () => {
    // Arrange
    const file = new File([""], "empty.csv", { type: "text/csv" });

    // Act & Assert
    await expect(parser.parse(file)).rejects.toThrow("El archivo CSV está vacío.");
  });

  it("should report progress at completion for datasets under chunk size", async () => {
    // Arrange
    const csvContent = "id,nombre\n1,Alpha\n2,Beta";
    const file = new File([csvContent], "datos.csv", { type: "text/csv" });
    const progressCalls: Array<{ phase: string; current: number; total: number }> = [];

    // Act
    const parsed = await parser.parse(file, (phase: string, current: number, total: number) => {
      progressCalls.push({ phase, current, total });
    });

    // Assert
    expect(parsed.featureCount).toBe(2);
    expect(progressCalls).toHaveLength(1);
    expect(progressCalls[0]).toEqual({
      phase: "Procesando filas CSV...",
      current: 2,
      total: 2,
    });
  });

  it("should report chunk progress and completion when dataset exceeds PARSE_PROGRESS_CHUNK_SIZE", async () => {
    // Arrange
    const rowCount = 2050;
    const header = "id,nombre";
    const rows: string[] = [header];
    for (let rowIndex = 1; rowIndex <= rowCount; rowIndex++) {
      rows.push(`${rowIndex},Item_${rowIndex}`);
    }
    const csvContent = rows.join("\n");
    const file = new File([csvContent], "large.csv", { type: "text/csv" });
    const progressCalls: Array<{ phase: string; current: number; total: number }> = [];

    // Act
    const parsed = await parser.parse(file, (phase: string, current: number, total: number) => {
      progressCalls.push({ phase, current, total });
    });

    // Assert
    expect(parsed.featureCount).toBe(rowCount);
    // At least 2 calls: one at chunk threshold (2000) and one at completion (2050)
    expect(progressCalls.length).toBeGreaterThanOrEqual(2);
    expect(progressCalls[0]).toEqual({
      phase: "Procesando filas CSV...",
      current: 2000,
      total: rowCount,
    });
    expect(progressCalls[progressCalls.length - 1]).toEqual({
      phase: "Procesando filas CSV...",
      current: rowCount,
      total: rowCount,
    });
  });
});
