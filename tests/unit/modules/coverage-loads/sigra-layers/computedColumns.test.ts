import { describe, expect, it } from "vitest";
import { SigraLayerId } from "@/modules/coverage-loads/sigra-layers/constants";
import { resolveLayerColumns } from "@/modules/coverage-loads/sigra-layers/domain/layerColumns";
import { SIGRA_LAYERS, getSigraLayer } from "@/modules/coverage-loads/sigra-layers/domain/layerRegistry";
import { ComputedKind } from "@/modules/coverage-loads/sigra-layers/types";

const DATE = { column: "fechaact", kind: ComputedKind.LOAD_DATE };
const DATE_TFO = { column: "fechacarga", kind: ComputedKind.LOAD_DATE };
const SOURCE = { column: "fuente", kind: ComputedKind.SOURCE };
const AREA = { column: "area_m2", kind: ComputedKind.AREA };
const ROUNDED_AREA = { column: "area_m2", kind: ComputedKind.ROUNDED_AREA };
const LATITUDE = { column: "latitud", kind: ComputedKind.LATITUDE };
const LONGITUDE = { column: "longitud", kind: ComputedKind.LONGITUDE };

type Computed = { column: string; kind: string };

const EXPECTED: ReadonlyArray<readonly [SigraLayerId, ReadonlyArray<Computed>]> = [
  [SigraLayerId.ZONAS_FTTH, [DATE, SOURCE]],
  [SigraLayerId.LIMITE_CENTRAL_FTTH, [DATE, AREA, SOURCE]],
  [SigraLayerId.AREA_CD_SR, [DATE]],
  [SigraLayerId.AREA_CABLE_COBRE, [DATE]],
  [SigraLayerId.AREA_CABLE_FTTH, [DATE, ROUNDED_AREA, SOURCE]],
  [SigraLayerId.AREA_CAJITAS_COBRE, [DATE]],
  [SigraLayerId.AREA_TFO, [DATE, SOURCE]],
  [SigraLayerId.LIMITE_CENTRAL_COBRE, [DATE, AREA, SOURCE]],
  [SigraLayerId.LIMITE_ECONOMICO_COBRE, [DATE, AREA, SOURCE]],
  [SigraLayerId.LIMITE_MIXTO_COBRE, [DATE, AREA, SOURCE]],
  [SigraLayerId.CAJA_DISTRIBUCION, [DATE]],
  [SigraLayerId.CAJITAS_COBRE, [DATE]],
  [SigraLayerId.TFO_DIVISORES, [DATE_TFO, SOURCE]],
  [SigraLayerId.CAMARAS, [DATE]],
  [SigraLayerId.CENTRALES_COBRE, [DATE, SOURCE]],
  [SigraLayerId.CENTRALES_FTTH, [DATE, SOURCE]],
  [SigraLayerId.POSTES, [DATE, LATITUDE, LONGITUDE, SOURCE]],
  [SigraLayerId.ZONAS_INSEGURIDAD, [DATE, AREA, SOURCE]],
];

const asKey = (entry: Computed): string => `${entry.column}:${entry.kind}`;

describe("SQL-computed columns per layer (spec: Column mappings)", () => {
  it("should cover all 18 registry layers in the table", () => {
    // Arrange & Act & Assert
    expect(EXPECTED.map(([layerId]) => layerId).sort()).toEqual(SIGRA_LAYERS.map((layer) => layer.id).sort());
  });

  it.each(EXPECTED)("should compute exactly the expected columns for %s", (layerId, expected) => {
    // Arrange
    const layer = getSigraLayer(layerId);

    // Act
    const computed = resolveLayerColumns(layer).computed.map(asKey).sort();

    // Assert
    expect(computed).toEqual(expected.map(asKey).sort());
  });

  it("should use fechacarga for tfo-divisores only and fechaact for every other layer", () => {
    // Arrange & Act
    const dateColumns = SIGRA_LAYERS.map((layer) => ({
      id: layer.id,
      column: resolveLayerColumns(layer).loadDateColumn,
    }));

    // Assert
    expect(dateColumns.filter((entry) => entry.column === "fechacarga").map((entry) => entry.id)).toEqual([SigraLayerId.TFO_DIVISORES]);
    expect(dateColumns.filter((entry) => entry.column === "fechaact")).toHaveLength(17);
  });

  it("should compute fuente for exactly the 12 layers that carry it", () => {
    // Arrange & Act
    const withSource = SIGRA_LAYERS.filter((layer) =>
      resolveLayerColumns(layer).computed.some((entry) => entry.kind === ComputedKind.SOURCE && entry.column === "fuente")
    ).map((layer) => layer.id);

    // Assert
    expect(withSource.sort()).toEqual(
      [
        SigraLayerId.ZONAS_FTTH,
        SigraLayerId.LIMITE_CENTRAL_FTTH,
        SigraLayerId.LIMITE_CENTRAL_COBRE,
        SigraLayerId.AREA_CABLE_FTTH,
        SigraLayerId.AREA_TFO,
        SigraLayerId.LIMITE_ECONOMICO_COBRE,
        SigraLayerId.LIMITE_MIXTO_COBRE,
        SigraLayerId.TFO_DIVISORES,
        SigraLayerId.CENTRALES_COBRE,
        SigraLayerId.CENTRALES_FTTH,
        SigraLayerId.POSTES,
        SigraLayerId.ZONAS_INSEGURIDAD,
      ].sort()
    );
  });

  it("should round the area only for area-cable-ftth and compute latitud and longitud only for postes", () => {
    // Arrange & Act
    const kindsOf = (kind: string) =>
      SIGRA_LAYERS.filter((layer) => resolveLayerColumns(layer).computed.some((entry) => entry.kind === kind)).map((layer) => layer.id);

    // Assert
    expect(kindsOf(ComputedKind.ROUNDED_AREA)).toEqual([SigraLayerId.AREA_CABLE_FTTH]);
    expect(kindsOf(ComputedKind.LATITUDE)).toEqual([SigraLayerId.POSTES]);
    expect(kindsOf(ComputedKind.LONGITUDE)).toEqual([SigraLayerId.POSTES]);
  });
});
