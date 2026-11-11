import { describe, it, expect } from "vitest";
import { SpatialComparisonEngine } from "@/core/workers/comparison/SpatialComparisonEngine";
import type { ColumnMappingConfig } from "@/core/types/comparison";
import type { SerializableFileDataset } from "@/core/types/workerMessages";

const LINE = { type: "LineString", coordinates: [[-56.1, -34.9], [-56.2, -34.8]] };

function csvDataset(rowCount: number): SerializableFileDataset {
  const recordsObject: Record<string, Record<string, unknown>> = {};
  for (let index = 0; index < rowCount; index++) {
    recordsObject[String(index)] = { id: `K${index}`, name: "n", _geometry: LINE };
  }
  return {
    fileName: "t.csv",
    fileSize: 1,
    featureCount: rowCount,
    attributes: ["id", "name"],
    recordsObject,
  };
}

const mapping: ColumnMappingConfig = {
  suidColumns: ["id"],
  matchedFileSuidColumns: ["id"],
  fieldsToCompare: ["name", "geom"],
  compareGeometry: true,
  targetSrid: 32721,
};

describe("SpatialComparisonEngine preview patches (CSV SRID bug)", () => {
  it("SRID-6: should transform CSV insert previews from 4326 to the column SRID", () => {
    const engine = new SpatialComparisonEngine();

    const result = engine.executeComparison(
      [],
      { id: "text", name: "text", geom: "geometry(MultiLineString,32721)" },
      csvDataset(3),
      mapping,
      "public",
      "tbl"
    );

    expect(result.sqlInsertPreview).toContain(
      "ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON('"
    );
    expect(result.sqlInsertPreview).toContain("4326), 32721))");
    expect(result.sqlInsertPreview).not.toMatch(/ST_SetSRID\(ST_GeomFromGeoJSON\('[^']*'\), 32721\)/);
  });

  it("SRID-7: should apply the 4326 origin to every one of the first 25 preview inserts", () => {
    const engine = new SpatialComparisonEngine();

    const result = engine.executeComparison(
      [],
      { id: "text", name: "text", geom: "geometry(MultiLineString,32721)" },
      csvDataset(30),
      mapping,
      "public",
      "tbl"
    );

    const inserts = result.sqlInsertPreview.match(/INSERT INTO/g) ?? [];
    const transforms = result.sqlInsertPreview.match(/ST_Transform\(ST_SetSRID\([^)]*\), 4326\), 32721\)/g) ?? [];
    expect(result.sqlInsertCount).toBe(30);
    expect(inserts).toHaveLength(25);
    expect(transforms).toHaveLength(25);
  });

  it("SRID-8: should not transform when the column SRID is already 4326", () => {
    const engine = new SpatialComparisonEngine();

    const result = engine.executeComparison(
      [],
      { id: "text", name: "text", geom: "geometry(MultiLineString,4326)" },
      csvDataset(1),
      { ...mapping, targetSrid: 4326 },
      "public",
      "tbl"
    );

    expect(result.sqlInsertPreview).not.toContain("ST_Transform");
    expect(result.sqlInsertPreview).toContain("4326)");
  });
});
