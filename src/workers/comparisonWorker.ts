/**
 * comparisonWorker.ts
 * Web Worker — runs all CPU-intensive comparison logic off the main thread.
 * Delegates execution to SpatialComparisonEngine.
 */
import { ComparisonWorkerMessageType } from "@/types/workerMessages";
import type { WorkerInputMessage, WorkerOutputMessage } from "@/types/workerMessages";
import { SpatialComparisonEngine } from "./comparison/SpatialComparisonEngine";

const comparisonEngine = new SpatialComparisonEngine();

self.onmessage = (event: MessageEvent<WorkerInputMessage>) => {
  if (event.data.type !== ComparisonWorkerMessageType.RUN_COMPARISON) return;
  try {
    const {
      dbRecords,
      dbColumnTypes,
      fileDataset,
      mappingConfig,
      dbSchemaName,
      dbTableName,
    } = event.data.payload;

    const result = comparisonEngine.executeComparison(
      dbRecords,
      dbColumnTypes,
      fileDataset,
      mappingConfig,
      dbSchemaName,
      dbTableName,
      (phase, current, total) => {
        const msg: WorkerOutputMessage = {
          type: ComparisonWorkerMessageType.PROGRESS,
          phase,
          current,
          total,
        };
        self.postMessage(msg);
      }
    );

    const doneMsg: WorkerOutputMessage = {
      type: ComparisonWorkerMessageType.DONE,
      payload: result,
    };
    self.postMessage(doneMsg);
  } catch (err: unknown) {
    const errorMsg: WorkerOutputMessage = {
      type: ComparisonWorkerMessageType.ERROR,
      message: err instanceof Error ? err.message : "Error desconocido en el motor de comparación.",
    };
    self.postMessage(errorMsg);
  }
};
