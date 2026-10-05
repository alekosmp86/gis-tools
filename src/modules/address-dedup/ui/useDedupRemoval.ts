"use client";

import { useReducer } from "react";
import {
  canExecute,
  canSimulate,
  INITIAL_REMOVAL_FLOW,
  isBusy,
  RemovalFlowActionType,
  removalFlowReducer,
} from "../domain/removalFlow";
import type { RemovalSimulationRequestPayload } from "../removalTypes";
import type { DedupRequestPayload } from "../types";
import { executeRemoval, simulateRemoval } from "./dedupClient";
import { generateOperationId } from "./operationId";

const UNKNOWN_FAILURE = "No se pudo completar la operación.";

function toRemovalPayload(payload: DedupRequestPayload): RemovalSimulationRequestPayload {
  return {
    connection: payload.connection,
    provinceId: payload.provinceId,
    protectedSiblingRemovesLone: payload.protectedSiblingRemovesLone,
  };
}

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : UNKNOWN_FAILURE;
}

/**
 * Drives the two-step removal dialog. Executing is only possible from a reviewed plan, and it
 * sends back that plan's fingerprint, so the server can refuse if the data moved in between.
 */
export function useDedupRemoval(payload: DedupRequestPayload) {
  const [state, dispatch] = useReducer(removalFlowReducer, INITIAL_REMOVAL_FLOW);

  const simulate = async () => {
    if (!canSimulate(state)) return;
    dispatch({ type: RemovalFlowActionType.SIMULATE_START });
    try {
      const plan = await simulateRemoval(toRemovalPayload(payload));
      dispatch({ type: RemovalFlowActionType.SIMULATE_SUCCESS, plan });
    } catch (failure: unknown) {
      dispatch({ type: RemovalFlowActionType.SIMULATE_FAILURE, message: toMessage(failure) });
    }
  };

  const execute = async () => {
    if (!canExecute(state) || state.plan === null) return;
    const request = {
      ...toRemovalPayload(payload),
      operationId: state.operationId,
      responsable: state.responsable.trim(),
      motivo: state.motivo.trim(),
      expectedFingerprint: state.plan.fingerprint,
    };
    dispatch({ type: RemovalFlowActionType.EXECUTE_START });
    try {
      const result = await executeRemoval(request);
      dispatch({ type: RemovalFlowActionType.EXECUTE_SUCCESS, result });
    } catch (failure: unknown) {
      dispatch({ type: RemovalFlowActionType.EXECUTE_FAILURE, message: toMessage(failure) });
    }
  };

  return {
    state,
    provinceId: payload.provinceId,
    isBusy: isBusy(state),
    canSimulate: canSimulate(state),
    canExecute: canExecute(state),
    open: () => dispatch({ type: RemovalFlowActionType.OPEN, operationId: generateOperationId() }),
    close: () => dispatch({ type: RemovalFlowActionType.CLOSE }),
    restart: () => dispatch({ type: RemovalFlowActionType.RESTART, operationId: generateOperationId() }),
    setResponsable: (value: string) => dispatch({ type: RemovalFlowActionType.SET_RESPONSABLE, value }),
    setMotivo: (value: string) => dispatch({ type: RemovalFlowActionType.SET_MOTIVO, value }),
    simulate,
    execute,
  };
}

export type DedupRemovalFlow = ReturnType<typeof useDedupRemoval>;
