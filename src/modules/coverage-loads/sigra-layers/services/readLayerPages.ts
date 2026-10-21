import { buildPageUrl } from "../domain/wfsUrl";
import type { PageSource, SigraLayerDefinition, WfsFeature } from "../types";

export async function* readLayerPages(
  layer: SigraLayerDefinition,
  source: PageSource,
): AsyncGenerator<ReadonlyArray<WfsFeature>> {
  let startIndex = 0;
  let lastPageWasFull = true;
  while (lastPageWasFull) {
    const page = await source.fetchPage(buildPageUrl(layer, startIndex));
    if (page.features.length > 0) yield page.features;
    lastPageWasFull = page.features.length >= layer.pageSize;
    startIndex += layer.pageSize;
  }
}
