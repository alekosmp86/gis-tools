/**
 * mapChunkWorker.ts
 * Web Worker for off-main-thread GeoJSON chunk streaming.
 * Slices large feature arrays into micro-batch chunks and posts them back to UI thread.
 */
import { MapChunkMessageType } from "@/types/workerMessages";
import type { MapChunkInputMessage, MapChunkOutputMessage } from "@/types/workerMessages";

self.onmessage = (event: MessageEvent<MapChunkInputMessage>) => {
  if (event.data.type !== MapChunkMessageType.CHUNK_GEOJSON) return;

  const { features, chunkSize } = event.data.payload;
  const total = features.length;

  if (!features || total === 0) {
    const doneMsg: MapChunkOutputMessage = {
      type: MapChunkMessageType.CHUNK_DONE,
      payload: { current: 0, total: 0 },
    };
    self.postMessage(doneMsg);
    return;
  }

  for (let i = 0; i < total; i += chunkSize) {
    const chunk = features.slice(i, i + chunkSize);
    const current = Math.min(i + chunkSize, total);
    const batchMsg: MapChunkOutputMessage = {
      type: MapChunkMessageType.CHUNK_BATCH,
      payload: { chunk, current, total },
    };
    self.postMessage(batchMsg);
  }

  const doneMsg: MapChunkOutputMessage = {
    type: MapChunkMessageType.CHUNK_DONE,
    payload: { current: total, total },
  };
  self.postMessage(doneMsg);
};
