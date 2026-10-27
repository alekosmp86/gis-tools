import { randomUUID } from "node:crypto";
import type { CargarPadronesResult, RunProgress } from "../types";

export const JobState = {
  RUNNING: "RUNNING",
  DONE: "DONE",
  FAILED: "FAILED",
} as const;

export type JobState = (typeof JobState)[keyof typeof JobState];

export interface JobSnapshot {
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
  result?: CargarPadronesResult;
  error?: string;
  outcomeUnknown?: boolean;
}

export interface CargarPadronesJobStore {
  tryStart(tableKey: string, dryRun?: boolean, steps?: readonly string[]): JobSnapshot | null;
  progress(jobId: string, progress: RunProgress): void;
  finish(jobId: string, result: CargarPadronesResult): void;
  fail(jobId: string, error: string): void;
  get(jobId: string): JobSnapshot | undefined;
  sweep(maxAgeMs: number): number;
}

type Clock = () => number;

const SINGLETON_KEY = "__gisToolsCargarPadronesJobStore";

interface JobStoreHolder {
  [SINGLETON_KEY]?: CargarPadronesJobStore;
}

const isStaleFinished = (job: JobSnapshot, now: number, maxAgeMs: number): boolean =>
  job.finishedAt !== undefined && now - job.finishedAt > maxAgeMs;

export function createCargarPadronesJobStore(now: Clock = Date.now): CargarPadronesJobStore {
  const jobs = new Map<string, JobSnapshot>();

  const update = (jobId: string, changes: Partial<JobSnapshot>): void => {
    const job = jobs.get(jobId);
    if (job) jobs.set(jobId, { ...job, ...changes });
  };

  const finishWith = (jobId: string, changes: Partial<JobSnapshot>): void =>
    update(jobId, { ...changes, finishedAt: now() });

  return {
    tryStart(tableKey, dryRun = false, steps = []) {
      const busy = Array.from(jobs.values()).some(
        (job) => job.tableKey === tableKey && job.state === JobState.RUNNING
      );
      if (busy) return null;
      const job: JobSnapshot = {
        jobId: randomUUID(),
        tableKey,
        state: JobState.RUNNING,
        step: null,
        dryRun,
        steps,
        startedAt: now(),
      };
      jobs.set(job.jobId, job);
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
          removed += 1;
        }
      }
      return removed;
    },
  };
}

export function getCargarPadronesJobStore(): CargarPadronesJobStore {
  const holder = globalThis as typeof globalThis & JobStoreHolder;
  holder[SINGLETON_KEY] ??= createCargarPadronesJobStore();
  return holder[SINGLETON_KEY];
}
