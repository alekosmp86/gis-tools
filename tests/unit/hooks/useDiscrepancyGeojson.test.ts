import { describe, it, expect } from "vitest";
import { useDiscrepancyGeojson } from "@/hooks/useDiscrepancyGeojson";
import { DiscrepancyFilter, DiscrepancyType } from "@/core/types/comparison";
import type { ComparisonSummary, DiscrepancyItem } from "@/core/types/comparison";
import type { ParsedFileDataset } from "@/core/types/parsers";

/**
 * `useDiscrepancyGeojson` calls no React hooks, so it is exercised directly.
 *
 * The behaviour under test is the one the discrepancy map depends on: it shows discrepancies or
 * nothing. Falling back to the source dataset made a KPI card reading "0" open a map full of file
 * features, which looks like discrepancies that do not exist.
 */

const fileDataset = {
  kind: "CSV",
  fileName: "datos.csv",
  fileSize: 100,
  featureCount: 2,
  attributes: ["suid"],
  recordsMap: new Map(),
  geojson: {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-56.1, -34.9] },
        properties: { suid: "S-1" },
      },
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [-56.2, -34.8] },
        properties: { suid: "S-2" },
      },
    ],
  },
} as unknown as ParsedFileDataset;

function buildItem(overrides: Partial<DiscrepancyItem> = {}): DiscrepancyItem {
  return {
    id: "item-1",
    suid: "S-1",
    type: DiscrepancyType.GEOMETRY_MISMATCH,
    differences: [],
    dbRecord: { suid: "S-1", geom: "POINT(-56.15 -34.95)" },
    shpGeometry: { type: "Point", coordinates: [-56.1, -34.9] },
    ...overrides,
  } as unknown as DiscrepancyItem;
}

function buildSummary(items: DiscrepancyItem[]): ComparisonSummary {
  return { items } as unknown as ComparisonSummary;
}

describe("useDiscrepancyGeojson", () => {
  it("should return null while the map tab is inactive", () => {
    expect(useDiscrepancyGeojson(buildSummary([]), fileDataset, DiscrepancyFilter.ALL, false)).toBeNull();
  });

  it("should return an empty collection, not the source dataset, when there is no summary", () => {
    const result = useDiscrepancyGeojson(undefined, fileDataset, DiscrepancyFilter.ALL, true);

    expect(result?.features).toHaveLength(0);
  });

  it("should return an empty collection when the active filter matches no discrepancies", () => {
    // Arrange: this is the KPI card reading "0" being clicked.
    const summary = buildSummary([buildItem({ type: DiscrepancyType.GEOMETRY_MISMATCH })]);

    // Act
    const result = useDiscrepancyGeojson(
      summary,
      fileDataset,
      DiscrepancyType.ATTRIBUTE_MISMATCH,
      true
    );

    // Assert: the source file's features must never stand in for discrepancies.
    expect(result?.features).toHaveLength(0);
  });

  it("should emit both sides of a discrepancy tagged with a shared pair id", () => {
    // Arrange
    const summary = buildSummary([buildItem()]);

    // Act
    const result = useDiscrepancyGeojson(summary, fileDataset, DiscrepancyFilter.ALL, true);

    // Assert: one feature for the database geometry, one for the file geometry.
    expect(result?.features).toHaveLength(2);
    const pairIds = result?.features.map((feature) => feature.properties?._pairId);
    expect(pairIds).toEqual(["item-1", "item-1"]);
    const sources = result?.features.map((feature) => feature.properties?._featureSource);
    expect(sources).toEqual(["DB", "FILE"]);
  });

  it("should include only the discrepancies matching the active filter", () => {
    // Arrange
    const summary = buildSummary([
      buildItem({ id: "geom", type: DiscrepancyType.GEOMETRY_MISMATCH }),
      buildItem({ id: "attr", type: DiscrepancyType.ATTRIBUTE_MISMATCH }),
    ]);

    // Act
    const result = useDiscrepancyGeojson(
      summary,
      fileDataset,
      DiscrepancyType.ATTRIBUTE_MISMATCH,
      true
    );

    // Assert
    const pairIds = new Set(result?.features.map((feature) => feature.properties?._pairId));
    expect(Array.from(pairIds)).toEqual(["attr"]);
  });
});
