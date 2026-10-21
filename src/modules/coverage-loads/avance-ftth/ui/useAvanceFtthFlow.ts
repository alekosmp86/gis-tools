"use client";

import { useRef, useState } from "react";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import type { ConnectionPayload } from "../../types";
import {
  canReview,
  canRun,
  INITIAL_LOAD_FLOW,
  isBusy,
  loadFlowReducer,
  LoadFlowActionType,
  type LoadFlowAction,
  type RunMode,
} from "../domain/loadFlow";
import { reportStage } from "../domain/stageReport";
import { AvanceRequestError, requestPlan, requestRun } from "./avanceFtthClient";

const UNKNOWN_FAILURE = "No se pudo completar la operación.";

function toMessage(failure: unknown): string {
  return failure instanceof Error ? failure.message : UNKNOWN_FAILURE;
}

/**
 * Drives the stage: files, review, run, result. The connection comes from the workflow shell; when
 * its revision changes, any reviewed plan is discarded. A run is only possible from a reviewed plan
 * without blockers: the reducer refuses `RUN_START` otherwise, and this hook re-checks before it
 * talks to the server.
 */
export function useAvanceFtthFlow(
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

  const run = async (mode: RunMode) => {
    if (!canRun(current())) return;
    if (!dispatch({ type: LoadFlowActionType.RUN_START, mode })) return;
    try {
      const result = await requestRun(connection, current().files, mode);
      dispatch({ type: LoadFlowActionType.RUN_SUCCESS, result });
    } catch (failure: unknown) {
      const plan = failure instanceof AvanceRequestError ? failure.plan : undefined;
      dispatch({ type: LoadFlowActionType.RUN_FAILURE, message: toMessage(failure), plan });
    }
  };

  return {
    state,
    isBusy: isBusy(state),
    canReview: canReview(state),
    canRun: canRun(state),
    addFiles: (files: ReadonlyArray<File>) => dispatch({ type: LoadFlowActionType.ADD_FILES, files }),
    removeFile: (index: number) => dispatch({ type: LoadFlowActionType.REMOVE_FILE, index }),
    back: () => dispatch({ type: LoadFlowActionType.BACK }),
    backToReview: () => dispatch({ type: LoadFlowActionType.BACK_TO_REVIEW }),
    restart: () => dispatch({ type: LoadFlowActionType.RESTART }),
    review,
    run,
  };
}

export type AvanceFtthFlow = ReturnType<typeof useAvanceFtthFlow>;
