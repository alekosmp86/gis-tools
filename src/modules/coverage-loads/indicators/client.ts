/**
 * The client-safe surface of the indicators part: types, constants and pure functions with no
 * node, `pg` or server imports. The UI imports from here and nowhere else in `indicators/`.
 */
export { REPORT_KIND_LABELS, ReportKind, FILE_NAME_FORMAT_HINT, FUENTE } from "./constants";
export { buildRejectedCsv, buildRejectedFileName } from "./domain/rejectedCsv";
export type {
  CutPlan,
  FileError,
  IndicatorsErrorPayload,
  IndicatorsPlan,
  LoadedCut,
  LoadResponsePayload,
  LoadResult,
  PlanResponsePayload,
  PrivilegeShortfallPayload,
  RejectedRow,
  ReportRequestPayload,
} from "./types";
