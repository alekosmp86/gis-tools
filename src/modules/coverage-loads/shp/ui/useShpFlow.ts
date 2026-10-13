"use client";

import { useEffect, useRef } from "react";
import type { StagePanelProps } from "../../shared/domain/stageContract";
import type { ConnectionPayload } from "../../types";
import { ShpActionType } from "../domain/shpFlowReducer";
import { canPlan, canStart, canUpload, isBusy, ShpPhase, type ShpFlowState } from "../domain/shpFlowState";
import type { JobMode } from "../job/types.ts";
import { runCancel, runDiscard, runPlan, runResume, runStart, runUpload } from "./shpFlowActions";
import { useShpDispatch } from "./useShpDispatch";
import { useShpJobMemory } from "./useShpJobMemory";
import { useShpPolling } from "./useShpPolling";

/** A plan computed against another connection is not shown and cannot start a load. */
function withoutStalePlan(state: ShpFlowState, connectionRevision: number): ShpFlowState {
  return state.planRevision === connectionRevision ? state : { ...state, plan: null };
}

/**
 * Drives the SHP stage: pick, upload, review, run, result. The connection comes from the workflow
 * shell on every call and is never kept in state; a changed connection only makes a reviewed plan
 * stale, because a job that is already running no longer needs it.
 */
export function useShpFlow(
  connection: ConnectionPayload,
  connectionRevision: number,
  onStatusChange: StagePanelProps["onStatusChange"]
) {
  const { state: rawState, dispatch } = useShpDispatch(onStatusChange);
  const state = withoutStalePlan(rawState, connectionRevision);
  const uploadAbort = useRef<AbortController | null>(null);
  const jobId = state.job?.jobId ?? null;

  useEffect(() => {
    void runResume(dispatch);
  }, [dispatch]);
  useShpPolling(state.phase, jobId, dispatch);
  useShpJobMemory(state.phase, jobId);

  const upload = () => {
    if (!canUpload(state) || state.file === null) return;
    uploadAbort.current = new AbortController();
    void runUpload(connection, connectionRevision, state.file, uploadAbort.current.signal, dispatch);
  };
  const review = () => {
    if (canPlan(state) && jobId !== null) void runPlan(connection, connectionRevision, jobId, dispatch);
  };
  const start = () => {
    if (canStart(state) && jobId !== null) void runStart(connection, jobId, state.mode, dispatch);
  };
  const discard = () => {
    if (jobId !== null) void runDiscard(jobId, state.phase === ShpPhase.DONE, dispatch);
  };

  return {
    state,
    isBusy: isBusy(state),
    canUpload: canUpload(state),
    canPlan: canPlan(state),
    canStart: canStart(state),
    pickFile: (file: File) => dispatch({ type: ShpActionType.PICK_FILE, file }),
    upload,
    cancelUpload: () => uploadAbort.current?.abort(),
    review,
    setMode: (mode: JobMode) => dispatch({ type: ShpActionType.SET_MODE, mode }),
    setConfirmed: (value: boolean) => dispatch({ type: ShpActionType.SET_CONFIRMED, value }),
    start,
    cancelRun: () => {
      if (jobId !== null) void runCancel(jobId, dispatch);
    },
    discard,
    restart: () => dispatch({ type: ShpActionType.RESTART }),
  };
}

export type ShpFlow = ReturnType<typeof useShpFlow>;
