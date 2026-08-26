/**
 * comparisonWorkerSync.ts
 * Synchronous SSR / fallback comparison engine — delegates execution to runComparisonCore.
 */
import type { WorkerInputMessage } from "@/types/workerMessages";
import type { ComparisonSummary } from "@/types/comparison";
import type { ProgressCallback } from "@/services/workerBridge";
import { runComparisonCore } from "@/workers/comparisonCore";

export async function runComparisonSync(
  payload: WorkerInputMessage["payload"],
  onProgress?: ProgressCallback
): Promise<ComparisonSummary> {
  return runComparisonCore(payload, (phase, current, total) => {
    onProgress?.(phase, current, total);
  });
}
