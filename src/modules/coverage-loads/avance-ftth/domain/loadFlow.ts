import type { AvanceLoadResult, AvancePlan } from "../client";
import { isCompletePair } from "./fileSlots";

/**
 * State of the Avance FTTH stage: files, review of the plan, run (dry or real), result. The
 * connection is not part of it: the workflow shell owns it and announces a change with
 * `CONNECTION_CHANGED`. Pure and free of React, so the rule (a run is only reachable from a
 * reviewed plan without blockers, and any change of connection or files throws that plan away) is
 * testable without a browser.
 */

export const FlowPhase = {
  FILES: "FILES",
  PLANNING: "PLANNING",
  REVIEW: "REVIEW",
  RUNNING: "RUNNING",
  DONE: "DONE",
} as const;

export type FlowPhase = (typeof FlowPhase)[keyof typeof FlowPhase];

export const RunMode = {
  DRY_RUN: "DRY_RUN",
  LOAD: "LOAD",
} as const;

export type RunMode = (typeof RunMode)[keyof typeof RunMode];

export interface LoadFlowState {
  readonly phase: FlowPhase;
  readonly files: ReadonlyArray<File>;
  readonly plan: AvancePlan | null;
  readonly mode: RunMode | null;
  readonly result: AvanceLoadResult | null;
  readonly error: string | null;
}

export const INITIAL_LOAD_FLOW: LoadFlowState = {
  phase: FlowPhase.FILES,
  files: [],
  plan: null,
  mode: null,
  result: null,
  error: null,
};

export const LoadFlowActionType = {
  ADD_FILES: "ADD_FILES",
  REMOVE_FILE: "REMOVE_FILE",
  CONNECTION_CHANGED: "CONNECTION_CHANGED",
  BACK: "BACK",
  PLAN_START: "PLAN_START",
  PLAN_SUCCESS: "PLAN_SUCCESS",
  PLAN_FAILURE: "PLAN_FAILURE",
  RUN_START: "RUN_START",
  RUN_SUCCESS: "RUN_SUCCESS",
  RUN_FAILURE: "RUN_FAILURE",
  BACK_TO_REVIEW: "BACK_TO_REVIEW",
  RESTART: "RESTART",
} as const;

export type LoadFlowAction =
  | { readonly type: typeof LoadFlowActionType.ADD_FILES; readonly files: ReadonlyArray<File> }
  | { readonly type: typeof LoadFlowActionType.REMOVE_FILE; readonly index: number }
  | { readonly type: typeof LoadFlowActionType.PLAN_SUCCESS; readonly plan: AvancePlan }
  | { readonly type: typeof LoadFlowActionType.PLAN_FAILURE; readonly message: string }
  | { readonly type: typeof LoadFlowActionType.RUN_START; readonly mode: RunMode }
  | { readonly type: typeof LoadFlowActionType.RUN_SUCCESS; readonly result: AvanceLoadResult }
  | {
      readonly type: typeof LoadFlowActionType.RUN_FAILURE;
      readonly message: string;
      readonly plan?: AvancePlan;
    }
  | { readonly type: typeof LoadFlowActionType.CONNECTION_CHANGED }
  | { readonly type: typeof LoadFlowActionType.BACK }
  | { readonly type: typeof LoadFlowActionType.PLAN_START }
  | { readonly type: typeof LoadFlowActionType.BACK_TO_REVIEW }
  | { readonly type: typeof LoadFlowActionType.RESTART };

const CSV_EXTENSION = ".csv";

export function isBusy(state: Pick<LoadFlowState, "phase">): boolean {
  return state.phase === FlowPhase.PLANNING || state.phase === FlowPhase.RUNNING;
}

export function canReview(state: LoadFlowState): boolean {
  return state.phase === FlowPhase.FILES && isCompletePair(state.files);
}

/** The only gate to a run (dry or real): a reviewed plan that nothing blocks. */
export function canRun(state: LoadFlowState): boolean {
  return state.phase === FlowPhase.REVIEW && state.plan !== null && state.plan.canLoad;
}

function isCsvFile(file: File): boolean {
  return file.name.toLowerCase().endsWith(CSV_EXTENSION);
}

function isSameFile(left: File, right: File): boolean {
  return left.name === right.name && left.size === right.size && left.lastModified === right.lastModified;
}

function mergeFiles(current: ReadonlyArray<File>, incoming: ReadonlyArray<File>): ReadonlyArray<File> {
  const merged = [...current];
  for (const file of incoming) {
    if (isCsvFile(file) && !merged.some((existing) => isSameFile(existing, file))) merged.push(file);
  }
  return merged;
}

function discardPlan(state: LoadFlowState): LoadFlowState {
  return { ...state, plan: null, result: null, mode: null, error: null };
}

function isDryRunResult(state: LoadFlowState): boolean {
  return state.phase === FlowPhase.DONE && state.result?.dryRun === true;
}

/** A connection change invalidates any review or dry-run result: they were computed against the previous database. */
function connectionChanged(state: LoadFlowState): LoadFlowState {
  if (state.phase === FlowPhase.FILES || state.phase === FlowPhase.REVIEW || isDryRunResult(state)) {
    return { ...discardPlan(state), phase: FlowPhase.FILES };
  }
  return state;
}

/** A files edit invalidates any review: the plan was computed from the previous files. */
function withFiles(state: LoadFlowState, files: ReadonlyArray<File>): LoadFlowState {
  if (state.phase === FlowPhase.FILES) return { ...state, files };
  if (state.phase === FlowPhase.REVIEW) return { ...discardPlan(state), phase: FlowPhase.FILES, files };
  return state;
}

function goBack(state: LoadFlowState): LoadFlowState {
  if (state.phase === FlowPhase.REVIEW) return { ...discardPlan(state), phase: FlowPhase.FILES };
  return state;
}

function backToReview(state: LoadFlowState): LoadFlowState {
  if (!isDryRunResult(state)) return state;
  return { ...state, phase: FlowPhase.REVIEW, result: null, mode: null, error: null };
}

function failRun(state: LoadFlowState, message: string, plan: AvancePlan | undefined): LoadFlowState {
  if (state.phase !== FlowPhase.RUNNING) return state;
  return { ...state, phase: FlowPhase.REVIEW, mode: null, error: message, plan: plan ?? state.plan };
}

function restart(state: LoadFlowState): LoadFlowState {
  if (state.phase !== FlowPhase.DONE) return state;
  return { ...discardPlan(state), phase: FlowPhase.FILES, files: [] };
}

export function loadFlowReducer(state: LoadFlowState, action: LoadFlowAction): LoadFlowState {
  switch (action.type) {
    case LoadFlowActionType.ADD_FILES:
      return withFiles(state, mergeFiles(state.files, action.files));
    case LoadFlowActionType.REMOVE_FILE:
      return withFiles(
        state,
        state.files.filter((_, position) => position !== action.index)
      );
    case LoadFlowActionType.CONNECTION_CHANGED:
      return connectionChanged(state);
    case LoadFlowActionType.BACK:
      return goBack(state);
    case LoadFlowActionType.PLAN_START:
      return canReview(state) ? { ...state, phase: FlowPhase.PLANNING, error: null } : state;
    case LoadFlowActionType.PLAN_SUCCESS:
      return state.phase === FlowPhase.PLANNING ? { ...state, phase: FlowPhase.REVIEW, plan: action.plan } : state;
    case LoadFlowActionType.PLAN_FAILURE:
      return state.phase === FlowPhase.PLANNING ? { ...state, phase: FlowPhase.FILES, error: action.message } : state;
    case LoadFlowActionType.RUN_START:
      return canRun(state) ? { ...state, phase: FlowPhase.RUNNING, mode: action.mode, error: null } : state;
    case LoadFlowActionType.RUN_SUCCESS:
      return state.phase === FlowPhase.RUNNING ? { ...state, phase: FlowPhase.DONE, result: action.result } : state;
    case LoadFlowActionType.RUN_FAILURE:
      return failRun(state, action.message, action.plan);
    case LoadFlowActionType.BACK_TO_REVIEW:
      return backToReview(state);
    case LoadFlowActionType.RESTART:
      return restart(state);
  }
}
