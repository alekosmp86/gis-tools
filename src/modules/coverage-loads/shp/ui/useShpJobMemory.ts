"use client";

import { useEffect } from "react";
import { ShpPhase } from "../domain/shpFlowState";
import { activeJobMemory } from "./shpBrowserAlerts";

/**
 * Lets the app-wide chip find the running job. A finished job is not forgotten here: the chip does
 * that itself once it has seen the end and announced it, otherwise the result page would race it.
 */
export function useShpJobMemory(phase: ShpPhase, jobId: string | null): void {
  useEffect(() => {
    if (phase === ShpPhase.RUNNING && jobId !== null) {
      activeJobMemory.remember(jobId);
      return;
    }
    if (phase !== ShpPhase.DONE && phase !== ShpPhase.RESUMING) activeJobMemory.forget();
  }, [phase, jobId]);
}
