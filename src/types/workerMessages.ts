import type { ColumnMappingConfig, ComparisonSummary } from "@/types/comparison";
import type { Feature, Geometry, GeoJsonProperties } from "geojson";

export const MapChunkMessageType = {
  CHUNK_GEOJSON: "CHUNK_GEOJSON",
  CHUNK_BATCH: "CHUNK_BATCH",
  CHUNK_DONE: "CHUNK_DONE",
} as const;

export type MapChunkMessageType = (typeof MapChunkMessageType)[keyof typeof MapChunkMessageType];

export interface MapChunkInputMessage {
  type: typeof MapChunkMessageType.CHUNK_GEOJSON;
  payload: {
    features: Array<Feature<Geometry, GeoJsonProperties>>;
    chunkSize: number;
  };
}

export interface MapChunkOutputMessage {
  type: typeof MapChunkMessageType.CHUNK_BATCH | typeof MapChunkMessageType.CHUNK_DONE;
  payload: {
    chunk?: Array<Feature<Geometry, GeoJsonProperties>>;
    current: number;
    total: number;
  };
}

export const ComparisonWorkerMessageType = {
  RUN_COMPARISON: "RUN_COMPARISON",
  PROGRESS: "PROGRESS",
  DONE: "DONE",
  ERROR: "ERROR",
} as const;

export type ComparisonWorkerMessageType = (typeof ComparisonWorkerMessageType)[keyof typeof ComparisonWorkerMessageType];

export interface SerializableFileDataset {
  fileName: string;
  fileSize: number;
  featureCount: number;
  geometryType?: string;
  attributes: string[];
  /** Plain object representation of recordsMap (optional when dbfBuffer is provided) */
  recordsObject?: Record<string, Record<string, unknown>>;
  geojson?: object;
  /** Raw binary DBF buffer for zero-copy worker transfer */
  dbfBuffer?: Uint8Array;
  /** Raw binary SHP buffer for lazy geometry decoding */
  shpBuffer?: Uint8Array;
  /** Character encoding CPG text */
  cpgText?: string;
  /** Coordinate projection PRJ text */
  prjText?: string;
}


/** Message sent FROM the main thread TO the worker */
export interface WorkerInputMessage {
  type: typeof ComparisonWorkerMessageType.RUN_COMPARISON;
  payload: {
    dbRecords: Array<Record<string, unknown>>;
    fileDataset: SerializableFileDataset;
    mappingConfig: ColumnMappingConfig;
    dbSchemaName: string;
    dbTableName: string;
    dbColumnTypes?: Record<string, string>;
  };
}

/** Progress update message sent FROM the worker TO the main thread */
export interface WorkerProgressMessage {
  type: typeof ComparisonWorkerMessageType.PROGRESS;
  phase: string;
  current: number;
  total: number;
}

/** Success message sent FROM the worker TO the main thread */
export interface WorkerDoneMessage {
  type: typeof ComparisonWorkerMessageType.DONE;
  payload: ComparisonSummary;
}

/** Error message sent FROM the worker TO the main thread */
export interface WorkerErrorMessage {
  type: typeof ComparisonWorkerMessageType.ERROR;
  message: string;
}

/** Union of all messages FROM the worker TO the main thread */
export type WorkerOutputMessage =
  | WorkerProgressMessage
  | WorkerDoneMessage
  | WorkerErrorMessage;
