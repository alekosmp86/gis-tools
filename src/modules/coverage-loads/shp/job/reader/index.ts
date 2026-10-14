export {
  CorruptShapefileError,
  HoleAssignmentError,
  NotAShapefileError,
  ShapefileNotFoundError,
  ShapefileReaderError,
  UnsupportedShapeError,
} from "./errors.ts";
export { iterateRecordEwkb, scanShapefile } from "./shpEwkbReader.ts";
export type {
  EwkbIterationSummary,
  EwkbRecord,
} from "./types.ts";
