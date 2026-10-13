import { JOB_STATE } from "../job/types.ts";
import type { JobSummary } from "../types";

const RESUMABLE_STATES: readonly string[] = [JOB_STATE.READY, JOB_STATE.RUNNING, JOB_STATE.CANCELLING];

/** The newest job that is waiting to be started or still running; `jobs` arrives newest first. */
export function pickResumableJob(jobs: ReadonlyArray<JobSummary>): JobSummary | null {
  return jobs.find((job) => RESUMABLE_STATES.includes(job.state)) ?? null;
}
