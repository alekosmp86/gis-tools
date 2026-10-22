import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { INITIAL_CONNECTION } from "@/modules/coverage-loads/shared/domain/connectionState";
import { REQUIRED_LAYER_IDS, SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { LAYER_GROUPS } from "@/modules/coverage-loads/sigra-layers/domain/layerGroups";
import { SIGRA_LAYERS, getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import { SigraFlowPhase, createInitialSigraFlow } from "@/modules/coverage-loads/sigra-layers/domain/sigraFlow";
import { SigraLayerRow } from "@/modules/coverage-loads/sigra-layers/ui/SigraLayerRow";
import { SigraLayerTable } from "@/modules/coverage-loads/sigra-layers/ui/SigraLayerTable";
import { SigraLayersPanel } from "@/modules/coverage-loads/sigra-layers/ui/SigraLayersPanel";
import { SigraResultRow } from "@/modules/coverage-loads/sigra-layers/ui/SigraResultRow";
import { SigraResultTable } from "@/modules/coverage-loads/sigra-layers/ui/SigraResultTable";
import shared from "@/modules/coverage-loads/sigra-layers/ui/SigraShared.module.css";
import { useSigraLayersFlow } from "@/modules/coverage-loads/sigra-layers/ui/useSigraLayersFlow";
import {
  LayerLoadStatus,
  LayerLoadStep,
  type LayerLoadResult,
  type PlanLayer,
  type SigraPlan,
} from "@/modules/coverage-loads/sigra-layers/types";

const useFlowMock = vi.hoisted(() => vi.fn<typeof useSigraLayersFlow>());

vi.mock("@/modules/coverage-loads/sigra-layers/ui/useSigraLayersFlow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/coverage-loads/sigra-layers/ui/useSigraLayersFlow")>();
  useFlowMock.mockImplementation(actual.useSigraLayersFlow);
  return { ...actual, useSigraLayersFlow: useFlowMock };
});

const [ZONAS, LIMITE] = REQUIRED_LAYER_IDS;
const OPTIONAL = SigraLayerId.CAMARAS;

function planLayer(layerId: SigraLayerId, overrides: Partial<PlanLayer> = {}): PlanLayer {
  const definition = getSigraLayer(layerId);
  return {
    layerId,
    label: definition.label,
    required: definition.required,
    tableExists: true,
    rowCount: 12345,
    lastUpdated: "2026-09-30",
    missingPrivileges: [],
    wfsCount: 54321,
    wfsError: null,
    blockers: [],
    canLoad: true,
    ...overrides,
  };
}

function planOf(overrides: Record<string, Partial<PlanLayer>> = {}): SigraPlan {
  return {
    layers: SIGRA_LAYERS.map((layer) => planLayer(layer.id, overrides[layer.id])),
    blockers: [],
    warnings: [],
    canLoad: true,
  };
}

function resultOf(layerId: SigraLayerId, overrides: Partial<LayerLoadResult> = {}): LayerLoadResult {
  return {
    layerId,
    status: LayerLoadStatus.LOADED,
    downloaded: 1111,
    staged: 2222,
    duplicatesIgnored: 33,
    previousCount: 4444,
    finalCount: 5555,
    elapsedMs: 10,
    step: null,
    message: "Carga correcta",
    auditWarning: null,
    ...overrides,
  };
}

function renderTable(overrides: Partial<React.ComponentProps<typeof SigraLayerTable>> = {}): string {
  return renderToStaticMarkup(
    React.createElement(SigraLayerTable, {
      plan: planOf(),
      selection: [ZONAS, LIMITE],
      disabled: false,
      onToggle: vi.fn(),
      ...overrides,
    })
  );
}

function checkboxTags(html: string): string[] {
  return html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
}

function rowOf(html: string, label: string): string {
  const rows = html.split(/<(?:tr|li)[\s>]/).slice(1);
  const row = rows.find((candidate) => candidate.includes(label) && candidate.includes('type="checkbox"'));
  return row ?? "";
}

describe("SigraLayerTable (AC-10)", () => {
  it("should render a heading with the label of every group", () => {
    // Arrange & Act
    const html = renderTable();

    // Assert
    for (const group of LAYER_GROUPS) expect(html).toContain(group.label);
  });

  it("should render one checkbox per layer of the plan", () => {
    // Arrange & Act
    const html = renderTable();

    // Assert
    expect(checkboxTags(html)).toHaveLength(SIGRA_LAYERS.length);
  });

  it("should mark exactly the two required layers as Obligatoria", () => {
    // Arrange & Act
    const html = renderTable();

    // Assert
    expect(html.match(/Obligatoria/g)).toHaveLength(2);
    expect(rowOf(html, getSigraLayer(ZONAS).label)).toContain("Obligatoria");
    expect(rowOf(html, getSigraLayer(OPTIONAL).label)).not.toContain("Obligatoria");
  });

  it("should check exactly the selected layers", () => {
    // Arrange & Act
    const html = renderTable({ selection: [ZONAS, LIMITE, OPTIONAL] });

    // Assert
    const checked = checkboxTags(html).filter((tag) => /\bchecked\b/.test(tag));
    expect(checked).toHaveLength(3);
    expect(rowOf(html, getSigraLayer(OPTIONAL).label)).toMatch(/\bchecked\b/);
    expect(rowOf(html, getSigraLayer(SigraLayerId.POSTES).label)).not.toMatch(/\bchecked\b/);
  });

  it("should disable only the required checkboxes when the table is enabled", () => {
    // Arrange & Act
    const html = renderTable({ disabled: false });

    // Assert
    const disabled = checkboxTags(html).filter((tag) => /\bdisabled\b/.test(tag));
    expect(disabled).toHaveLength(2);
    expect(rowOf(html, getSigraLayer(LIMITE).label)).toMatch(/\bdisabled\b/);
    expect(rowOf(html, getSigraLayer(OPTIONAL).label)).not.toMatch(/\bdisabled\b/);
  });

  it("should disable every checkbox when the table is disabled", () => {
    // Arrange & Act
    const html = renderTable({ disabled: true });

    // Assert
    expect(checkboxTags(html).every((tag) => /\bdisabled\b/.test(tag))).toBe(true);
  });

  it("should show row counts, last update and the SGRA count of a layer", () => {
    // Arrange & Act
    const html = renderTable();

    // Assert
    const row = rowOf(html, getSigraLayer(OPTIONAL).label);
    expect(row).toMatch(/12[.,\s]?345/);
    expect(row).toContain("2026-09-30");
    expect(row).toMatch(/54[.,\s]?321/);
  });

  it("should show an em dash for null counts and a null last update", () => {
    // Arrange
    const plan = planOf({ [OPTIONAL]: { rowCount: null, lastUpdated: null, wfsCount: null } });

    // Act
    const row = rowOf(renderTable({ plan }), getSigraLayer(OPTIONAL).label);

    // Assert
    expect(row.match(/—/g)?.length).toBeGreaterThanOrEqual(3);
    expect(row).not.toMatch(/12[.,\s]?345/);
  });

  it("should show every blocker text of a layer", () => {
    // Arrange
    const plan = planOf({
      [OPTIONAL]: { canLoad: false, blockers: ["Falta permiso INSERT", "El WFS no responde"] },
    });

    // Act
    const row = rowOf(renderTable({ plan }), getSigraLayer(OPTIONAL).label);

    // Assert
    expect(row).toContain("Falta permiso INSERT");
    expect(row).toContain("El WFS no responde");
  });

  it("should not render a layer that is missing from the plan", () => {
    // Arrange
    const plan = planOf();
    const partial: SigraPlan = { ...plan, layers: plan.layers.filter((layer) => layer.layerId !== OPTIONAL) };

    // Act
    const html = renderTable({ plan: partial });

    // Assert
    expect(html).not.toContain(getSigraLayer(OPTIONAL).label);
    expect(checkboxTags(html)).toHaveLength(SIGRA_LAYERS.length - 1);
  });

  it("should use no inline styles", () => {
    // Arrange & Act
    const html = renderTable({ plan: planOf({ [OPTIONAL]: { blockers: ["x"] } }) });

    // Assert
    expect(html).not.toContain("style=");
  });
});

describe("SigraResultTable (AC-3, AC-9)", () => {
  function renderResults(results: ReadonlyArray<LayerLoadResult>, dryRun = false): string {
    return renderToStaticMarkup(React.createElement(SigraResultTable, { results, dryRun }));
  }

  it("should render nothing for empty results", () => {
    // Arrange & Act & Assert
    expect(renderResults([])).toBe("");
    expect(renderResults([], true)).toBe("");
  });

  it("should head a real run with Resultado de la carga", () => {
    // Arrange & Act
    const html = renderResults([resultOf(ZONAS)], false);

    // Assert
    expect(html).toContain("Resultado de la carga");
    expect(html).not.toContain("Prueba sin guardar");
  });

  it("should head a dry run with Prueba sin guardar", () => {
    // Arrange & Act
    const html = renderResults([resultOf(ZONAS, { status: LayerLoadStatus.DRY_RUN_OK })], true);

    // Assert
    expect(html).toContain("Prueba sin guardar");
    expect(html).not.toContain("Resultado de la carga");
  });

  it("should show the layer label, the Spanish status and the numbers", () => {
    // Arrange & Act
    const html = renderResults([resultOf(ZONAS)]);

    // Assert
    expect(html).toContain(getSigraLayer(ZONAS).label);
    expect(html).toContain("Cargada");
    for (const figure of [/1[.,\s]?111/, /2[.,\s]?222/, /\b33\b/, /4[.,\s]?444/, /5[.,\s]?555/]) {
      expect(html).toMatch(figure);
    }
  });

  it("should show the failed step and the message of a failed layer", () => {
    // Arrange
    const failed = resultOf(ZONAS, {
      status: LayerLoadStatus.FAILED,
      step: LayerLoadStep.WFS,
      previousCount: null,
      finalCount: null,
      message: "El servicio SIGRA no respondió",
    });

    // Act
    const html = renderResults([failed]);

    // Assert
    expect(html).toContain("Con error");
    expect(html).toContain("Descarga SIGRA");
    expect(html).toContain("El servicio SIGRA no respondió");
  });

  it("should show the step and the message of a rejected layer", () => {
    // Arrange
    const rejected = resultOf(LIMITE, {
      status: LayerLoadStatus.REJECTED_VALIDATION,
      step: LayerLoadStep.VALIDATION,
      message: "La capa trae menos del 97% de los registros actuales",
    });

    // Act
    const html = renderResults([rejected]);

    // Assert
    expect(html).toContain("Rechazada por validación");
    expect(html).toContain("Validación");
    expect(html).toContain("La capa trae menos del 97% de los registros actuales");
  });

  it("should not show the step or the message of a layer that loaded", () => {
    // Arrange & Act
    const html = renderResults([resultOf(ZONAS, { message: "Mensaje interno de éxito" })]);

    // Assert
    expect(html).not.toContain("Mensaje interno de éxito");
    expect(html).not.toContain("Descarga SIGRA");
  });

  it("should show the audit warning only when there is one", () => {
    // Arrange & Act
    const withWarning = renderResults([resultOf(ZONAS, { auditWarning: "No se pudo escribir la auditoría" })]);
    const without = renderResults([resultOf(ZONAS)]);

    // Assert
    expect(withWarning).toContain("No se pudo escribir la auditoría");
    expect(without).not.toContain("auditoría");
  });

  it("should render one entry per result", () => {
    // Arrange & Act
    const html = renderResults([resultOf(ZONAS), resultOf(LIMITE), resultOf(OPTIONAL)]);

    // Assert
    for (const id of [ZONAS, LIMITE, OPTIONAL]) expect(html).toContain(getSigraLayer(id).label);
  });

  it("should use no inline styles", () => {
    // Arrange & Act
    const html = renderResults([resultOf(ZONAS, { auditWarning: "aviso" }), resultOf(LIMITE, { status: LayerLoadStatus.FAILED, step: LayerLoadStep.SWAP })]);

    // Assert
    expect(html).not.toContain("style=");
  });
});

const LAYER_VARIACION_CELL = 4;
const RESULT_VARIACION_CELL = 6;

function cellOf(html: string, index: number): string {
  return (html.match(/<td[^>]*>[\s\S]*?<\/td>/g) ?? [])[index] ?? "";
}

function variationCellOf(html: string, index: number): string {
  return cellOf(html, index);
}

function variationTextOf(html: string, index: number): string {
  return cellOf(html, index).replace(/<[^>]+>/g, "");
}

function inTable(row: React.ReactElement): string {
  return renderToStaticMarkup(React.createElement("table", null, React.createElement("tbody", null, row)));
}

describe("Variación cell of SigraLayerRow", () => {
  function renderLayerRow(layer: PlanLayer): string {
    return inTable(
      React.createElement(SigraLayerRow, { layer, isSelected: false, isLocked: false, onToggle: vi.fn() })
    );
  }

  it("should show a plus-signed delta when the WFS count is above the table count", () => {
    // Arrange
    const layer = planLayer(OPTIONAL, { rowCount: 100, wfsCount: 150 });

    // Act
    const html = renderLayerRow(layer);

    // Assert
    expect(variationTextOf(html, LAYER_VARIACION_CELL)).toBe("+50");
    expect(variationCellOf(html, LAYER_VARIACION_CELL)).toContain(shared.positive);
  });

  it("should show a minus-signed delta when the WFS count is below the table count", () => {
    // Arrange
    const layer = planLayer(OPTIONAL, { rowCount: 100, wfsCount: 95 });

    // Act
    const html = renderLayerRow(layer);

    // Assert
    expect(variationTextOf(html, LAYER_VARIACION_CELL)).toBe("-5");
    expect(variationCellOf(html, LAYER_VARIACION_CELL)).toContain(shared.negative);
  });

  it("should show a plain zero without a direction class when the counts match", () => {
    // Arrange
    const layer = planLayer(OPTIONAL, { rowCount: 777, wfsCount: 777 });

    // Act
    const html = renderLayerRow(layer);

    // Assert
    expect(variationTextOf(html, LAYER_VARIACION_CELL)).toBe("0");
    expect(variationCellOf(html, LAYER_VARIACION_CELL)).not.toContain(shared.positive);
    expect(variationCellOf(html, LAYER_VARIACION_CELL)).not.toContain(shared.negative);
  });

  it("should show an em dash when the WFS count is unknown", () => {
    // Arrange
    const layer = planLayer(OPTIONAL, { rowCount: 100, wfsCount: null });

    // Act
    const html = renderLayerRow(layer);

    // Assert
    expect(variationTextOf(html, LAYER_VARIACION_CELL)).toBe("—");
  });
});

describe("Variación cell of SigraResultRow", () => {
  function renderResultRow(result: LayerLoadResult, dryRun: boolean): string {
    return inTable(React.createElement(SigraResultRow, { result, dryRun }));
  }

  it("should show the staged difference against the previous count on a dry run", () => {
    // Arrange
    const result = resultOf(ZONAS, { status: LayerLoadStatus.DRY_RUN_OK, staged: 2222, previousCount: 4444 });

    // Act
    const text = variationTextOf(renderResultRow(result, true), RESULT_VARIACION_CELL);

    // Assert
    expect(text).toMatch(/^-2[.,\s]?222$/);
  });

  it("should show the final difference against the previous count on a real run", () => {
    // Arrange
    const result = resultOf(ZONAS, { staged: 2222, previousCount: 4444, finalCount: 5555 });

    // Act
    const html = renderResultRow(result, false);

    // Assert
    expect(variationTextOf(html, RESULT_VARIACION_CELL)).toMatch(/^\+1[.,\s]?111$/);
    expect(variationCellOf(html, RESULT_VARIACION_CELL)).toContain(shared.positive);
  });

  it("should show an em dash for a failed layer", () => {
    // Arrange
    const result = resultOf(ZONAS, {
      status: LayerLoadStatus.FAILED,
      step: LayerLoadStep.WFS,
      previousCount: 4444,
      finalCount: null,
    });

    // Act
    const text = variationTextOf(renderResultRow(result, false), RESULT_VARIACION_CELL);

    // Assert
    expect(text).toBe("—");
  });
});

describe("SigraLayersPanel", () => {
  it("should render its initial PLANNING state without throwing, saying it is consulting, with no inline styles", () => {
    // Arrange & Act
    const html = renderToStaticMarkup(
      React.createElement(SigraLayersPanel, {
        connection: INITIAL_CONNECTION,
        connectionRevision: 0,
        onStatusChange: vi.fn(),
      })
    );

    // Assert
    expect(html).toContain("Consultando");
    expect(html).not.toContain("style=");
  });

  describe("result modal", () => {
    function renderWithPhase(phase: SigraFlowPhase, results: ReadonlyArray<LayerLoadResult>): string {
      const state = { ...createInitialSigraFlow(), phase, results, lastRunDryRun: false };
      useFlowMock.mockImplementationOnce(() => ({
        state,
        canRun: false,
        refresh: vi.fn(),
        toggleLayer: vi.fn(),
        selectAll: vi.fn(),
        selectRequiredOnly: vi.fn(),
        runDryRun: vi.fn(),
        runLoad: vi.fn(),
      }));
      return renderToStaticMarkup(
        React.createElement(SigraLayersPanel, {
          connection: INITIAL_CONNECTION,
          connectionRevision: 0,
          onStatusChange: vi.fn(),
        })
      );
    }

    it("should keep the result modal mounted while PLANNING when results of the last run exist", () => {
      // Arrange & Act
      const html = renderWithPhase(SigraFlowPhase.PLANNING, [resultOf(ZONAS)]);

      // Assert
      expect(html).toContain('aria-label="Resultado de la corrida"');
      expect(html).toContain("Resultado de la carga");
    });

    it("should not mount the result modal while a run is RUNNING", () => {
      // Arrange & Act
      const html = renderWithPhase(SigraFlowPhase.RUNNING, [resultOf(ZONAS)]);

      // Assert
      expect(html).not.toContain('aria-label="Resultado de la corrida"');
    });

    it("should not mount the result modal when there are no results", () => {
      // Arrange & Act
      const html = renderWithPhase(SigraFlowPhase.READY, []);

      // Assert
      expect(html).not.toContain('aria-label="Resultado de la corrida"');
    });
  });
});
