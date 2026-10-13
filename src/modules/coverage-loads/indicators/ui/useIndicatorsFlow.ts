"use client";

import { useRef, useState } from "react";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import type { ConnectionPayload } from "../../types";
import {
  canLoad,
  canReview,
  INITIAL_LOAD_FLOW,
  isBusy,
  loadFlowReducer,
  LoadFlowActionType,
  type LoadFlowAction,
} from "../domain/loadFlow";
import { reportStage } from "../domain/stageReport";
import { IndicatorsRequestError, requestLoad, requestPlan } from "./indicatorsClient";

const UNKNOWN_FAILURE = "No se pudo completar la operación.";

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : UNKNOWN_FAILURE;
}

/**
 * Drives the stage: files, review, load, result. The connection comes from the workflow shell;
 * when its revision changes, any reviewed plan is discarded. Loading is only possible from a reviewed plan: the reducer
 * refuses `LOAD_START` otherwise, and this hook re-checks before it talks to the server.
 */
export function useIndicatorsFlow(
  connection: ConnectionPayload,
  connectionRevision: number,
  onStatusChange: StagePanelProps["onStatusChange"]
) {
  const [state, setState] = useState(INITIAL_LOAD_FLOW);
  const [seenRevision, setSeenRevision] = useState(connectionRevision);
  const latest = useRef({ flow: INITIAL_LOAD_FLOW, revision: connectionRevision });

  // Only called from handlers: brings the ref up to the current revision, mirroring the render-phase reset below.
  const current = () => {
    if (latest.current.revision !== connectionRevision) {
      latest.current = {
        flow: loadFlowReducer(latest.current.flow, { type: LoadFlowActionType.CONNECTION_CHANGED }),
        revision: connectionRevision,
      };
    }
    return latest.current.flow;
  };

  const dispatch = (action: LoadFlowAction): boolean => {
    const previous = current();
    const next = loadFlowReducer(previous, action);
    if (next === previous) return false;
    latest.current = { flow: next, revision: connectionRevision };
    setState(next);
    const before = reportStage(previous);
    const after = reportStage(next);
    if (before.status !== after.status || next.result !== previous.result) {
      onStatusChange(after.status, after.outcome ?? undefined);
    }
    return true;
  };

  // Discarding a stale plan only moves FILES/REVIEW to FILES: the reported status stays PENDING, so nothing to publish.
  if (seenRevision !== connectionRevision) {
    setSeenRevision(connectionRevision);
    setState((previous) => loadFlowReducer(previous, { type: LoadFlowActionType.CONNECTION_CHANGED }));
  }

  const review = async () => {
    if (!canReview(current())) return;
    if (!dispatch({ type: LoadFlowActionType.PLAN_START })) return;
    try {
      const plan = await requestPlan(connection, current().files);
      dispatch({ type: LoadFlowActionType.PLAN_SUCCESS, plan });
    } catch (failure: unknown) {
      dispatch({ type: LoadFlowActionType.PLAN_FAILURE, message: toMessage(failure) });
    }
  };

  const load = async () => {
    if (!canLoad(current())) return;
    if (!dispatch({ type: LoadFlowActionType.LOAD_START })) return;
    try {
      const { files, acceptShrink } = current();
      const result = await requestLoad(connection, files, acceptShrink);
      dispatch({ type: LoadFlowActionType.LOAD_SUCCESS, result });
    } catch (failure: unknown) {
      const plan = failure instanceof IndicatorsRequestError ? failure.plan : undefined;
      dispatch({ type: LoadFlowActionType.LOAD_FAILURE, message: toMessage(failure), plan });
    }
  };

  return {
    state,
    isBusy: isBusy(state),
    canReview: canReview(state),
    canLoad: canLoad(state),
    addFiles: (files: ReadonlyArray<File>) => dispatch({ type: LoadFlowActionType.ADD_FILES, files }),
    removeFile: (index: number) => dispatch({ type: LoadFlowActionType.REMOVE_FILE, index }),
    setAcceptShrink: (value: boolean) => dispatch({ type: LoadFlowActionType.SET_ACCEPT_SHRINK, value }),
    back: () => dispatch({ type: LoadFlowActionType.BACK }),
    restart: () => dispatch({ type: LoadFlowActionType.RESTART }),
    review,
    load,
  };
}

export type IndicatorsFlow = ReturnType<typeof useIndicatorsFlow>;
