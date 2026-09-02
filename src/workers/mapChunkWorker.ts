/**
 * mapChunkWorker.ts
 * Web Worker for off-main-thread GeoJSON chunk streaming.
 */
import { MapChunkMessageType } from "@/types/workerMessages";
import type { MapChunkInputMessage } from "@/types/workerMessages";
import { MapChunkStreamer } from "./map/MapChunkStreamer";

const streamer = new MapChunkStreamer();

self.onmessage = (event: MessageEvent<MapChunkInputMessage>) => {
  if (event.data.type !== MapChunkMessageType.CHUNK_GEOJSON) return;

  const { features, chunkSize } = event.data.payload;
  streamer.streamMicroChunks(features, chunkSize, (message) => {
    self.postMessage(message);
  });
};
