import { mapSequentially } from "../../shared/sequentially";
import { buildProbeUrl } from "../domain/wfsUrl";
import type { LayerProbe, SigraLayerDefinition, WfsPageFetcher } from "../types";

const PROBE_FAILURE_MESSAGE = "No se pudo consultar el WFS de SIGRA.";

function describeFailure(error: unknown): string {
  return error instanceof Error && error.message.length > 0 ? error.message : PROBE_FAILURE_MESSAGE;
}

async function probeLayer(layer: SigraLayerDefinition, fetcher: WfsPageFetcher): Promise<LayerProbe> {
  try {
    const page = await fetcher.fetchPage(buildProbeUrl(layer));
    return { layerId: layer.id, numberMatched: page.numberMatched, error: null };
  } catch (error: unknown) {
    return { layerId: layer.id, numberMatched: null, error: describeFailure(error) };
  }
}

/** One cheap request per layer, in input order. Never throws: a failure becomes the layer's error. */
export async function probeLayers(
  layers: ReadonlyArray<SigraLayerDefinition>,
  fetcher: WfsPageFetcher,
): Promise<LayerProbe[]> {
  return mapSequentially(layers, (layer) => probeLayer(layer, fetcher));
}
