import type { LayerColumns, SigraLayerDefinition } from "../types";
import { ComputedKind } from "../types";
import { LAYER_MAPPINGS } from "./layerMappings";

export function resolveLayerColumns(layer: SigraLayerDefinition): LayerColumns {
  const mapping = LAYER_MAPPINGS[layer.id];
  const valueColumns = [...mapping.direct.map((entry) => entry.column), ...mapping.derived.map((entry) => entry.column)];
  const stagingColumns = [...valueColumns, ...mapping.computed.map((entry) => entry.column), layer.geomColumn];
  const loadDate = mapping.computed.find((entry) => entry.kind === ComputedKind.LOAD_DATE);
  if (!loadDate) throw new Error(`La capa ${layer.id} no define su columna de fecha de carga.`);
  const extraColumns = new Set(layer.extraStagingColumns);
  return {
    valueColumns,
    computed: mapping.computed,
    stagingColumns,
    swapColumns: stagingColumns.filter((column) => !extraColumns.has(column)),
    loadDateColumn: loadDate.column,
  };
}
