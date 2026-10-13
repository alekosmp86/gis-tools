import type { IndicatorsPlan, LoadResult } from "../client";

/**
 * State of the Indicadores LTE stage: files, review of the plan, load, result. The connection is
 * not part of it: the workflow shell owns it and announces a change with `CONNECTION_CHANGED`.
 * Pure and free of React, so the two-step rule (a load is only reachable from a reviewed plan, and
 * any change of connection or files throws that plan away) is testable without a browser.
 */

export const FlowPhase = {
  FILES: "FILES",
  PLANNING: "PLANNING",
  REVIEW: "REVIEW",
  LOADING: "LOADING",
  DONE: "DONE",
} as const;

export type FlowPhase = (typeof FlowPhase)[keyof typeof FlowPhase];

export interface LoadFlowState {
  readonly phase: FlowPhase;
  readonly files: ReadonlyArray<File>;
  readonly plan: IndicatorsPlan | null;
  readonly acceptShrink: boolean;
  readonly result: LoadResult | null;
  readonly error: string | null;
}

export const INITIAL_LOAD_FLOW: LoadFlowState = {
  phase: FlowPhase.FILES,
  files: [],
  plan: null,
  acceptShrink: false,
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
  SET_ACCEPT_SHRINK: "SET_ACCEPT_SHRINK",
  LOAD_START: "LOAD_START",
  LOAD_SUCCESS: "LOAD_SUCCESS",
  LOAD_FAILURE: "LOAD_FAILURE",
  RESTART: "RESTART",
} as const;

export type LoadFlowAction =
  | { readonly type: typeof LoadFlowActionType.ADD_FILES; readonly files: ReadonlyArray<File> }
  | { readonly type: typeof LoadFlowActionType.REMOVE_FILE; readonly index: number }
  | { readonly type: typeof LoadFlowActionType.PLAN_SUCCESS; readonly plan: IndicatorsPlan }
  | { readonly type: typeof LoadFlowActionType.PLAN_FAILURE; readonly message: string }
  | { readonly type: typeof LoadFlowActionType.SET_ACCEPT_SHRINK; readonly value: boolean }
  | { readonly type: typeof LoadFlowActionType.LOAD_SUCCESS; readonly result: LoadResult }
  | {
      readonly type: typeof LoadFlowActionType.LOAD_FAILURE;
      readonly message: string;
      readonly plan?: IndicatorsPlan;
    }
  | { readonly type: typeof LoadFlowActionType.CONNECTION_CHANGED }
  | { readonly type: typeof LoadFlowActionType.BACK }
  | { readonly type: typeof LoadFlowActionType.PLAN_START }
  | { readonly type: typeof LoadFlowActionType.LOAD_START }
  | { readonly type: typeof LoadFlowActionType.RESTART };

const CSV_EXTENSION = ".csv";

export function isBusy(state: Pick<LoadFlowState, "phase">): boolean {
  return state.phase === FlowPhase.PLANNING || state.phase === FlowPhase.LOADING;
}

export function canReview(state: LoadFlowState): boolean {
  return state.phase === FlowPhase.FILES && state.files.length > 0;
}

/** The only gate to the write: a reviewed plan that nothing blocks, with the shrink box ticked when needed. */
export function canLoad(state: LoadFlowState): boolean {
  if (state.phase !== FlowPhase.REVIEW || state.plan === null) return false;
  if (!state.plan.canLoad) return false;
  return !state.plan.requiresAcceptShrink || state.acceptShrink;
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
  return { ...state, plan: null, acceptShrink: false, error: null };
}

/** A connection change invalidates any review: the plan was computed against the previous database. */
function connectionChanged(state: LoadFlowState): LoadFlowState {
  if (state.phase === FlowPhase.FILES || state.phase === FlowPhase.REVIEW) {
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

function failLoad(state: LoadFlowState, message: string, plan: IndicatorsPlan | undefined): LoadFlowState {
  if (state.phase !== FlowPhase.LOADING) return state;
  return {
    ...state,
    phase: FlowPhase.REVIEW,
    error: message,
    plan: plan ?? state.plan,
    acceptShrink: plan ? false : state.acceptShrink,
  };
}

function restart(state: LoadFlowState): LoadFlowState {
  if (state.phase !== FlowPhase.DONE) return state;
  return { ...discardPlan(state), phase: FlowPhase.FILES, files: [], result: null };
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
      return state.phase === FlowPhase.PLANNING
        ? { ...state, phase: FlowPhase.REVIEW, plan: action.plan, acceptShrink: false }
        : state;
    case LoadFlowActionType.PLAN_FAILURE:
      return state.phase === FlowPhase.PLANNING
        ? { ...state, phase: FlowPhase.FILES, error: action.message }
        : state;
    case LoadFlowActionType.SET_ACCEPT_SHRINK:
      return state.phase === FlowPhase.REVIEW ? { ...state, acceptShrink: action.value } : state;
    case LoadFlowActionType.LOAD_START:
      return canLoad(state) ? { ...state, phase: FlowPhase.LOADING, error: null } : state;
    case LoadFlowActionType.LOAD_SUCCESS:
      return state.phase === FlowPhase.LOADING
        ? { ...state, phase: FlowPhase.DONE, result: action.result }
        : state;
    case LoadFlowActionType.LOAD_FAILURE:
      return failLoad(state, action.message, action.plan);
    case LoadFlowActionType.RESTART:
      return restart(state);
  }
}
