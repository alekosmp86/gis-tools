import { describe, expect, it } from "vitest";
import { describeLayerStatus, describeLayerStep } from "@/modules/coverage-loads/sigra-layers/domain/statusLabels";
import { LayerLoadStatus, LayerLoadStep } from "@/modules/coverage-loads/sigra-layers/types";

describe("describeLayerStatus", () => {
  it.each([
    [LayerLoadStatus.LOADED, "Cargada"],
    [LayerLoadStatus.DRY_RUN_OK, "Prueba correcta"],
    [LayerLoadStatus.REJECTED_VALIDATION, "Rechazada por validación"],
    [LayerLoadStatus.FAILED, "Con error"],
  ])("should describe %s as %s", (status, label) => {
    // Arrange & Act & Assert
    expect(describeLayerStatus(status)).toBe(label);
  });

  it("should give every status a distinct label", () => {
    // Arrange
    const labels = Object.values(LayerLoadStatus).map(describeLayerStatus);

    // Act & Assert
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("describeLayerStep", () => {
  it.each([
    [LayerLoadStep.WFS, "Descarga SIGRA"],
    [LayerLoadStep.INSERT, "Inserción"],
    [LayerLoadStep.VALIDATION, "Validación"],
    [LayerLoadStep.SWAP, "Reemplazo de la tabla"],
    [null, "Conexión"],
  ])("should describe step %s as %s", (step, label) => {
    // Arrange & Act & Assert
    expect(describeLayerStep(step)).toBe(label);
  });
});
