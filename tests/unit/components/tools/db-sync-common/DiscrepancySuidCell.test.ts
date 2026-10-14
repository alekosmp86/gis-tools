import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DiscrepancySuidCell } from "@/components/tools/db-sync-common/DiscrepancySuidCell";
import {
  DiscrepancyType,
  PairingMethod,
  type ComparisonSourceDescriptor,
  type DiscrepancyItem,
  type ItemPairing,
} from "@/core/types/comparison";

const descriptor: ComparisonSourceDescriptor = {
  targetLabel: "Base de Datos",
  targetShortLabel: "DB",
  targetIconKind: "database",
  sourceLabel: "Archivo CSV",
  sourceShortLabel: "CSV",
  sourceIconKind: "file",
};

function item(overrides: Partial<DiscrepancyItem> = {}): DiscrepancyItem {
  return {
    id: "match-K-0",
    suid: "K-123",
    type: DiscrepancyType.ATTRIBUTE_MISMATCH,
    differences: [],
    ...overrides,
  };
}

function render(target: DiscrepancyItem): string {
  const table = React.createElement(
    "table",
    null,
    React.createElement(
      "tbody",
      null,
      React.createElement(
        "tr",
        null,
        React.createElement(DiscrepancySuidCell, { item: target, descriptor })
      )
    )
  );
  return renderToStaticMarkup(table);
}

const pairing = (overrides: Partial<ItemPairing>): ItemPairing => ({
  method: PairingMethod.EXACT,
  dbCount: 2,
  fileCount: 2,
  ...overrides,
});

describe("DiscrepancySuidCell pairing notes", () => {
  it("should render only the SUID when the item has no pairing, note or duplicate details", () => {
    // Act
    const html = render(item());

    // Assert
    expect(html).toContain("K-123");
    expect(html).not.toContain("Emparejado");
  });

  it.each([
    [PairingMethod.EXACT, "Emparejado por coincidencia"],
    [PairingMethod.ELIMINATION, "Emparejado por eliminación"],
    [PairingMethod.SKIPPED_CAP, "Grupo demasiado grande para emparejar"],
    [PairingMethod.NO_GEOMETRY, "No se puede emparejar sin geometría"],
  ])("should describe a %s pairing", (method, label) => {
    // Act
    const html = render(item({ pairing: pairing({ method }) }));

    // Assert
    expect(html).toContain(label);
  });

  it("should include the distance for a geometry pairing", () => {
    // Act
    const html = render(item({ pairing: pairing({ method: PairingMethod.GEOMETRY, distance: 0.5 }) }));

    // Assert
    expect(html).toContain("Emparejado por geometría (distancia 0.5)");
  });

  it("should omit the distance when a geometry pairing has none", () => {
    // Act
    const html = render(item({ pairing: pairing({ method: PairingMethod.GEOMETRY }) }));

    // Assert
    expect(html).toContain("Emparejado por geometría");
    expect(html).not.toContain("distancia");
  });

  it("should show the duplicate counts with the descriptor labels and the pairing note together", () => {
    // Act
    const html = render(
      item({
        type: DiscrepancyType.DUPLICATE_SUID,
        duplicateDetails: { targetCount: 3, sourceCount: 2 },
        pairing: pairing({ method: PairingMethod.NO_GEOMETRY, dbCount: 3, fileCount: 2 }),
      })
    );

    // Assert
    expect(html).toContain("SUID Duplicado");
    expect(html).toContain("No se puede emparejar sin geometría");
    expect(html).toContain("DB");
    expect(html).toContain("CSV");
  });

  it.each([
    [PairingMethod.SKIPPED_CAP, "Grupo demasiado grande para emparejar", "Grupo demasiado grande para emparejar (3 en DB / 2 en Archivo)"],
    [PairingMethod.NO_GEOMETRY, "No se puede emparejar sin geometría", "No se puede emparejar sin geometría en ambos lados"],
  ])(
    "should show the label once for an ambiguous %s pairing that only has a free-text note",
    (method, label, note) => {
      // Act
      const html = render(
        item({
          type: DiscrepancyType.DUPLICATE_SUID,
          note,
          pairing: pairing({ method, dbCount: 3, fileCount: 2 }),
        })
      );

      // Assert
      expect(html.split(label).length - 1).toBe(1);
    }
  );

  it("should show the counts line and the pairing label for an ambiguous pairing with duplicate details", () => {
    // Act
    const html = render(
      item({
        type: DiscrepancyType.DUPLICATE_SUID,
        note: "No se puede emparejar sin geometría en ambos lados",
        duplicateDetails: { targetCount: 3, sourceCount: 2 },
        pairing: pairing({ method: PairingMethod.NO_GEOMETRY, dbCount: 3, fileCount: 2 }),
      })
    );

    // Assert
    expect(html.replace(/<!-- -->/g, "")).toContain("SUID Duplicado (3 en DB / 2 en CSV)");
    expect(html.split("No se puede emparejar sin geometría").length - 1).toBe(1);
  });

  it("should still show the pairing label alongside a note for a non-ambiguous pairing", () => {
    // Act
    const html = render(
      item({ note: "nota de prueba", pairing: pairing({ method: PairingMethod.GEOMETRY, distance: 2 }) })
    );

    // Assert
    expect(html).toContain("nota de prueba");
    expect(html).toContain("Emparejado por geometría (distancia 2)");
  });

  it("should render the free-text note when there are no duplicate details", () => {
    // Act
    const html = render(item({ note: "nota de prueba" }));

    // Assert
    expect(html).toContain("nota de prueba");
  });
});
