"use client";

import { useEffect, type Dispatch } from "react";
import { ShpActionType, type ShpAction } from "../domain/shpFlowReducer";
import { ShpPhase } from "../domain/shpFlowState";
import { requestLogTail, requestStatus } from "./shpClient";
import { SHP_POLL_INTERVAL_MS } from "./shpUiConstants";

const POLL_FAILURE = "No se pudo leer el estado de la carga.";

async function pollOnce(jobId: string, dispatch: Dispatch<ShpAction>, isCancelled: () => boolean): Promise<void> {
  try {
    const [result, tail] = await Promise.all([requestStatus(jobId), requestLogTail(jobId).catch(() => null)]);
    if (isCancelled()) return;
    if (tail !== null) dispatch({ type: ShpActionType.LOG_UPDATE, tail });
    dispatch({ type: ShpActionType.STATUS_UPDATE, status: result.status, stale: result.stale });
  } catch (failure: unknown) {
    if (isCancelled()) return;
    dispatch({ type: ShpActionType.ACTION_FAILED, message: failure instanceof Error ? failure.message : POLL_FAILURE });
  }
}

/** While the job runs: read its status and log tail now and every few seconds, until the phase leaves RUNNING. */
export function useShpPolling(phase: ShpPhase, jobId: string | null, dispatch: Dispatch<ShpAction>): void {
  useEffect(() => {
    if (phase !== ShpPhase.RUNNING || jobId === null) return;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      await pollOnce(jobId, dispatch, () => cancelled);
      inFlight = false;
    };
    void poll();
    const timer = setInterval(() => void poll(), SHP_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [phase, jobId, dispatch]);
}
