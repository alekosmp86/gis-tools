import { DEAD_JOB_HEARTBEAT_MS, PID_REUSE_HEARTBEAT_BOUND_MS } from "./constants.ts";
import { LIVE_STATES } from "./types.ts";
import type { JobStatus } from "./types.ts";

export type PidAliveFn = (pid: number) => boolean;

/** ESRCH = no such process (dead); EPERM = exists but not ours (alive). */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface LivenessDeps {
  isPidAlive?: PidAliveFn;
  heartbeatThresholdMs?: number;
}

/** A live-state job is dead when its pid is gone AND its heartbeat is older than the threshold. */
export function isJobDead(status: JobStatus, now: number, deps: LivenessDeps = {}): boolean {
  if (!LIVE_STATES.includes(status.state)) return false;
  const alive = deps.isPidAlive ?? isPidAlive;
  const lastBeat = Date.parse(status.heartbeatAt ?? status.updatedAt);
  if (status.pid !== null && alive(status.pid)) {
    // An answering pid with a long-silent heartbeat is a reused pid, not our job.
    return !Number.isNaN(lastBeat) && now - lastBeat > PID_REUSE_HEARTBEAT_BOUND_MS;
  }
  const threshold = deps.heartbeatThresholdMs ?? DEAD_JOB_HEARTBEAT_MS;
  return Number.isNaN(lastBeat) || now - lastBeat > threshold;
}
