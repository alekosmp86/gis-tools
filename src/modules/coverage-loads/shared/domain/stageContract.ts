import type { ConnectionPayload } from "../../types";

export const StageStatus = {
  PENDING: "PENDING",
  SKIPPED: "SKIPPED",
  BUSY: "BUSY",
  DONE: "DONE",
  FAILED: "FAILED",
} as const;

export type StageStatus = (typeof StageStatus)[keyof typeof StageStatus];

/** Plain data a stage publishes about what it did, shown in the combined result. */
export interface StageOutcome {
  readonly headline: string;
  readonly lines: ReadonlyArray<string>;
}

/** What the workflow shell hands to every stage panel. */
export interface StagePanelProps {
  readonly connection: ConnectionPayload;
  /** Changes whenever the confirmed connection changed: anything computed against the old one is stale. */
  readonly connectionRevision: number;
  readonly onStatusChange: (status: StageStatus, outcome?: StageOutcome) => void;
}
