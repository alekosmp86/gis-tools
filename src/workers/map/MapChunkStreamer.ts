import type { Feature } from "geojson";
import { MapChunkMessageType } from "@/types/workerMessages";
import type { MapChunkOutputMessage } from "@/types/workerMessages";

/**
 * MapChunkStreamer
 * Object-Oriented Service for progressive micro-batch slicing of GeoJSON vectors.
 */
export class MapChunkStreamer {
  /**
   * Slices features array into indexed micro-batches and passes them to the callback emitter.
   */
  public streamMicroChunks(
    features: Feature[],
    chunkSize: number,
    emitMessage: (message: MapChunkOutputMessage) => void
  ): void {
    const totalFeatures = features ? features.length : 0;

    if (!features || totalFeatures === 0) {
      emitMessage({
        type: MapChunkMessageType.CHUNK_DONE,
        payload: { current: 0, total: 0 },
      });
      return;
    }

    for (let featureOffset = 0; featureOffset < totalFeatures; featureOffset += chunkSize) {
      const rawChunk = features.slice(featureOffset, featureOffset + chunkSize);
      const chunk = rawChunk.map((featureItem, itemIndex) => ({
        ...featureItem,
        properties: {
          ...featureItem.properties,
          _featureIndex: featureOffset + itemIndex,
        },
      }));
      const current = Math.min(featureOffset + chunkSize, totalFeatures);

      emitMessage({
        type: MapChunkMessageType.CHUNK_BATCH,
        payload: { chunk, current, total: totalFeatures },
      });
    }

    emitMessage({
      type: MapChunkMessageType.CHUNK_DONE,
      payload: { current: totalFeatures, total: totalFeatures },
    });
  }
}
