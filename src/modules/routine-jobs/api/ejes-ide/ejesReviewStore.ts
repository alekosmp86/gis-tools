import { getJobStore, type JobStore } from "../../jobs/shared/jobStore";
import type { EjesResult, EjesReviewStore, EjesStoredReviewPoint } from "../../jobs/ejes-ide/types";

export const EJES_IDE_JOB_NAMESPACE = "ejes-ide";

const REGISTRY_KEY = "__gisToolsEjesIdeReviewStore";

/** Keeps the points of the jobs the job store still holds; a point set whose job was evicted is dropped on the next call. */
function createEjesReviewStore(jobs: Pick<JobStore<EjesResult>, "get">): EjesReviewStore {
  const byJob = new Map<string, EjesStoredReviewPoint[]>();
  const keepLiveJobsOnly = (): void => {
    for (const jobId of Array.from(byJob.keys())) {
      if (jobs.get(jobId) === undefined) byJob.delete(jobId);
    }
  };
  return {
    retain(jobId, points) {
      keepLiveJobsOnly();
      byJob.set(jobId, points);
    },
    read(jobId) {
      keepLiveJobsOnly();
      return byJob.get(jobId);
    },
  };
}

/**
 * The job store the ejes handlers use: a dry run's review points are kept in the review store and never reach the job result, so
 * the status polls carry the report only.
 */
export function withReviewRetention(jobs: JobStore<EjesResult>, reviews: EjesReviewStore): JobStore<EjesResult> {
  return {
    ...jobs,
    finish(jobId, result) {
      const { reviewPoints, ...publicResult } = result;
      if (publicResult.dryRun && reviewPoints !== undefined) reviews.retain(jobId, reviewPoints);
      jobs.finish(jobId, publicResult);
    },
  };
}

interface RegistryHolder {
  [REGISTRY_KEY]?: EjesReviewStore;
}

/** The one review store of the process: the route handlers of the job and of the review read share it. */
export function getEjesReviewStore(): EjesReviewStore {
  const holder = globalThis as typeof globalThis & RegistryHolder;
  holder[REGISTRY_KEY] ??= createEjesReviewStore(getJobStore<EjesResult>(EJES_IDE_JOB_NAMESPACE));
  return holder[REGISTRY_KEY];
}
