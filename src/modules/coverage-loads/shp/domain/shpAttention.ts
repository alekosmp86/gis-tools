import { JOB_MODE, JOB_STATE } from "../job/types.ts";
import type { JobState, JobStatus } from "../job/types.ts";
import { currentPhaseLabel, jobStateLabel, overallPercent } from "./shpJobView";

const PROGRESS_PREFIX = /^\(\d+%\) /;
const LIVE_JOB_STATES: readonly JobState[] = [JOB_STATE.RUNNING, JOB_STATE.CANCELLING];

export function isLiveJobState(state: JobState): boolean {
  return LIVE_JOB_STATES.includes(state);
}

export function stripProgressPrefix(title: string): string {
  return title.replace(PROGRESS_PREFIX, "");
}

/** Replaces any earlier progress prefix, so repeated updates never stack "(1%) (2%) ...". */
export function titleWithProgress(title: string, percent: number): string {
  return `(${percent}%) ${stripProgressPrefix(title)}`;
}

export function chipLabel(status: JobStatus): string {
  const percent = overallPercent(status);
  const prefix = status.state === JOB_STATE.CANCELLING ? "Cancelando carga SHP" : `Carga SHP ${status.target.table}`;
  return `${prefix}: ${percent}%`;
}

export function chipDetail(status: JobStatus): string {
  return status.state === JOB_STATE.CANCELLING ? jobStateLabel(status.state) : currentPhaseLabel(status);
}

export function notificationTitle(status: JobStatus): string {
  const subject = status.mode === JOB_MODE.TEST ? "Prueba de carga SHP" : "Carga SHP";
  return `${subject}: ${jobStateLabel(status.state).toLowerCase()}`;
}

export function notificationBody(status: JobStatus): string {
  return `${status.source.fileName}, tabla public.${status.target.table}`;
}
