import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { REQUIRED_LAYER_IDS, SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { describeReplaceWarning } from "@/modules/coverage-loads/sigra-layers/domain/replaceWarning";
import { SIGRA_LAYERS } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import { SigraRunActions } from "@/modules/coverage-loads/sigra-layers/ui/SigraRunActions";

const ALL_IDS = SIGRA_LAYERS.map((layer) => layer.id);

describe("describeReplaceWarning (confirmation before a real load)", () => {
  it("should name two tables, in the plural, for exactly the two required layers", () => {
    // Arrange & Act
    const text = describeReplaceWarning(REQUIRED_LAYER_IDS);

    // Assert
    expect(text).toMatch(/\b2 tablas\b/);
  });

  it("should not mention optional layers when only the required layers are selected", () => {
    // Arrange & Act
    const text = describeReplaceWarning(REQUIRED_LAYER_IDS);

    // Assert
    expect(text).not.toMatch(/opcional/i);
  });

  it("should say there is no undo", () => {
    // Arrange & Act
    const texts = [describeReplaceWarning(REQUIRED_LAYER_IDS), describeReplaceWarning(ALL_IDS)];

    // Assert
    for (const text of texts) expect(text).toMatch(/deshacer/i);
  });

  it("should also say that optional layers are replaced when the selection includes one", () => {
    // Arrange & Act
    const text = describeReplaceWarning([...REQUIRED_LAYER_IDS, SigraLayerId.CAMARAS]);

    // Assert
    expect(text).toMatch(/opcional/i);
    expect(text).toMatch(/\b3 tablas\b/);
  });

  it("should count every selected layer when all 18 are selected", () => {
    // Arrange & Act
    const text = describeReplaceWarning(ALL_IDS);

    // Assert
    expect(text).toMatch(/\b18 tablas\b/);
    expect(text).toMatch(/opcional/i);
  });

  it("should use the singular for a single table", () => {
    // Arrange & Act
    const text = describeReplaceWarning([SigraLayerId.ZONAS_FTTH]);

    // Assert
    expect(text).toMatch(/\b1 tabla\b(?!s)/);
    expect(text).not.toMatch(/\b1 tablas\b/);
  });

  it("should use the singular and mention optional layers for a single optional layer", () => {
    // Arrange & Act
    const text = describeReplaceWarning([SigraLayerId.POSTES]);

    // Assert
    expect(text).toMatch(/\b1 tabla\b(?!s)/);
    expect(text).toMatch(/opcional/i);
  });

  it("should contain the count as a digit and return a non-empty sentence", () => {
    // Arrange & Act
    const text = describeReplaceWarning([SigraLayerId.ZONAS_FTTH, SigraLayerId.LIMITE_CENTRAL_FTTH, SigraLayerId.POSTES, SigraLayerId.CAMARAS]);

    // Assert
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text).toMatch(/\b4\b/);
  });
});

describe("SigraRunActions", () => {
  function render(overrides: Partial<React.ComponentProps<typeof SigraRunActions>> = {}): string {
    return renderToStaticMarkup(
      React.createElement(SigraRunActions, {
        canRun: true,
        busy: false,
        selectedLayerIds: REQUIRED_LAYER_IDS,
        onDryRun: vi.fn(),
        onLoad: vi.fn(),
        ...overrides,
      })
    );
  }

  function buttonWith(html: string, label: string): string {
    const buttons = html.match(/<button[\s\S]*?<\/button>/g) ?? [];
    return buttons.find((button) => button.includes(label)) ?? "";
  }

  it("should show both buttons enabled and no confirmation text on the initial render", () => {
    // Arrange & Act
    const html = render();

    // Assert
    expect(buttonWith(html, "Probar sin guardar")).not.toBe("");
    expect(buttonWith(html, "Cargar y reemplazar")).not.toBe("");
    expect(buttonWith(html, "Probar sin guardar")).not.toMatch(/\bdisabled\b/);
    expect(buttonWith(html, "Cargar y reemplazar")).not.toMatch(/\bdisabled\b/);
    expect(html).not.toMatch(/deshacer/i);
    expect(html).not.toMatch(/\btablas?\b/i);
  });

  it("should disable both buttons when the selection cannot run", () => {
    // Arrange & Act
    const html = render({ canRun: false });

    // Assert
    expect(buttonWith(html, "Probar sin guardar")).toMatch(/\bdisabled\b/);
    expect(buttonWith(html, "Cargar y reemplazar")).toMatch(/\bdisabled\b/);
  });

  it("should disable both buttons while busy", () => {
    // Arrange & Act
    const html = render({ busy: true });

    // Assert
    expect(buttonWith(html, "Probar sin guardar")).toMatch(/\bdisabled\b/);
    expect(buttonWith(html, "Cargar y reemplazar")).toMatch(/\bdisabled\b/);
  });

  it("should use no inline styles", () => {
    // Arrange & Act
    const html = render({ selectedLayerIds: ALL_IDS });

    // Assert
    expect(html).not.toContain("style=");
  });
});
