import type { ColumnMappingConfig } from "@/types/gis";
import type { ComparisonSummary } from "@/types/comparison";

/**
 * Serializable version of ParsedFileDataset for postMessage transfer.
 * `recordsMap` (a Map) is converted to a plain object before crossing the worker boundary.
 * GeoJSON FeatureCollection is structuredClone-safe.
 */
export interface SerializableFileDataset {
  fileName: string;
  fileSize: number;
  featureCount: number;
  geometryType?: string;
  attributes: string[];
  /** Plain object representation of recordsMap for structured clone */
  recordsObject: Record<string, Record<string, unknown>>;
  geojson?: object;
}

/** Message sent FROM the main thread TO the worker */
export interface WorkerInputMessage {
  type: "RUN_COMPARISON";
  payload: {
    dbRecords: Array<Record<string, unknown>>;
    fileDataset: SerializableFileDataset;
    mappingConfig: ColumnMappingConfig;
    dbSchemaName: string;
    dbTableName: string;
  };
}

/** Progress update message sent FROM the worker TO the main thread */
export interface WorkerProgressMessage {
  type: "PROGRESS";
  phase: string;
  current: number;
  total: number;
}

/** Success message sent FROM the worker TO the main thread */
export interface WorkerDoneMessage {
  type: "DONE";
  payload: ComparisonSummary;
}

/** Error message sent FROM the worker TO the main thread */
export interface WorkerErrorMessage {
  type: "ERROR";
  message: string;
}

/** Union of all messages FROM the worker TO the main thread */
export type WorkerOutputMessage =
  | WorkerProgressMessage
  | WorkerDoneMessage
  | WorkerErrorMessage;
