import type { ComparisonSummary, SqlPatchSummary, ProgressCallback } from "@/core/types/comparison";
import type {
  WorkerRunComparisonInputMessage,
  WorkerGenerateSqlInputMessage,
  WorkerOutputMessage,
  SerializableFileDataset,
} from "@/core/types/workerMessages";

function runWorkerRequest<TResult>(
  message: WorkerRunComparisonInputMessage | WorkerGenerateSqlInputMessage,
  onProgress: ProgressCallback | undefined,
  fallbackErrorMessage: string
): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
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
          resolve(msg.payload as TResult);
          break;
        case "ERROR":
          worker.terminate();
          reject(new Error(msg.message));
          break;
      }
    };

    worker.onerror = (errorEvent) => {
      worker.terminate();
      reject(new Error(errorEvent.message ?? fallbackErrorMessage));
    };

    worker.postMessage(message);
  });
}

/**
 * Runs the comparison inside a Web Worker.
 * Falls back to an inline synchronous import if Worker is unavailable (SSR / old browsers).
 */
export async function runInWorker(
  input: WorkerRunComparisonInputMessage["payload"],
  onProgress?: ProgressCallback
): Promise<ComparisonSummary> {
  if (typeof Worker === "undefined") {
    // SSR / no-worker fallback: dynamic import so it stays out of the main bundle
    const { runComparisonSync } = await import("../workers/comparisonWorkerSync");
    return runComparisonSync(input, onProgress);
  }

  return runWorkerRequest<ComparisonSummary>(
    { type: "RUN_COMPARISON", payload: input } satisfies WorkerRunComparisonInputMessage,
    onProgress,
    "Error desconocido en el Web Worker."
  );
}

/**
 * Lazily generates full SQL patches inside a Web Worker.
 */
export async function generateSqlPatchesInWorker(
  input: WorkerGenerateSqlInputMessage["payload"],
  onProgress?: ProgressCallback
): Promise<SqlPatchSummary> {
  if (typeof Worker === "undefined") {
    const [{ SqlPatchGenerator }, { BinaryShpReader }, { ProjectionEngine }] =
      await Promise.all([
        import("../workers/comparison/SqlPatchGenerator"),
        import("../binary/BinaryShpReader"),
        import("../spatial/ProjectionEngine"),
      ]);

    const shpReader = input.fileDataset.shpBuffer
      ? new BinaryShpReader(input.fileDataset.shpBuffer)
      : null;

    const fileSrid = input.fileDataset.prjText
      ? ProjectionEngine.extractEpsg(input.fileDataset.prjText) ?? undefined
      : undefined;

    const generator = new SqlPatchGenerator({
      dbSchemaName: input.dbSchemaName,
      dbTableName: input.dbTableName,
      mappingConfig: input.mappingConfig,
      dbColumnTypes: input.dbColumnTypes,
      isBinaryDbf: Boolean(input.fileDataset.dbfBuffer),
      shpReader,
      fileSrid,
    });

    return generator.generatePatches(input.discrepancyItems, onProgress, true);
  }

  return runWorkerRequest<SqlPatchSummary>(
    { type: "GENERATE_SQL", payload: input } satisfies WorkerGenerateSqlInputMessage,
    onProgress,
    "Error en el Web Worker al generar parches SQL."
  );
}

/**
 * Serializes a ParsedFileDataset for postMessage transfer.
 * If binary buffers are present (dbfBuffer/shpBuffer), avoids converting millions of Map
 * records into plain JS objects, saving gigabytes of heap RAM.
 */
export function serializeFileDataset(dataset: {
  fileName: string;
  fileSize: number;
  featureCount: number;
  geometryType?: string;
  attributes: string[];
  recordsMap: Map<string, Record<string, unknown>>;
  geojson?: object;
  dbfBuffer?: Uint8Array;
  shpBuffer?: Uint8Array;
  cpgText?: string;
  prjText?: string;
  isLargeDataset?: boolean;
}): SerializableFileDataset {
  let recordsObject: Record<string, Record<string, unknown>> | undefined = undefined;

  // If no DBF binary buffer exists (e.g. CSV or raw GeoJSON), populate recordsObject
  if (!dataset.dbfBuffer) {
    recordsObject = {};
    dataset.recordsMap.forEach((record, key) => {
      recordsObject![key] = record;
    });
  }

  return {
    fileName: dataset.fileName,
    fileSize: dataset.fileSize,
    featureCount: dataset.featureCount,
    geometryType: dataset.geometryType,
    attributes: dataset.attributes,
    recordsObject,
    geojson: dataset.geojson,
    dbfBuffer: dataset.dbfBuffer,
    shpBuffer: dataset.shpBuffer,
    cpgText: dataset.cpgText,
    prjText: dataset.prjText,
  };
}
