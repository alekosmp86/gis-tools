import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DegenerateRowsWarning } from "@/components/tools/db-sync-common/DegenerateRowsWarning";
import { DiscrepanciesSummaryBar } from "@/components/tools/db-sync-common/DiscrepanciesSummaryBar";
import {
  DiscrepancyFilter,
  type ComparisonSourceDescriptor,
  type ComparisonSummary,
  type DegenerateFileExample,
} from "@/core/types/comparison";

const descriptor: ComparisonSourceDescriptor = {
  targetLabel: "Base de Datos",
  targetShortLabel: "DB",
  targetIconKind: "database",
  sourceLabel: "Archivo CSV",
  sourceShortLabel: "CSV",
  sourceIconKind: "file",
};

const WARNING_START = "Filas del archivo con geometría degenerada";
const WARNING_END = "la geometría se redujo a un punto y las filas no se cargaron.";

const examplesOf = (count: number): DegenerateFileExample[] =>
  Array.from({ length: count }, (_, index) => ({ rowNumber: index + 1, suid: `K${index + 1}` }));

const renderWarning = (skipped: number, examples: DegenerateFileExample[] = []): string =>
  renderToStaticMarkup(React.createElement(DegenerateRowsWarning, { skipped, examples }));

function bar(overrides: Partial<ComparisonSummary> = {}): string {
  const summary = {
    totalDbRecords: 10,
    totalFileRecords: 12,
    totalAnalyzed: 12,
    exactMatchesCount: 5,
    attributeMismatchCount: 0,
    geometryMismatchCount: 0,
    onlyInDbCount: 0,
    onlyInShpCount: 0,
    nullSuidCount: 0,
    duplicateSuidCount: 0,
    items: [],
    sqlUpdateScript: "",
    sqlInsertScript: "",
    sqlUpdateCount: 0,
    sqlInsertCount: 0,
    sqlUpdatePreview: "",
    sqlInsertPreview: "",
    ...overrides,
  } as ComparisonSummary;
  return renderToStaticMarkup(
    React.createElement(DiscrepanciesSummaryBar, { summary, activeFilter: DiscrepancyFilter.ALL, onSelectFilter: () => {}, descriptor })
  );
}

describe("DegenerateRowsWarning (DG-3)", () => {
  it("should say how many rows were skipped and why, with the spec wording", () => {
    const html = renderWarning(3);

    expect(html).toContain(`${WARNING_START} (3 omitidas)`);
    expect(html).toContain(WARNING_END);
  });

  it("should format a large count with the thousands separator", () => {
    expect(renderWarning(1234)).toMatch(/\(1[.,\s ]?234 omitidas\)/);
  });

  it("should list the examples as Fila N: key, in order", () => {
    const html = renderWarning(2, [{ rowNumber: 7, suid: "ABC" }, { rowNumber: 12, suid: "XYZ" }]);

    expect(html).toContain("Fila 7: ABC");
    expect(html).toContain("Fila 12: XYZ");
    expect(html.indexOf("Fila 7")).toBeLessThan(html.indexOf("Fila 12"));
  });

  it("should say sin clave for an example with an empty key", () => {
    expect(renderWarning(1, [{ rowNumber: 4, suid: "" }])).toContain("Fila 4: sin clave");
  });

  it("should show no list when there are no examples", () => {
    const html = renderWarning(5, []);

    expect(html).not.toContain("<ul");
    expect(html).not.toContain("Fila ");
  });

  it("should list every example it is given, one item each, so the 20 cap comes from the result", () => {
    const html = renderWarning(40, examplesOf(20));

    expect(html.match(/<li/g)).toHaveLength(20);
    expect(html).toContain("Fila 20: K20");
    expect(html).not.toContain("Fila 21");
  });
});

describe("DiscrepanciesSummaryBar degenerate warning (DG-3)", () => {
  it("should show the warning with the count and the examples when rows were skipped", () => {
    const html = bar({ degenerateFileRowsSkipped: 2, degenerateFileExamples: [{ rowNumber: 3, suid: "A" }, { rowNumber: 8, suid: "B" }] });

    expect(html).toContain(`${WARNING_START} (2 omitidas)`);
    expect(html).toContain("Fila 3: A");
    expect(html).toContain("Fila 8: B");
  });

  it("should show the warning without a list when the examples are missing", () => {
    const html = bar({ degenerateFileRowsSkipped: 2 });

    expect(html).toContain(`${WARNING_START} (2 omitidas)`);
    expect(html).not.toContain("Fila ");
  });

  it.each([[0], [undefined]])("should hide the warning when the count is %s", (count) => {
    expect(bar({ degenerateFileRowsSkipped: count })).not.toContain(WARNING_START);
  });

  it("should hide the warning for a summary without the field, as before", () => {
    expect(bar()).not.toContain(WARNING_START);
    expect(bar()).not.toContain("geometría degenerada");
  });

  it("should keep the other banners working beside it", () => {
    const html = bar({ degenerateFileRowsSkipped: 1, pairingCappedGroups: 2 });

    expect(html).toContain(WARNING_START);
    expect(html).toContain("demasiado grandes para");
  });
});
