import { describe, it, expect } from "vitest";
import {
  buildErrorSummary,
  deriveSourceBadge,
  isCsvCompatible,
  isShapefileCompatible,
  matchesFormatFilter,
  parseFormatFilter,
  toCatalogResourceItem,
} from "@/modules/cartography-watcher/domain/catalogMapping";
import {
  CatalogFormatFilter,
  DeltaStatus,
  SourceBadgeState,
} from "@/modules/cartography-watcher/types";
import type { CkanResource, ResourceDelta } from "@/modules/cartography-watcher/types";

function buildDelta(status: DeltaStatus): ResourceDelta {
  return {
    resource: { id: "r", name: "n", format: "CSV", url: "https://example.org/f.csv" },
    status,
    reason: "",
    localMeta: null,
  };
}

function buildResource(overrides: Partial<CkanResource> = {}): CkanResource {
  return {
    id: "abc",
    name: "Ejes - FLORES",
    format: "csv",
    url: "https://example.org/flores.csv",
    ...overrides,
  };
}

describe("format compatibility", () => {
  it("should accept the formats the CSV tool can ingest", () => {
    expect(isCsvCompatible("CSV")).toBe(true);
    expect(isCsvCompatible("csv")).toBe(true);
    expect(isCsvCompatible(" TXT ")).toBe(true);
    expect(isCsvCompatible("SHP")).toBe(false);
    expect(isCsvCompatible(null)).toBe(false);
  });

  it("should accept the formats the shapefile tool can ingest", () => {
    expect(isShapefileCompatible("SHP")).toBe(true);
    expect(isShapefileCompatible("zip")).toBe(true);
    expect(isShapefileCompatible("GeoJSON")).toBe(true);
    expect(isShapefileCompatible("SHP ZIP")).toBe(true);
    expect(isShapefileCompatible("CSV")).toBe(false);
    expect(isShapefileCompatible(undefined)).toBe(false);
  });

  it("should let every format through the ALL filter", () => {
    expect(matchesFormatFilter("geopackage", CatalogFormatFilter.ALL)).toBe(true);
    expect(matchesFormatFilter(null, CatalogFormatFilter.ALL)).toBe(true);
  });

  it("should filter to the formats the requesting tool accepts", () => {
    expect(matchesFormatFilter("CSV", CatalogFormatFilter.CSV)).toBe(true);
    expect(matchesFormatFilter("ZIP", CatalogFormatFilter.CSV)).toBe(false);
    expect(matchesFormatFilter("ZIP", CatalogFormatFilter.SHP)).toBe(true);
  });
});

describe("parseFormatFilter", () => {
  it("should recognise the supported filters case-insensitively", () => {
    expect(parseFormatFilter("csv")).toBe(CatalogFormatFilter.CSV);
    expect(parseFormatFilter(" SHP ")).toBe(CatalogFormatFilter.SHP);
  });

  it("should fall back to ALL for anything unrecognised", () => {
    // Arrange & Act & Assert: an unknown filter must widen the catalogue, never empty it.
    expect(parseFormatFilter(null)).toBe(CatalogFormatFilter.ALL);
    expect(parseFormatFilter("")).toBe(CatalogFormatFilter.ALL);
    expect(parseFormatFilter("geopackage")).toBe(CatalogFormatFilter.ALL);
  });
});

describe("toCatalogResourceItem", () => {
  it("should normalise the format and carry the cache flag", () => {
    // Act
    const item = toCatalogResourceItem(buildResource({ size: 1200 }), true);

    // Assert
    expect(item.format).toBe("CSV");
    expect(item.sizeBytes).toBe(1200);
    expect(item.isCached).toBe(true);
  });

  it("should prefer last_modified and fall back to metadata_modified", () => {
    expect(
      toCatalogResourceItem(
        buildResource({ last_modified: "2026-09-01", metadata_modified: "2026-01-01" }),
        false
      ).lastModified
    ).toBe("2026-09-01");

    expect(
      toCatalogResourceItem(
        buildResource({ last_modified: null, metadata_modified: "2026-01-01" }),
        false
      ).lastModified
    ).toBe("2026-01-01");
  });

  it("should report an absent size as null rather than zero", () => {
    // Arrange & Act & Assert: zero would read as an empty file.
    expect(toCatalogResourceItem(buildResource(), false).sizeBytes).toBeNull();
  });
});

describe("deriveSourceBadge", () => {
  it("should report an available update above everything else", () => {
    // Arrange: a stale copy is the most urgent state.
    const deltas = [
      buildDelta(DeltaStatus.UP_TO_DATE),
      buildDelta(DeltaStatus.NOT_DOWNLOADED),
      buildDelta(DeltaStatus.UPDATE_AVAILABLE),
    ];

    // Assert
    expect(deriveSourceBadge(deltas)).toBe(SourceBadgeState.UPDATE_AVAILABLE);
  });

  it("should not report a source as up to date while files remain undownloaded", () => {
    // Arrange: one downloaded file among twenty missing ones is not up to date. The badge has to
    // agree with the pending count shown beside it.
    const deltas = [
      buildDelta(DeltaStatus.UP_TO_DATE),
      ...Array.from({ length: 20 }, () => buildDelta(DeltaStatus.NOT_DOWNLOADED)),
    ];

    // Assert
    expect(deriveSourceBadge(deltas)).toBe(SourceBadgeState.NOT_DOWNLOADED);
  });

  it("should report up to date only when nothing is pending", () => {
    expect(deriveSourceBadge([buildDelta(DeltaStatus.UP_TO_DATE)])).toBe(
      SourceBadgeState.UP_TO_DATE
    );
  });

  it("should treat a source with no resources as up to date", () => {
    expect(deriveSourceBadge([])).toBe(SourceBadgeState.UP_TO_DATE);
  });
});

describe("buildErrorSummary", () => {
  it("should describe an unreachable source without pretending to know its contents", () => {
    // Act
    const summary = buildErrorSummary(
      "id",
      "slug",
      "Titulo",
      "sin respuesta",
      "2026-09-09T00:00:00.000Z"
    );

    // Assert
    expect(summary.status).toBe(SourceBadgeState.ERROR);
    expect(summary.totalResources).toBe(0);
    expect(summary.pendingCount).toBe(0);
    expect(summary.errorMessage).toBe("sin respuesta");
  });
});
