/**
 * comparisonWorker.ts
 * Web Worker — runs all CPU-intensive comparison logic off the main thread.
 * Delegate execution to runComparisonCore.
 */
import { ComparisonWorkerMessageType } from "@/types/workerMessages";
import type { WorkerInputMessage, WorkerOutputMessage } from "@/types/workerMessages";
import { runComparisonCore } from "@/workers/comparisonCore";

self.onmessage = (event: MessageEvent<WorkerInputMessage>) => {
  if (event.data.type !== ComparisonWorkerMessageType.RUN_COMPARISON) return;
  try {
    const result = runComparisonCore(event.data.payload, (phase, current, total) => {
      const msg: WorkerOutputMessage = {
        type: ComparisonWorkerMessageType.PROGRESS,
        phase,
        current,
        total,
      };
      self.postMessage(msg);
    });
    const doneMsg: WorkerOutputMessage = {
      type: ComparisonWorkerMessageType.DONE,
      payload: result,
    };
    self.postMessage(doneMsg);
  } catch (err) {
    const errorMsg: WorkerOutputMessage = {
      type: ComparisonWorkerMessageType.ERROR,
      message: err instanceof Error ? err.message : "Error desconocido en el motor de comparación.",
    };
    self.postMessage(errorMsg);
  }
};
