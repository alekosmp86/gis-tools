import { describe, it, expect } from "vitest";
import { parseRecordsToGeoJson } from "@/core/spatial/GeoJsonDatasetBuilder";

const COLUMNS = ["gid", "nombre", "geom"];

describe("parseRecordsToGeoJson", () => {
  it("should return an empty result for an empty record set", () => {
    expect(parseRecordsToGeoJson([], COLUMNS)).toEqual({
      geojson: null,
      detectedGeometryType: null,
    });
  });

  it("should return an empty result when no columns are supplied", () => {
    const records = [{ gid: 1, geom: "POINT(-56.1 -34.9)" }];

    expect(parseRecordsToGeoJson(records, [])).toEqual({
      geojson: null,
      detectedGeometryType: null,
    });
  });

  it("should build one feature per record with parseable geometry", () => {
    // Arrange
    const records = [
      { gid: 1, nombre: "Uno", geom: "POINT(-56.1 -34.9)" },
      { gid: 2, nombre: "Dos", geom: "POINT(-56.2 -34.8)" },
    ];

    // Act
    const { geojson, detectedGeometryType } = parseRecordsToGeoJson(records, COLUMNS);

    // Assert
    expect(detectedGeometryType).toBe("Point");
    expect(geojson?.features).toHaveLength(2);
    expect(geojson?.features[0].geometry).toEqual({
      type: "Point",
      coordinates: [-56.1, -34.9],
    });
  });

  it("should carry the record position as the feature id when a record has no geometry", () => {
    // Arrange: the middle record produces no feature, so feature and record
    // positions diverge from that point on.
    const records = [
      { gid: 1, nombre: "Uno", geom: "POINT(-56.1 -34.9)" },
      { gid: 2, nombre: "Sin geometria", geom: null },
      { gid: 3, nombre: "Tres", geom: "POINT(-56.3 -34.7)" },
    ];

    // Act
    const { geojson } = parseRecordsToGeoJson(records, COLUMNS);

    // Assert
    expect(geojson?.features).toHaveLength(2);
    expect(geojson?.features[0].id).toBe(0);
    expect(geojson?.features[1].id).toBe(2);
  });

  it("should copy record attributes into feature properties", () => {
    // Arrange
    const records = [{ gid: 7, nombre: "Siete", geom: "POINT(-56.1 -34.9)" }];

    // Act
    const { geojson } = parseRecordsToGeoJson(records, COLUMNS);

    // Assert
    expect(geojson?.features[0].properties).toMatchObject({ gid: 7, nombre: "Siete" });
  });

  it("should not share the record object with feature properties", () => {
    // Arrange: properties are copied, so later mutation of a record must not
    // leak into an already-built feature.
    const record = { gid: 1, nombre: "Original", geom: "POINT(-56.1 -34.9)" };

    // Act
    const { geojson } = parseRecordsToGeoJson([record], COLUMNS);
    record.nombre = "Modificado";

    // Assert
    expect(geojson?.features[0].properties?.nombre).toBe("Original");
  });

  it("should return an empty result when no record yields geometry", () => {
    // Arrange
    const records = [
      { gid: 1, nombre: "Uno", geom: null },
      { gid: 2, nombre: "Dos", geom: null },
    ];

    // Act
    const result = parseRecordsToGeoJson(records, COLUMNS);

    // Assert
    expect(result.geojson).toBeNull();
    expect(result.detectedGeometryType).toBeNull();
  });

  it("should find geometry in a differently named column", () => {
    // Arrange: the candidate column is detected by the shared `geom` keyword.
    const columns = ["gid", "wkb_geometry"];
    const records = [{ gid: 1, wkb_geometry: "POINT(-56.1 -34.9)" }];

    // Act
    const { geojson, detectedGeometryType } = parseRecordsToGeoJson(records, columns);

    // Assert
    expect(detectedGeometryType).toBe("Point");
    expect(geojson?.features).toHaveLength(1);
  });

  it("should report the geometry type of the first parsed feature", () => {
    // Arrange
    const records = [
      { gid: 1, nombre: "Linea", geom: "LINESTRING(-56.1 -34.9, -56.2 -34.8)" },
      { gid: 2, nombre: "Punto", geom: "POINT(-56.3 -34.7)" },
    ];

    // Act
    const { detectedGeometryType } = parseRecordsToGeoJson(records, COLUMNS);

    // Assert
    expect(detectedGeometryType).toBe("LineString");
  });
});
