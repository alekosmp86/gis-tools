import { isJobDead } from "../job/liveness.ts";
import { readStatus } from "../job/statusFile.ts";
import type { JobStatus } from "../job/types.ts";
import type { JobSummary } from "../types";
import { listJobIds } from "./jobStore";
import type { ShpContext } from "./shpContext";

export function isStale(context: ShpContext, status: JobStatus): boolean {
  const safeIsPidAlive = (pid: number): boolean => {
    try {
      return context.isPidAlive(pid);
    } catch {
      return true;
    }
  };
  return isJobDead(status, context.now(), { isPidAlive: safeIsPidAlive });
}

export function summarize(context: ShpContext, status: JobStatus): JobSummary {
  return {
    jobId: status.jobId,
    target: status.target,
    mode: status.mode,
    state: status.state,
    stage: status.stage,
    stageFraction: status.progress.stageFraction,
    overallFraction: status.progress.overallFraction,
    startedAt: status.startedAt,
    updatedAt: status.updatedAt,
    errorMessage: status.error?.message ?? null,
    stale: isStale(context, status),
  };
}

/** One small read per job, newest first. No heavy work: this is what a polling chip calls. */
export async function listJobSummaries(context: ShpContext): Promise<JobSummary[]> {
  const statuses = await Promise.all((await listJobIds(context.rootDir)).map((jobId) => readStatus(context.rootDir, jobId)));
  const summaries = statuses.flatMap((status) => (status === null ? [] : [summarize(context, status)]));
  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
