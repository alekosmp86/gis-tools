import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscrepanciesSummaryBar } from "@/components/tools/db-sync-common/DiscrepanciesSummaryBar";
import {
  DiscrepancyFilter,
  type ComparisonSourceDescriptor,
  type ComparisonSummary,
} from "@/core/types/comparison";

const descriptor: ComparisonSourceDescriptor = {
  targetLabel: "Base de Datos",
  targetShortLabel: "DB",
  targetIconKind: "database",
  sourceLabel: "Archivo CSV",
  sourceShortLabel: "CSV",
  sourceIconKind: "file",
};

function summary(overrides: Partial<ComparisonSummary> = {}): ComparisonSummary {
  return {
    totalDbRecords: 10,
    totalFileRecords: 12,
    totalAnalyzed: 20,
    exactMatchesCount: 5,
    attributeMismatchCount: 2,
    geometryMismatchCount: 1,
    onlyInDbCount: 1,
    onlyInShpCount: 1,
    nullSuidCount: 0,
    duplicateSuidCount: 3,
    items: [],
    sqlUpdateScript: "",
    sqlInsertScript: "",
    sqlUpdateCount: 0,
    sqlInsertCount: 0,
    sqlUpdatePreview: "",
    sqlInsertPreview: "",
    ...overrides,
  } as ComparisonSummary;
}

function render(overrides: Partial<ComparisonSummary> = {}): string {
  return renderToStaticMarkup(
    React.createElement(DiscrepanciesSummaryBar, {
      summary: summary(overrides),
      activeFilter: DiscrepancyFilter.ALL,
      onSelectFilter: () => {},
      descriptor,
    })
  );
}

describe("DiscrepanciesSummaryBar pairing warnings", () => {
  it("should show no warning banner when nothing was capped or skipped", () => {
    // Act
    const html = render();

    // Assert
    expect(html).not.toContain("demasiado grandes para");
    expect(html).not.toContain("no generan UPDATE");
  });

  it("should show the capped-groups banner with the count when pairingCappedGroups is positive", () => {
    // Act
    const html = render({ pairingCappedGroups: 2 });

    // Assert
    expect(html).toContain("grupo(s) de claves repetidas demasiado grandes para");
    expect(html).toContain("2");
    expect(html).not.toContain("no generan UPDATE");
  });

  it("should show the unkeyed-updates banner when unkeyedUpdatesSkippedCount is positive", () => {
    // Act
    const html = render({ unkeyedUpdatesSkippedCount: 4 });

    // Assert
    expect(html).toContain("no generan UPDATE");
    expect(html).toContain("clave primaria");
    expect(html).not.toContain("demasiado grandes para");
  });

  it("should show both banners when both counters are positive", () => {
    // Act
    const html = render({ pairingCappedGroups: 1, unkeyedUpdatesSkippedCount: 1 });

    // Assert
    expect(html).toContain("demasiado grandes para");
    expect(html).toContain("no generan UPDATE");
  });

  it("should mention the skipped identical rows in the duplicate card subtitle only when present", () => {
    // Act
    const withSkipped = render({ duplicateFileRowsSkipped: 7 });
    const without = render({ duplicateFileRowsSkipped: 0 });

    // Assert
    expect(withSkipped).toContain("7 idénticas omitidas");
    expect(without).not.toContain("idénticas omitidas");
    expect(without).toContain("Filas idénticas repetidas o no emparejables");
  });
});
