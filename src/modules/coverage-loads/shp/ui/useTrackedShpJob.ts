"use client";

import { useEffect, useState } from "react";
import { isLiveJobState } from "../domain/shpAttention";
import { overallPercent } from "../domain/shpJobView";
import { isTerminalState } from "../job/types.ts";
import type { JobStatus } from "../job/types.ts";
import { activeJobMemory, setTabProgress, showFinishedNotification } from "./shpBrowserAlerts";
import { requestStatus } from "./shpClient";
import { ShpRequestError } from "./shpHttp";
import { SHP_CHIP_POLL_INTERVAL_MS } from "./shpUiConstants";

const NOT_FOUND = 404;

function announceFinished(status: JobStatus): void {
  if (!activeJobMemory.wasNotified(status.jobId)) {
    activeJobMemory.markNotified(status.jobId);
    showFinishedNotification(status);
  }
  if (activeJobMemory.read() === status.jobId) activeJobMemory.forget();
}

/** The remembered job while it runs, null when there is none or it has ended. Throws on a transient failure. */
async function readTrackedJob(): Promise<JobStatus | null> {
  const jobId = activeJobMemory.read();
  if (jobId === null) return null;
  try {
    const { status } = await requestStatus(jobId);
    if (isTerminalState(status.state)) announceFinished(status);
    return isLiveJobState(status.state) ? status : null;
  } catch (failure: unknown) {
    if (failure instanceof ShpRequestError && failure.httpStatus === NOT_FOUND) {
      activeJobMemory.forget();
      return null;
    }
    throw failure;
  }
}

/** One read of the tracked job; a transient failure resolves to undefined so the chip keeps what it shows. */
async function readOnce(): Promise<JobStatus | null | undefined> {
  try {
    const tracked = await readTrackedJob();
    setTabProgress(tracked === null ? null : overallPercent(tracked));
    return tracked;
  } catch {
    return undefined;
  }
}

/**
 * Follows the job the SHP stage remembered, from any page, on a slow interval and only while one is
 * remembered. Also keeps the tab title showing its progress. Uses no connection: `status` is open.
 */
export function useTrackedShpJob(): JobStatus | null {
  const [status, setStatus] = useState<JobStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      const tracked = await readOnce();
      inFlight = false;
      if (!cancelled && tracked !== undefined) setStatus(tracked);
    };
    void poll();
    const timer = setInterval(() => void poll(), SHP_CHIP_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      setTabProgress(null);
    };
  }, []);

  return status;
}
