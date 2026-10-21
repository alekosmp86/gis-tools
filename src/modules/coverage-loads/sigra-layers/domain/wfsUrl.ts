import { WFS_BASE_URL, WfsParam } from "../constants";
import type { SigraLayerDefinition } from "../types";

const PROBE_COUNT = 1;

export function buildPageUrl(layer: SigraLayerDefinition, startIndex: number): string {
  const url = new URL(WFS_BASE_URL);
  url.searchParams.set(WfsParam.TYPE_NAME, layer.typeName);
  if (layer.cql !== null) url.searchParams.set(WfsParam.CQL_FILTER, layer.cql);
  url.searchParams.set(WfsParam.SORT_BY, layer.sortBy);
  url.searchParams.set(WfsParam.COUNT, String(layer.pageSize));
  url.searchParams.set(WfsParam.START_INDEX, String(startIndex));
  return url.toString();
}

export function buildProbeUrl(layer: SigraLayerDefinition): string {
  const url = new URL(buildPageUrl(layer, 0));
  url.searchParams.set(WfsParam.COUNT, String(PROBE_COUNT));
  return url.toString();
}
