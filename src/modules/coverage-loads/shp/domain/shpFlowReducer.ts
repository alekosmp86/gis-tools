import { isTerminalState, JOB_STATE } from "../job/types.ts";
import type { JobMode, JobStatus } from "../job/types.ts";
import type { ShpPlan } from "../types";
import { checkShpFile } from "./shpFileCheck";
import { INITIAL_SHP_FLOW, ShpPhase, type ShpFlowState, type ShpJobRef } from "./shpFlowState";

export const ShpActionType = {
  PICK_FILE: "PICK_FILE",
  UPLOAD_START: "UPLOAD_START",
  UPLOAD_PROGRESS: "UPLOAD_PROGRESS",
  UPLOAD_SUCCESS: "UPLOAD_SUCCESS",
  UPLOAD_FAILURE: "UPLOAD_FAILURE",
  PLAN_START: "PLAN_START",
  PLAN_SUCCESS: "PLAN_SUCCESS",
  PLAN_FAILURE: "PLAN_FAILURE",
  SET_MODE: "SET_MODE",
  SET_CONFIRMED: "SET_CONFIRMED",
  START_BEGIN: "START_BEGIN",
  START_SUCCESS: "START_SUCCESS",
  START_FAILURE: "START_FAILURE",
  STATUS_UPDATE: "STATUS_UPDATE",
  LOG_UPDATE: "LOG_UPDATE",
  RESUMED: "RESUMED",
  RESUME_FAILED: "RESUME_FAILED",
  ACTION_FAILED: "ACTION_FAILED",
  RESTART: "RESTART",
} as const;

type ActionTypes = typeof ShpActionType;

export type ShpAction =
  | { readonly type: ActionTypes["PICK_FILE"]; readonly file: File }
  | {
      readonly type: ActionTypes["UPLOAD_START" | "PLAN_START" | "START_BEGIN" | "START_SUCCESS" | "RESTART"];
    }
  | { readonly type: ActionTypes["UPLOAD_PROGRESS"]; readonly percent: number }
  | { readonly type: ActionTypes["UPLOAD_SUCCESS"]; readonly job: ShpJobRef }
  | { readonly type: ActionTypes["UPLOAD_FAILURE"]; readonly message: string | null }
  | { readonly type: ActionTypes["PLAN_SUCCESS"]; readonly plan: ShpPlan; readonly revision: number }
  | { readonly type: ActionTypes["PLAN_FAILURE" | "RESUME_FAILED" | "ACTION_FAILED"]; readonly message: string }
  | { readonly type: ActionTypes["START_FAILURE"]; readonly message: string; readonly plan?: ShpPlan }
  | { readonly type: ActionTypes["SET_MODE"]; readonly mode: JobMode }
  | { readonly type: ActionTypes["SET_CONFIRMED"]; readonly value: boolean }
  | { readonly type: ActionTypes["STATUS_UPDATE"]; readonly status: JobStatus; readonly stale: boolean }
  | { readonly type: ActionTypes["LOG_UPDATE"]; readonly tail: string }
  | { readonly type: ActionTypes["RESUMED"]; readonly status: JobStatus | null };

const PICK_STATE: ShpFlowState = { ...INITIAL_SHP_FLOW, phase: ShpPhase.PICK };

function inPhase(state: ShpFlowState, phase: ShpPhase, next: () => ShpFlowState): ShpFlowState {
  return state.phase === phase ? next() : state;
}

function pickFile(state: ShpFlowState, file: File): ShpFlowState {
  const check = checkShpFile(file);
  return check.ok
    ? { ...state, file, fileError: null, error: null }
    : { ...state, file: null, fileError: check.message, error: null };
}

function jobFromStatus(status: JobStatus): ShpJobRef {
  return { jobId: status.jobId, target: status.target, fileName: status.source.fileName, sizeBytes: status.source.sizeBytes };
}

function resumed(status: JobStatus | null): ShpFlowState {
  if (status === null || status.state === JOB_STATE.UPLOADING) return PICK_STATE;
  const base = { ...PICK_STATE, job: jobFromStatus(status), mode: status.mode };
  if (status.state === JOB_STATE.READY) return { ...base, phase: ShpPhase.REVIEW };
  return { ...base, phase: isTerminalState(status.state) ? ShpPhase.DONE : ShpPhase.RUNNING, status };
}

function statusUpdate(state: ShpFlowState, status: JobStatus, stale: boolean): ShpFlowState {
  if (state.phase !== ShpPhase.RUNNING) return state;
  const phase = isTerminalState(status.state) ? ShpPhase.DONE : ShpPhase.RUNNING;
  return { ...state, phase, status, stale, error: null };
}

function planSuccess(state: ShpFlowState, plan: ShpPlan, revision: number): ShpFlowState {
  return { ...state, phase: ShpPhase.REVIEW, plan, planRevision: revision, mode: plan.defaultMode, confirmed: false, error: null };
}

function startFailure(state: ShpFlowState, message: string, plan?: ShpPlan): ShpFlowState {
  return { ...state, phase: ShpPhase.REVIEW, plan: plan ?? state.plan, confirmed: false, error: message };
}

function uploadProgress(state: ShpFlowState, percent: number): ShpFlowState {
  return state.phase === ShpPhase.UPLOADING && state.uploadPercent !== percent ? { ...state, uploadPercent: percent } : state;
}

export function shpFlowReducer(state: ShpFlowState, action: ShpAction): ShpFlowState {
  switch (action.type) {
    case ShpActionType.PICK_FILE:
      return inPhase(state, ShpPhase.PICK, () => pickFile(state, action.file));
    case ShpActionType.UPLOAD_START:
      return inPhase(state, ShpPhase.PICK, () => ({ ...state, phase: ShpPhase.UPLOADING, uploadPercent: 0, error: null }));
    case ShpActionType.UPLOAD_PROGRESS:
      return uploadProgress(state, action.percent);
    case ShpActionType.UPLOAD_SUCCESS:
      return inPhase(state, ShpPhase.UPLOADING, () => ({ ...state, phase: ShpPhase.REVIEW, job: action.job, plan: null }));
    case ShpActionType.UPLOAD_FAILURE:
      return inPhase(state, ShpPhase.UPLOADING, () => ({ ...state, phase: ShpPhase.PICK, error: action.message }));
    case ShpActionType.PLAN_START:
      return inPhase(state, ShpPhase.REVIEW, () => ({ ...state, phase: ShpPhase.PLANNING, error: null }));
    case ShpActionType.PLAN_SUCCESS:
      return inPhase(state, ShpPhase.PLANNING, () => planSuccess(state, action.plan, action.revision));
    case ShpActionType.PLAN_FAILURE:
      return inPhase(state, ShpPhase.PLANNING, () => ({ ...state, phase: ShpPhase.REVIEW, plan: null, error: action.message }));
    case ShpActionType.SET_MODE:
      return inPhase(state, ShpPhase.REVIEW, () => ({ ...state, mode: action.mode, confirmed: false }));
    case ShpActionType.SET_CONFIRMED:
      return inPhase(state, ShpPhase.REVIEW, () => ({ ...state, confirmed: action.value }));
    case ShpActionType.START_BEGIN:
      return inPhase(state, ShpPhase.REVIEW, () => ({ ...state, phase: ShpPhase.STARTING, error: null }));
    case ShpActionType.START_SUCCESS:
      return inPhase(state, ShpPhase.STARTING, () => ({ ...state, phase: ShpPhase.RUNNING, status: null, logTail: "" }));
    case ShpActionType.START_FAILURE:
      return inPhase(state, ShpPhase.STARTING, () => startFailure(state, action.message, action.plan));
    case ShpActionType.STATUS_UPDATE:
      return statusUpdate(state, action.status, action.stale);
    case ShpActionType.LOG_UPDATE:
      return state.phase === ShpPhase.RUNNING ? { ...state, logTail: action.tail } : state;
    case ShpActionType.RESUMED:
      return inPhase(state, ShpPhase.RESUMING, () => resumed(action.status));
    case ShpActionType.RESUME_FAILED:
      return inPhase(state, ShpPhase.RESUMING, () => ({ ...PICK_STATE, error: action.message }));
    case ShpActionType.ACTION_FAILED:
      return { ...state, error: action.message };
    case ShpActionType.RESTART:
      return PICK_STATE;
  }
}
