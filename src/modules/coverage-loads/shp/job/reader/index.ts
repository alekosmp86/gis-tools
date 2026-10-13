export {
  CorruptShapefileError,
  HoleAssignmentError,
  NotAShapefileError,
  ShapefileNotFoundError,
  ShapefileReaderError,
  ShapefileUnreadableError,
  UnsupportedShapeError,
} from "./errors.ts";
export { iterateRecordEwkb, scanShapefile } from "./shpEwkbReader.ts";
export type {
  EwkbIterationSummary,
  EwkbRecord,
  ProgressCallback,
  ReaderOptions,
  RecordScanSummary,
  ScanOptions,
  ShapefileScan,
} from "./types.ts";
