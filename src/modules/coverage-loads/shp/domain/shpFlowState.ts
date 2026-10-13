import { JOB_MODE } from "../job/types.ts";
import type { JobMode, JobStatus, JobTarget } from "../job/types.ts";
import type { ShpPlan } from "../types";

export const ShpPhase = {
  RESUMING: "RESUMING",
  PICK: "PICK",
  UPLOADING: "UPLOADING",
  REVIEW: "REVIEW",
  PLANNING: "PLANNING",
  STARTING: "STARTING",
  RUNNING: "RUNNING",
  DONE: "DONE",
} as const;

export type ShpPhase = (typeof ShpPhase)[keyof typeof ShpPhase];

export interface ShpJobRef {
  readonly jobId: string;
  readonly target: JobTarget;
  readonly fileName: string;
  readonly sizeBytes: number;
}

/** No connection value lives here: the shell owns it and hands it to the hook on every call. */
export interface ShpFlowState {
  readonly phase: ShpPhase;
  readonly file: File | null;
  readonly fileError: string | null;
  readonly uploadPercent: number;
  readonly job: ShpJobRef | null;
  readonly plan: ShpPlan | null;
  /** The connection revision the plan was computed against: a different one makes the plan stale. */
  readonly planRevision: number | null;
  readonly mode: JobMode;
  readonly confirmed: boolean;
  readonly status: JobStatus | null;
  readonly stale: boolean;
  readonly logTail: string;
  readonly error: string | null;
}

export const INITIAL_SHP_FLOW: ShpFlowState = {
  phase: ShpPhase.RESUMING,
  file: null,
  fileError: null,
  uploadPercent: 0,
  job: null,
  plan: null,
  planRevision: null,
  mode: JOB_MODE.LOAD,
  confirmed: false,
  status: null,
  stale: false,
  logTail: "",
  error: null,
};

const BUSY_PHASES: readonly ShpPhase[] = [ShpPhase.UPLOADING, ShpPhase.PLANNING, ShpPhase.STARTING, ShpPhase.RUNNING];

export function isBusy(state: Pick<ShpFlowState, "phase">): boolean {
  return BUSY_PHASES.includes(state.phase);
}

export function canUpload(state: ShpFlowState): boolean {
  return state.phase === ShpPhase.PICK && state.file !== null && state.fileError === null;
}

export function canPlan(state: ShpFlowState): boolean {
  return state.phase === ShpPhase.REVIEW && state.job !== null;
}

/** LOAD replaces the table, so it needs the explicit confirmation; TEST never writes to it. */
export function canStart(state: ShpFlowState): boolean {
  if (state.phase !== ShpPhase.REVIEW || state.plan === null || !state.plan.canStart) return false;
  return state.mode === JOB_MODE.TEST || state.confirmed;
}
