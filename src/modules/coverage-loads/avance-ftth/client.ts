/**
 * The client-safe surface of the Avance FTTH part: types, constants and pure functions with no
 * node, `pg` or server imports. The UI imports from here and nowhere else in `avance-ftth/`
 * (apart from its own `ui/` and the pure `domain/` view helpers).
 */
export {
  FILE_KIND_LABELS,
  FILE_KINDS,
  FILE_NAME_FORMAT_HINTS,
  REPORT_KIND_LABELS,
  REPORT_KINDS,
  AvanceFileKind,
  ReportKind,
} from "./constants";
export { buildRejectedCsv, buildRejectedFileName } from "./domain/rejectedCsv";
export type {
  AvanceErrorPayload,
  AvanceLoadResult,
  AvancePlan,
  FilePlan,
  LoadResponsePayload,
  PlanResponsePayload,
  RejectedRow,
  ReportRequestPayload,
  StatusCount,
} from "./types";
