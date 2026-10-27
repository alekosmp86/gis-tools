import { randomUUID } from "node:crypto";

export const JobState = {
  RUNNING: "RUNNING",
  DONE: "DONE",
  FAILED: "FAILED",
} as const;

export type JobState = (typeof JobState)[keyof typeof JobState];

export interface JobResult {
  outcomeUnknown: boolean;
}

export interface JobProgress {
  label: string;
  current: number;
  total: number;
}

export interface JobSnapshot<Result> {
  jobId: string;
  tableKey: string;
  state: JobState;
  step: string | null;
  current?: number;
  total?: number;
  dryRun: boolean;
  steps: readonly string[];
  startedAt: number;
  finishedAt?: number;
  result?: Result;
  error?: string;
  outcomeUnknown?: boolean;
}

export interface JobStore<Result extends JobResult> {
  tryStart(lockKeys: string | readonly string[], dryRun?: boolean, steps?: readonly string[]): JobSnapshot<Result> | null;
  progress(jobId: string, progress: JobProgress): void;
  finish(jobId: string, result: Result): void;
  fail(jobId: string, error: string): void;
  get(jobId: string): JobSnapshot<Result> | undefined;
  sweep(maxAgeMs: number): number;
}

type Clock = () => number;

const REGISTRY_KEY = "__gisToolsRoutineJobStores";

interface RegistryHolder {
  [REGISTRY_KEY]?: Map<string, JobStore<JobResult>>;
}

const isStaleFinished = (job: JobSnapshot<unknown>, now: number, maxAgeMs: number): boolean =>
  job.finishedAt !== undefined && now - job.finishedAt > maxAgeMs;

const keysOf = (lockKeys: string | readonly string[]): readonly string[] =>
  typeof lockKeys === "string" ? [lockKeys] : lockKeys;

export function createJobStore<Result extends JobResult>(now: Clock = Date.now): JobStore<Result> {
  const jobs = new Map<string, JobSnapshot<Result>>();
  const lockKeysByJob = new Map<string, readonly string[]>();

  const isBusyFor = (keys: readonly string[]): boolean => {
    const requested = new Set(keys);
    return Array.from(jobs.values()).some(
      (job) =>
        job.state === JobState.RUNNING && (lockKeysByJob.get(job.jobId) ?? []).some((key) => requested.has(key))
    );
  };

  const update = (jobId: string, changes: Partial<JobSnapshot<Result>>): void => {
    const job = jobs.get(jobId);
    if (job) jobs.set(jobId, { ...job, ...changes });
  };

  const finishWith = (jobId: string, changes: Partial<JobSnapshot<Result>>): void =>
    update(jobId, { ...changes, finishedAt: now() });

  return {
    tryStart(lockKeys, dryRun = false, steps = []) {
      const keys = keysOf(lockKeys);
      if (isBusyFor(keys)) return null;
      const job: JobSnapshot<Result> = {
        jobId: randomUUID(),
        tableKey: keys.join(" + "),
        state: JobState.RUNNING,
        step: null,
        dryRun,
        steps,
        startedAt: now(),
      };
      jobs.set(job.jobId, job);
      lockKeysByJob.set(job.jobId, keys);
      return { ...job };
    },
    progress(jobId, progress) {
      update(jobId, { step: progress.label, current: progress.current, total: progress.total });
    },
    finish(jobId, result) {
      finishWith(jobId, {
        state: JobState.DONE,
        result,
        outcomeUnknown: result.outcomeUnknown,
      });
    },
    fail(jobId, error) {
      finishWith(jobId, { state: JobState.FAILED, error });
    },
    get(jobId) {
      const job = jobs.get(jobId);
      return job ? { ...job } : undefined;
    },
    sweep(maxAgeMs) {
      let removed = 0;
      for (const [jobId, job] of jobs) {
        if (isStaleFinished(job, now(), maxAgeMs)) {
          jobs.delete(jobId);
          lockKeysByJob.delete(jobId);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

export function getJobStore<Result extends JobResult>(namespace: string): JobStore<Result> {
  const holder = globalThis as typeof globalThis & RegistryHolder;
  holder[REGISTRY_KEY] ??= new Map<string, JobStore<JobResult>>();
  const registry = holder[REGISTRY_KEY];
  let store = registry.get(namespace);
  if (store === undefined) {
    store = createJobStore<JobResult>();
    registry.set(namespace, store);
  }
  return store as unknown as JobStore<Result>;
}
