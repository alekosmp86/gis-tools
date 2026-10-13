export const MIB = 1 << 20;
export const EWKB_SRID = 32721;

export const SHAPE_TYPE = { Null: 0, Polygon: 5 } as const;

export type ProgressCallback = (bytesRead: number, bytesTotal: number) => void;

export interface ReaderOptions {
  signal?: AbortSignal;
  onProgress?: ProgressCallback;
}

export interface ScanOptions extends ReaderOptions {
  perRecord?: boolean;
}

export interface ShpRecordHeader {
  recordNumber: number;
  shapeType: number;
  contentOffset: number;
  contentLength: number;
  numParts: number;
  numPoints: number;
  /** numParts + 1 entries; the last one equals numPoints. Empty for null shapes. */
  parts: Int32Array;
  /** Absolute file offset of the first point (x, y little-endian float64 pairs). */
  pointsOffset: number;
}

export interface RingSummary {
  shellCount: number;
  holeCount: number;
  degenerateCount: number;
  unclosedCount: number;
  netArea: number;
}

export interface RecordScanSummary {
  length: number;
  recordNumbers: Int32Array;
  ringCounts: Int32Array;
  pointCounts: Int32Array;
  shellCounts: Int32Array;
  holeCounts: Int32Array;
  netAreas: Float64Array;
}

export interface ShapefileScan {
  fileSize: number;
  /** All records, null shapes included. */
  recordCount: number;
  nullRecordCount: number;
  pointCount: number;
  ringCount: number;
  shellCount: number;
  holeCount: number;
  /** Rings with fewer than 4 points or zero area: never emitted. */
  degenerateRingCount: number;
  unclosedRingCount: number;
  netArea: number;
  perRecord?: RecordScanSummary;
}

export interface EwkbRecord {
  recordNumber: number;
  /** Exact byte length of the whole EWKB, known before streaming. */
  totalBytes: number;
  /**
   * Streams the EWKB as slices of at most 1 MiB whose lengths sum to totalBytes.
   * Callable once, and only while this record is the one most recently yielded
   * by the generator. Each slice is a fresh buffer owned by the consumer.
   */
  chunks: () => AsyncIterable<Uint8Array>;
  netArea: number;
  pointCount: number;
}

export interface EwkbIterationSummary {
  recordCount: number;
  nullRecordCount: number;
  /** Non-null records without any valid shell (nothing to emit). */
  emptyRecordCount: number;
  yieldedRecordCount: number;
  degenerateRingCount: number;
}
