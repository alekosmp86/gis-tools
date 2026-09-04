import type { ComparisonSummary, SqlPatchSummary } from "@/types/comparison";
import type {
  WorkerRunComparisonInputMessage,
  WorkerGenerateSqlInputMessage,
  WorkerOutputMessage,
  SerializableFileDataset,
} from "@/types/workerMessages";

export type ProgressCallback = (phase: string, current: number, total: number) => void;

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
          resolve(msg.payload as ComparisonSummary);
          break;
        case "ERROR":
          worker.terminate();
          reject(new Error(msg.message));
          break;
      }
    };

    worker.onerror = (errorEvent) => {
      worker.terminate();
      reject(new Error(errorEvent.message ?? "Error desconocido en el Web Worker."));
    };

    worker.postMessage({
      type: "RUN_COMPARISON",
      payload: input,
    } satisfies WorkerRunComparisonInputMessage);
  });
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
        import("../utils/binary/BinaryShpReader"),
        import("../utils/spatial/ProjectionEngine"),
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

  return new Promise<SqlPatchSummary>((resolve, reject) => {
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
          resolve(msg.payload as SqlPatchSummary);
          break;
        case "ERROR":
          worker.terminate();
          reject(new Error(msg.message));
          break;
      }
    };

    worker.onerror = (errorEvent) => {
      worker.terminate();
      reject(new Error(errorEvent.message ?? "Error en el Web Worker al generar parches SQL."));
    };

    worker.postMessage({
      type: "GENERATE_SQL",
      payload: input,
    } satisfies WorkerGenerateSqlInputMessage);
  });
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
