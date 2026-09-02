/**
 * comparisonWorkerSync.ts
 * Synchronous SSR / fallback comparison engine — delegates execution to SpatialComparisonEngine.
 */
import type { WorkerInputMessage } from "@/types/workerMessages";
import type { ComparisonSummary } from "@/types/comparison";
import type { ProgressCallback } from "@/services/workerBridge";
import { SpatialComparisonEngine } from "./comparison/SpatialComparisonEngine";

const comparisonEngine = new SpatialComparisonEngine();

export async function runComparisonSync(
  payload: WorkerInputMessage["payload"],
  onProgress?: ProgressCallback
): Promise<ComparisonSummary> {
  const {
    dbRecords,
    dbColumnTypes,
    fileDataset,
    mappingConfig,
    dbSchemaName,
    dbTableName,
  } = payload;

  return comparisonEngine.executeComparison(
    dbRecords,
    dbColumnTypes,
    fileDataset,
    mappingConfig,
    dbSchemaName,
    dbTableName,
    (phase, current, total) => {
      onProgress?.(phase, current, total);
    }
  );
}
