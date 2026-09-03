/**
 * comparisonWorker.ts
 * Web Worker — runs CPU-intensive comparison logic and on-demand lazy SQL patch generation off the main thread.
 */
import { ComparisonWorkerMessageType } from "@/types/workerMessages";
import type {
  WorkerInputMessage,
  WorkerOutputMessage,
  WorkerDoneComparisonMessage,
  WorkerDoneGenerateSqlMessage,
} from "@/types/workerMessages";
import { SpatialComparisonEngine } from "./comparison/SpatialComparisonEngine";
import { SqlPatchGenerator } from "./comparison/SqlPatchGenerator";
import { BinaryShpReader } from "@/utils/binary/BinaryShpReader";
import { ProjectionEngine } from "@/utils/spatial/ProjectionEngine";

const comparisonEngine = new SpatialComparisonEngine();

self.onmessage = (event: MessageEvent<WorkerInputMessage>) => {
  const data = event.data;

  try {
    if (data.type === ComparisonWorkerMessageType.RUN_COMPARISON) {
      const {
        dbRecords,
        dbColumnTypes,
        fileDataset,
        mappingConfig,
        dbSchemaName,
        dbTableName,
      } = data.payload;

      const result = comparisonEngine.executeComparison(
        dbRecords,
        dbColumnTypes,
        fileDataset,
        mappingConfig,
        dbSchemaName,
        dbTableName,
        (phase, current, total) => {
          const progressMsg: WorkerOutputMessage = {
            type: ComparisonWorkerMessageType.PROGRESS,
            phase,
            current,
            total,
          };
          self.postMessage(progressMsg);
        }
      );

      const doneMsg: WorkerDoneComparisonMessage = {
        type: ComparisonWorkerMessageType.DONE,
        payload: result,
      };
      self.postMessage(doneMsg);
      return;
    }

    if (data.type === ComparisonWorkerMessageType.GENERATE_SQL) {
      const {
        discrepancyItems,
        fileDataset,
        mappingConfig,
        dbSchemaName,
        dbTableName,
        dbColumnTypes,
      } = data.payload;

      const shpReader = fileDataset.shpBuffer
        ? new BinaryShpReader(fileDataset.shpBuffer)
        : null;

      const fileSrid = fileDataset.prjText
        ? ProjectionEngine.extractEpsg(fileDataset.prjText) ?? undefined
        : undefined;

      const sqlPatchGenerator = new SqlPatchGenerator(
        dbSchemaName,
        dbTableName,
        mappingConfig,
        dbColumnTypes,
        Boolean(fileDataset.dbfBuffer),
        shpReader,
        fileSrid
      );

      const patchResult = sqlPatchGenerator.generatePatches(
        discrepancyItems,
        (phase, current, total) => {
          const progressMsg: WorkerOutputMessage = {
            type: ComparisonWorkerMessageType.PROGRESS,
            phase,
            current,
            total,
          };
          self.postMessage(progressMsg);
        },
        true // collectFullScript = true
      );

      const doneMsg: WorkerDoneGenerateSqlMessage = {
        type: ComparisonWorkerMessageType.DONE,
        payload: patchResult,
      };
      self.postMessage(doneMsg);
    }
  } catch (err: unknown) {
    const errorMsg: WorkerOutputMessage = {
      type: ComparisonWorkerMessageType.ERROR,
      message: err instanceof Error ? err.message : "Error desconocido en el Web Worker.",
    };
    self.postMessage(errorMsg);
  }
};
