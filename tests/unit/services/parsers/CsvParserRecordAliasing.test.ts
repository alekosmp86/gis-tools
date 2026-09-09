import { describe, it, expect } from "vitest";
import { CsvParser } from "@/core/services/parsers/CsvParser";

/**
 * The parser aliases one record under several keys (row ordinal, id, suid) so lookups by
 * identifier resolve directly. Consumers that list records must therefore deduplicate by identity,
 * or the same record appears several times and its position stops matching the row ordinal that
 * `feature.id` refers to.
 */
describe("CsvParser record aliasing", () => {
  const parser = new CsvParser();

  it("should alias the same record object under its row ordinal, id and suid", async () => {
    // Arrange
    const csvContent = "id,suid,nombre\n7,S-7,MONTEVIDEO";
    const file = new File([csvContent], "alias.csv", { type: "text/csv" });

    // Act
    const parsed = await parser.parse(file);

    // Assert: three keys, one underlying object.
    const byRow = parsed.recordsMap.get("row-0");
    const byId = parsed.recordsMap.get("7");
    const bySuid = parsed.recordsMap.get("S-7");
    expect(byRow).toBeDefined();
    expect(byId).toBe(byRow);
    expect(bySuid).toBe(byRow);
  });

  it("should yield one entry per row once values are deduplicated by identity", async () => {
    // Arrange
    const csvContent = "id,suid,nombre\n1,S-1,UNO\n2,S-2,DOS\n3,S-3,TRES";
    const file = new File([csvContent], "alias.csv", { type: "text/csv" });

    // Act
    const parsed = await parser.parse(file);
    const rawValues = Array.from(parsed.recordsMap.values());
    const dedupedValues = Array.from(new Set(parsed.recordsMap.values()));

    // Assert: aliasing inflates the raw list, deduplication restores one per row.
    expect(rawValues.length).toBeGreaterThan(3);
    expect(dedupedValues).toHaveLength(3);
    expect(dedupedValues.map((record) => record.nombre)).toEqual(["UNO", "DOS", "TRES"]);
  });

  it("should keep each record at its row ordinal after deduplication", async () => {
    // Arrange
    const csvContent = "id,suid,nombre\n1,S-1,UNO\n2,S-2,DOS\n3,S-3,TRES";
    const file = new File([csvContent], "alias.csv", { type: "text/csv" });

    // Act
    const parsed = await parser.parse(file);
    const dedupedValues = Array.from(new Set(parsed.recordsMap.values()));

    // Assert: position in the deduplicated list equals the row ordinal.
    expect(dedupedValues.indexOf(parsed.recordsMap.get("row-1")!)).toBe(1);
    expect(dedupedValues.indexOf(parsed.recordsMap.get("row-2")!)).toBe(2);
  });

  it("should stamp each feature with the row ordinal of its source record", async () => {
    // Arrange: the middle row carries no geometry, so feature and row positions diverge.
    const csvContent = [
      "id,nombre,wkt",
      "1,UNO,POINT(-56.1 -34.9)",
      "2,SIN GEOMETRIA,",
      "3,TRES,POINT(-56.3 -34.7)",
    ].join("\n");
    const file = new File([csvContent], "huecos.csv", { type: "text/csv" });

    // Act
    const parsed = await parser.parse(file);

    // Assert
    expect(parsed.geojson?.features).toHaveLength(2);
    expect(parsed.geojson?.features[0].id).toBe(0);
    expect(parsed.geojson?.features[1].id).toBe(2);
  });

  it("should resolve a feature id back to its record through the deduplicated list", async () => {
    // Arrange
    const csvContent = [
      "id,nombre,wkt",
      "1,UNO,POINT(-56.1 -34.9)",
      "2,SIN GEOMETRIA,",
      "3,TRES,POINT(-56.3 -34.7)",
    ].join("\n");
    const file = new File([csvContent], "huecos.csv", { type: "text/csv" });

    // Act
    const parsed = await parser.parse(file);
    const dedupedValues = Array.from(new Set(parsed.recordsMap.values()));
    const secondFeatureRecordIndex = parsed.geojson?.features[1].id as number;

    // Assert: the third row is the one behind the second rendered feature.
    expect(dedupedValues[secondFeatureRecordIndex].nombre).toBe("TRES");
  });
});
