"use client";

import { useReducer } from "react";
import {
  canContinue,
  canLoad,
  canReview,
  currentStep,
  INITIAL_LOAD_FLOW,
  isBusy,
  loadFlowReducer,
  LoadFlowActionType,
  type ConnectionField,
  type ProfileValues,
} from "../domain/loadFlow";
import { IndicatorsRequestError, requestLoad, requestPlan } from "./indicatorsClient";

const UNKNOWN_FAILURE = "No se pudo completar la operación.";

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : UNKNOWN_FAILURE;
}

/**
 * Drives the four-step workflow. Loading is only possible from a reviewed plan: the reducer
 * refuses `LOAD_START` otherwise, and this hook re-checks before it talks to the server.
 */
export function useIndicatorsFlow() {
  const [state, dispatch] = useReducer(loadFlowReducer, INITIAL_LOAD_FLOW);

  const review = async () => {
    if (!canReview(state)) return;
    dispatch({ type: LoadFlowActionType.PLAN_START });
    try {
      const plan = await requestPlan(state.connection, state.files);
      dispatch({ type: LoadFlowActionType.PLAN_SUCCESS, plan });
    } catch (failure: unknown) {
      dispatch({ type: LoadFlowActionType.PLAN_FAILURE, message: toMessage(failure) });
    }
  };

  const load = async () => {
    if (!canLoad(state)) return;
    dispatch({ type: LoadFlowActionType.LOAD_START });
    try {
      const result = await requestLoad(state.connection, state.files, state.acceptShrink);
      dispatch({ type: LoadFlowActionType.LOAD_SUCCESS, result });
    } catch (failure: unknown) {
      const plan = failure instanceof IndicatorsRequestError ? failure.plan : undefined;
      dispatch({ type: LoadFlowActionType.LOAD_FAILURE, message: toMessage(failure), plan });
    }
  };

  return {
    state,
    step: currentStep(state),
    isBusy: isBusy(state),
    canContinue: canContinue(state),
    canReview: canReview(state),
    canLoad: canLoad(state),
    setConnectionField: (field: ConnectionField, value: string) =>
      dispatch({ type: LoadFlowActionType.SET_CONNECTION_FIELD, field, value }),
    applyProfile: (values: ProfileValues) => dispatch({ type: LoadFlowActionType.APPLY_PROFILE, values }),
    addFiles: (files: ReadonlyArray<File>) => dispatch({ type: LoadFlowActionType.ADD_FILES, files }),
    removeFile: (index: number) => dispatch({ type: LoadFlowActionType.REMOVE_FILE, index }),
    setAcceptShrink: (value: boolean) => dispatch({ type: LoadFlowActionType.SET_ACCEPT_SHRINK, value }),
    continueToFiles: () => dispatch({ type: LoadFlowActionType.CONTINUE }),
    back: () => dispatch({ type: LoadFlowActionType.BACK }),
    restart: () => dispatch({ type: LoadFlowActionType.RESTART }),
    review,
    load,
  };
}

export type IndicatorsFlow = ReturnType<typeof useIndicatorsFlow>;
