import type { EJES_SPLIT_POINTS_ROLES, EjesTableRole } from "../../../jobs/ejes-ide/constants";
import type { EjesMapItem, EjesResult, EjesSummary, EjesTableRef } from "../../../jobs/ejes-ide/types";
import type { ClientConnection, JobStatusBase } from "../../shared/clientTypes";

/** One copy the user keeps for a `reftramo` that keeps several copies. */
export interface EjesTwinPickRequest {
  ref: string;
  department: string;
  locality: string;
}

/** A manual split: the new sections (one or more) the user chose to replace one old section that no rule resolved. */
export interface EjesManualSplitRequest {
  oldRef: string;
  newRefs: string[];
}

/** The choices the Analizar re-run sends: the analysis then sees the picks and manual splits the load will. */
export interface EjesAnalysisAcceptedRequest {
  twinPicks: EjesTwinPickRequest[];
  manualSplits: EjesManualSplitRequest[];
}

export interface EjesStartRequest {
  connection: ClientConnection;
  tables: Record<EjesTableRole, EjesTableRef>;
  dryRun: boolean;
  accepted?: EjesAnalysisAcceptedRequest;
  department?: string | null;
}

/** One review point's destination the user chose: the point and one piece of its split. */
export interface EjesPointChoiceRequest {
  pointId: string;
  newRef: string;
}

/** The accepted review rows: splits by their old `reftramo` with the user's choices for their review points only, plain removals by `reftramo`, merges by their new `reftramo` (the server derives the old ones). */
export interface EjesAcceptedRequest extends EjesAnalysisAcceptedRequest {
  splits: { oldRef: string; choices: EjesPointChoiceRequest[] }[];
  plainRemovals: { ref: string }[];
  merges: { newRef: string }[];
  twinRemovals: { ref: string }[];
  renamedStreets?: Array<{ idcalle: string; name?: string }>;
  autoPlainRemovals: boolean;
}

/** The real run: the counts and fingerprint of the finished dry-run, and the rows the user accepted on it. */
export interface EjesLoadRequest extends EjesStartRequest {
  dryRun: false;
  accepted: EjesAcceptedRequest;
  summary: EjesSummary;
}

export type EjesJobStatusView = JobStatusBase<EjesResult>;

/** The connection and the tables the ejes map reads: the wizard's, with no option and no plan. */
export interface EjesGeometryMapBase {
  connection: ClientConnection;
  tables: Pick<Record<EjesTableRole, EjesTableRef>, "ejes-ide-origen" | "ejes-tramos" | "ejes-padrones" | "ejes-localidades" | "ejes-departamentos"> &
    Partial<Pick<Record<EjesTableRole, EjesTableRef>, "ejes-accesos" | "ejes-address">>;
}

export interface EjesGeometryMapRequest extends EjesGeometryMapBase {
  items: EjesMapItem[];
}

/** The connection, the five tables the review reads by key or small lookup, and the dry run whose stored points the review shows. */
export interface EjesSplitPointsBase {
  connection: ClientConnection;
  tables: Pick<Record<EjesTableRole, EjesTableRef>, (typeof EJES_SPLIT_POINTS_ROLES)[number]>;
  jobId: string;
}

export interface EjesSplitPointsRequest extends EjesSplitPointsBase {
  oldRef: string;
  offset: number;
  limit: number;
}
