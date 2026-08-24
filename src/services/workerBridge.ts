import type { ComparisonSummary } from "@/types/comparison";
import type {
  WorkerInputMessage,
  WorkerOutputMessage,
  SerializableFileDataset,
} from "@/types/workerMessages";

export type ProgressCallback = (phase: string, current: number, total: number) => void;

/**
 * Runs the comparison inside a Web Worker.
 * Falls back to an inline synchronous import if Worker is unavailable (SSR / old browsers).
 */
export async function runInWorker(
  input: WorkerInputMessage["payload"],
  onProgress?: ProgressCallback
): Promise<ComparisonSummary> {
  if (typeof Worker === "undefined") {
    // SSR / no-worker fallback: dynamic import so it stays out of the main bundle
    const { runComparisonSync } = await import("../workers/comparisonWorkerSync");
    return runComparisonSync(input, onProgress);
  }

  return new Promise<ComparisonSummary>((resolve, reject) => {
    const worker = new Worker(
      new URL("../workers/comparisonWorker.ts", import.meta.url)
    );

    worker.onmessage = (event: MessageEvent<WorkerOutputMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case "PROGRESS":
          onProgress?.(msg.phase, msg.current, msg.total);
          break;
        case "DONE":
          worker.terminate();
          resolve(msg.payload);
          break;
        case "ERROR":
          worker.terminate();
          reject(new Error(msg.message));
          break;
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error(err.message ?? "Error desconocido en el Web Worker."));
    };

    worker.postMessage({ type: "RUN_COMPARISON", payload: input } satisfies WorkerInputMessage);
  });
}

/**
 * Serializes a ParsedFileDataset for postMessage transfer.
 * Converts Map<> → plain Record<> since Maps are not transferable via structuredClone.
 */
export function serializeFileDataset(dataset: {
  fileName: string;
  fileSize: number;
  featureCount: number;
  geometryType?: string;
  attributes: string[];
  recordsMap: Map<string, Record<string, unknown>>;
  geojson?: object;
}): SerializableFileDataset {
  const recordsObject: Record<string, Record<string, unknown>> = {};
  dataset.recordsMap.forEach((rec, key) => {
    recordsObject[key] = rec;
  });
  return {
    fileName: dataset.fileName,
    fileSize: dataset.fileSize,
    featureCount: dataset.featureCount,
    geometryType: dataset.geometryType,
    attributes: dataset.attributes,
    recordsObject,
    geojson: dataset.geojson,
  };
}
