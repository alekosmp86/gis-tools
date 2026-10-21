import type { MappedFeature, MappedValue, SigraLayerDefinition, WfsFeature } from "../types";
import { LAYER_MAPPINGS } from "./layerMappings";

export { buildConca } from "./zonasFtthDerivations";
export type { MappedFeature, WfsFeature } from "../types";

function toMappedValue(value: unknown): MappedValue {
  if (typeof value === "string" || typeof value === "number") return value;
  if (typeof value === "boolean") return String(value);
  return null;
}

function serialiseGeometry(geometry: unknown): string | null {
  return geometry === null || geometry === undefined ? null : JSON.stringify(geometry);
}

export function mapFeature(layer: SigraLayerDefinition, feature: WfsFeature): MappedFeature {
  const mapping = LAYER_MAPPINGS[layer.id];
  const values: Record<string, MappedValue> = {};
  for (const { column, property } of mapping.direct) {
    values[column] = toMappedValue(feature.properties[property]);
  }
  for (const { column, derive } of mapping.derived) {
    values[column] = derive(feature.properties, values);
  }
  return { values, geometryJson: serialiseGeometry(feature.geometry) };
}
