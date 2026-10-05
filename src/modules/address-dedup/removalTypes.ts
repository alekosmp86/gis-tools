import type { DedupRequest } from "./types";
import type { RemovalBlockReason, RemovalState, RemovalTable } from "./removalConstants";

export interface RemovalBlockerReason {
  readonly code: RemovalBlockReason;
  /** Extra context for the reason, e.g. the table that still references the master. */
  readonly detail: string | null;
}

/** A target the removal cannot touch. While any exists the removal refuses to run. */
export interface RemovalBlocker {
  readonly urn: string;
  readonly reasons: ReadonlyArray<RemovalBlockerReason>;
}

export interface RemovalCounts {
  readonly total: number;
  readonly byFuente: Readonly<Record<string, number>>;
  readonly rowsByTable: Readonly<Record<RemovalTable, number>>;
}

/** One urn the removal would delete and the fuente it came from. */
export interface RemovalPlanTarget {
  readonly urn: string;
  readonly fuente: string;
}

export interface RemovalPlan {
  readonly fingerprint: string;
  readonly counts: RemovalCounts;
  readonly blockers: ReadonlyArray<RemovalBlocker>;
  /** Sorted by urn; produced by the statement that produces the fingerprint, and sent to the browser for review only. */
  readonly targets: ReadonlyArray<RemovalPlanTarget>;
  /** Every row the removal would touch, as fingerprinted. Stored in the audit row, never sent to the browser. */
  readonly snapshot: Readonly<Record<string, unknown>>;
}

export interface RemovalConfirmation {
  readonly operationId: string;
  readonly responsable: string;
  readonly motivo: string;
  readonly expectedFingerprint: string;
}

export interface RemovalResult {
  readonly operationId: string;
  readonly fingerprint: string;
  readonly state: RemovalState;
  readonly counts: RemovalCounts;
  readonly deletedByTable: Readonly<Record<RemovalTable, number>>;
  readonly pending: string;
  /** True when the operation id was already executed and this is the stored result, not a new run. */
  readonly recovered: boolean;
}

/** What the audit row's `resultado` holds: the result plus the scope and the urns removed. The snapshot itself is not stored. */
export interface RemovalAuditRecord extends RemovalResult {
  readonly provinceId: number;
  readonly protectedSiblingRemovesLone: boolean;
  readonly targets: ReadonlyArray<RemovalPlanTarget>;
}

/** What the removal needs to recompute the plan. Deliberately carries no address list: the server derives the targets. */
export type RemovalSimulationRequest = Pick<
  DedupRequest,
  "connection" | "provinceId" | "protectedSiblingRemovesLone"
>;

export interface RemovalExecutionRequest extends RemovalSimulationRequest, RemovalConfirmation {}

/** Ids of the rows a plan resolved to, as text so a bigint beyond 2^53 is exact; only the repository sees them, and only to delete exactly those. */
export interface RemovalTargets {
  readonly addressIds: ReadonlyArray<string>;
  readonly masterIds: ReadonlyArray<string>;
  readonly urns: ReadonlyArray<string>;
}

export interface ResolvedRemoval {
  readonly plan: RemovalPlan;
  readonly targets: RemovalTargets;
}

export interface RemovalSimulationPayload {
  readonly fingerprint: string;
  readonly counts: RemovalCounts;
  readonly blockers: ReadonlyArray<RemovalBlocker>;
  readonly targets: ReadonlyArray<RemovalPlanTarget>;
}

export interface RemovalSimulationRequestPayload {
  readonly connection: {
    readonly host: string;
    readonly port: string;
    readonly db_name: string;
    readonly user: string;
    readonly password: string;
  };
  readonly provinceId: number;
  readonly protectedSiblingRemovesLone: boolean;
}

export interface RemovalExecutionRequestPayload extends RemovalSimulationRequestPayload {
  readonly operationId: string;
  readonly responsable: string;
  readonly motivo: string;
  readonly expectedFingerprint: string;
}
