import { randomUUID } from "node:crypto";
import type { ShpReplaceProgress, ShpReplaceResult } from "@/core/services/server/shpReplace/shpReplaceTypes";
import { ShpJobState, type ShpReplacePhase } from "@/core/types/shpReplace";

export { ShpJobState };

export interface ShpJobSnapshot {
  jobId: string;
  tableKey: string;
  state: ShpJobState;
  phase: ShpReplacePhase | null;
  current?: number;
  total?: number;
  startedAt: number;
  finishedAt?: number;
  result?: ShpReplaceResult;
  error?: string;
  outcomeUnknown?: boolean;
}

export interface ShpJobStore {
  tryStart(tableKey: string): ShpJobSnapshot | null;
  progress(jobId: string, progress: ShpReplaceProgress): void;
  finish(jobId: string, result: ShpReplaceResult): void;
  fail(jobId: string, error: string, outcomeUnknown?: boolean): void;
  get(jobId: string): ShpJobSnapshot | undefined;
  sweep(maxAgeMs: number): number;
}

type Clock = () => number;

const SINGLETON_KEY = "__gisToolsShpReplaceJobStore";

interface ShpJobStoreHolder {
  [SINGLETON_KEY]?: ShpJobStore;
}

const isStaleFinished = (job: ShpJobSnapshot, now: number, maxAgeMs: number): boolean =>
  job.finishedAt !== undefined && now - job.finishedAt > maxAgeMs;

export function createShpJobStore(now: Clock = Date.now): ShpJobStore {
  const jobs = new Map<string, ShpJobSnapshot>();

  const update = (jobId: string, changes: Partial<ShpJobSnapshot>): void => {
    const job = jobs.get(jobId);
    if (job) jobs.set(jobId, { ...job, ...changes });
  };

  const finishWith = (jobId: string, changes: Partial<ShpJobSnapshot>): void =>
    update(jobId, { ...changes, finishedAt: now() });

  return {
    tryStart(tableKey) {
      const busy = Array.from(jobs.values()).some(
        (job) => job.tableKey === tableKey && job.state === ShpJobState.RUNNING
      );
      if (busy) return null;
      const job: ShpJobSnapshot = {
        jobId: randomUUID(),
        tableKey,
        state: ShpJobState.RUNNING,
        phase: null,
        startedAt: now(),
      };
      jobs.set(job.jobId, job);
      return { ...job };
    },
    progress(jobId, progress) {
      update(jobId, { phase: progress.phase, current: progress.current, total: progress.total });
    },
    finish(jobId, result) {
      finishWith(jobId, { state: ShpJobState.DONE, result, outcomeUnknown: false });
    },
    fail(jobId, error, outcomeUnknown = false) {
      finishWith(jobId, { state: ShpJobState.FAILED, error, outcomeUnknown });
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

export function getShpJobStore(): ShpJobStore {
  const holder = globalThis as typeof globalThis & ShpJobStoreHolder;
  holder[SINGLETON_KEY] ??= createShpJobStore();
  return holder[SINGLETON_KEY];
}
