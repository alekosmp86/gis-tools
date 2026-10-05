import { RemovalPhase } from "../removalConstants";
import type { RemovalResult, RemovalSimulationPayload } from "../removalTypes";

/** State of the confirm-and-delete dialog. Pure, so the two-step rule is testable without a browser. */
export interface RemovalFlowState {
  readonly phase: RemovalPhase;
  readonly responsable: string;
  readonly motivo: string;
  readonly operationId: string;
  readonly plan: RemovalSimulationPayload | null;
  readonly result: RemovalResult | null;
  readonly error: string | null;
}

export const RemovalFlowActionType = {
  OPEN: "OPEN",
  CLOSE: "CLOSE",
  SET_RESPONSABLE: "SET_RESPONSABLE",
  SET_MOTIVO: "SET_MOTIVO",
  SIMULATE_START: "SIMULATE_START",
  SIMULATE_SUCCESS: "SIMULATE_SUCCESS",
  SIMULATE_FAILURE: "SIMULATE_FAILURE",
  EXECUTE_START: "EXECUTE_START",
  EXECUTE_SUCCESS: "EXECUTE_SUCCESS",
  EXECUTE_FAILURE: "EXECUTE_FAILURE",
  RESTART: "RESTART",
} as const;

export type RemovalFlowAction =
  | { readonly type: typeof RemovalFlowActionType.OPEN; readonly operationId: string }
  | { readonly type: typeof RemovalFlowActionType.RESTART; readonly operationId: string }
  | { readonly type: typeof RemovalFlowActionType.SET_RESPONSABLE; readonly value: string }
  | { readonly type: typeof RemovalFlowActionType.SET_MOTIVO; readonly value: string }
  | { readonly type: typeof RemovalFlowActionType.SIMULATE_SUCCESS; readonly plan: RemovalSimulationPayload }
  | { readonly type: typeof RemovalFlowActionType.EXECUTE_SUCCESS; readonly result: RemovalResult }
  | { readonly type: typeof RemovalFlowActionType.SIMULATE_FAILURE; readonly message: string }
  | { readonly type: typeof RemovalFlowActionType.EXECUTE_FAILURE; readonly message: string }
  | { readonly type: typeof RemovalFlowActionType.CLOSE }
  | { readonly type: typeof RemovalFlowActionType.SIMULATE_START }
  | { readonly type: typeof RemovalFlowActionType.EXECUTE_START };

export const INITIAL_REMOVAL_FLOW: RemovalFlowState = {
  phase: RemovalPhase.CLOSED,
  responsable: "",
  motivo: "",
  operationId: "",
  plan: null,
  result: null,
  error: null,
};

export function canSimulate(state: RemovalFlowState): boolean {
  return (
    state.phase === RemovalPhase.FORM &&
    state.responsable.trim().length > 0 &&
    state.motivo.trim().length > 0
  );
}

/** Only a reviewed plan with targets and no blockers can be executed. */
export function canExecute(state: RemovalFlowState): boolean {
  return (
    state.phase === RemovalPhase.REVIEW &&
    state.plan !== null &&
    state.plan.blockers.length === 0 &&
    state.plan.counts.total > 0
  );
}

export function isBusy(state: RemovalFlowState): boolean {
  return state.phase === RemovalPhase.SIMULATING || state.phase === RemovalPhase.EXECUTING;
}

export function removalFlowReducer(state: RemovalFlowState, action: RemovalFlowAction): RemovalFlowState {
  switch (action.type) {
    case RemovalFlowActionType.OPEN:
      return { ...INITIAL_REMOVAL_FLOW, phase: RemovalPhase.FORM, operationId: action.operationId };
    case RemovalFlowActionType.CLOSE:
      return isBusy(state) ? state : INITIAL_REMOVAL_FLOW;
    case RemovalFlowActionType.SET_RESPONSABLE:
      return state.phase === RemovalPhase.FORM ? { ...state, responsable: action.value } : state;
    case RemovalFlowActionType.SET_MOTIVO:
      return state.phase === RemovalPhase.FORM ? { ...state, motivo: action.value } : state;
    case RemovalFlowActionType.SIMULATE_START:
      return canSimulate(state) ? { ...state, phase: RemovalPhase.SIMULATING, error: null } : state;
    case RemovalFlowActionType.SIMULATE_SUCCESS:
      return state.phase === RemovalPhase.SIMULATING
        ? { ...state, phase: RemovalPhase.REVIEW, plan: action.plan }
        : state;
    case RemovalFlowActionType.SIMULATE_FAILURE:
      return state.phase === RemovalPhase.SIMULATING
        ? { ...state, phase: RemovalPhase.FORM, error: action.message }
        : state;
    case RemovalFlowActionType.EXECUTE_START:
      return canExecute(state) ? { ...state, phase: RemovalPhase.EXECUTING, error: null } : state;
    case RemovalFlowActionType.EXECUTE_SUCCESS:
      return state.phase === RemovalPhase.EXECUTING
        ? { ...state, phase: RemovalPhase.DONE, result: action.result }
        : state;
    case RemovalFlowActionType.EXECUTE_FAILURE:
      return state.phase === RemovalPhase.EXECUTING
        ? { ...state, phase: RemovalPhase.REVIEW, error: action.message }
        : state;
    case RemovalFlowActionType.RESTART:
      return state.phase === RemovalPhase.REVIEW
        ? { ...state, phase: RemovalPhase.FORM, plan: null, error: null, operationId: action.operationId }
        : state;
  }
}
