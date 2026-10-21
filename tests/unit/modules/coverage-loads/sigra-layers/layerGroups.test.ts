import { describe, expect, it } from "vitest";
import { REQUIRED_LAYER_IDS, SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { LAYER_GROUPS, LayerGroupId } from "@/modules/coverage-loads/sigra-layers/domain/layerGroups";
import { SIGRA_LAYERS } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";

const EXPECTED: Record<string, ReadonlyArray<string>> = {
  AVANCE: [SigraLayerId.ZONAS_FTTH, SigraLayerId.LIMITE_CENTRAL_FTTH],
  AREAS: [
    SigraLayerId.AREA_CD_SR,
    SigraLayerId.AREA_CABLE_COBRE,
    SigraLayerId.AREA_CABLE_FTTH,
    SigraLayerId.AREA_CAJITAS_COBRE,
    SigraLayerId.AREA_TFO,
  ],
  CENTRALES_LIMITES: [
    SigraLayerId.LIMITE_CENTRAL_COBRE,
    SigraLayerId.LIMITE_ECONOMICO_COBRE,
    SigraLayerId.LIMITE_MIXTO_COBRE,
    SigraLayerId.CENTRALES_COBRE,
    SigraLayerId.CENTRALES_FTTH,
  ],
  CAJAS: [SigraLayerId.CAJA_DISTRIBUCION, SigraLayerId.CAJITAS_COBRE, SigraLayerId.TFO_DIVISORES],
  RED: [SigraLayerId.CAMARAS, SigraLayerId.POSTES, SigraLayerId.ZONAS_INSEGURIDAD],
};

describe("LAYER_GROUPS (AC-10)", () => {
  it("should expose the five group ids as a const object", () => {
    // Arrange & Act & Assert
    expect(Object.keys(LayerGroupId)).toEqual(["AVANCE", "AREAS", "CENTRALES_LIMITES", "CAJAS", "RED"]);
  });

  it("should list the groups in the order AVANCE, AREAS, CENTRALES_LIMITES, CAJAS, RED", () => {
    // Arrange & Act & Assert
    expect(LAYER_GROUPS.map((group) => group.id)).toEqual([
      LayerGroupId.AVANCE,
      LayerGroupId.AREAS,
      LayerGroupId.CENTRALES_LIMITES,
      LayerGroupId.CAJAS,
      LayerGroupId.RED,
    ]);
  });

  it.each(Object.keys(EXPECTED))("should hold exactly the expected layers of %s in the expected order", (key) => {
    // Arrange
    const group = LAYER_GROUPS.find((candidate) => candidate.id === LayerGroupId[key as keyof typeof LayerGroupId]);

    // Act & Assert
    expect(group?.layerIds).toEqual(EXPECTED[key]);
  });

  it("should place every registry layer in exactly one group", () => {
    // Arrange
    const grouped = LAYER_GROUPS.flatMap((group) => group.layerIds);

    // Act & Assert
    expect(grouped).toHaveLength(SIGRA_LAYERS.length);
    expect(new Set(grouped).size).toBe(grouped.length);
    for (const layer of SIGRA_LAYERS) {
      expect(grouped.filter((id) => id === layer.id)).toHaveLength(1);
    }
  });

  it("should reference no layer id that the registry does not know", () => {
    // Arrange
    const known = new Set<string>(SIGRA_LAYERS.map((layer) => layer.id));

    // Act & Assert
    for (const id of LAYER_GROUPS.flatMap((group) => group.layerIds)) {
      expect(known.has(id)).toBe(true);
    }
  });

  it("should make AVANCE contain exactly the required layers", () => {
    // Arrange
    const avance = LAYER_GROUPS.find((group) => group.id === LayerGroupId.AVANCE);

    // Act & Assert
    expect([...(avance?.layerIds ?? [])].sort()).toEqual([...REQUIRED_LAYER_IDS].sort());
  });

  it("should keep every other group free of required layers", () => {
    // Arrange
    const others = LAYER_GROUPS.filter((group) => group.id !== LayerGroupId.AVANCE).flatMap((group) => group.layerIds);

    // Act & Assert
    for (const required of REQUIRED_LAYER_IDS) expect(others).not.toContain(required);
  });

  it("should give every group a non-empty Spanish label and a distinct one", () => {
    // Arrange
    const labels = LAYER_GROUPS.map((group) => group.label);

    // Act & Assert
    expect(labels.every((label) => label.trim().length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
