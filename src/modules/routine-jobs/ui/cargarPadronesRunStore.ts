import type { JobStatusView, StartRequest } from "./clientTypes";
import { createRoutineJobsClient } from "./routineJobsClient";

const CargarPadronesRunPhase = {
  IDLE: "idle",
  STARTING: "starting",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
  UNKNOWN: "unknown",
} as const;

export type CargarPadronesRunPhase = (typeof CargarPadronesRunPhase)[keyof typeof CargarPadronesRunPhase];

export interface CargarPadronesRunSnapshot {
  phase: CargarPadronesRunPhase;
  jobId?: string;
  job?: JobStatusView;
  error?: string;
  startedAt?: number;
}

export interface CargarPadronesRunClient {
  start(request: StartRequest): Promise<{ jobId: string }>;
  readStatus(jobId: string): Promise<JobStatusView>;
}

export interface CargarPadronesRunStoreDeps {
  client: CargarPadronesRunClient;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
  pollMs?: number;
  giveUpMs?: number;
}

export interface CargarPadronesRunStore {
  getSnapshot(): CargarPadronesRunSnapshot;
  subscribe(listener: () => void): () => void;
  start(request: StartRequest): Promise<void>;
  reset(): void;
}

const POLL_INTERVAL_MS = 2000;
const GIVE_UP_AFTER_MS = 60_000;
const START_FALLBACK_ERROR = "No se pudo iniciar la carga.";
const JOB_FAILED_ERROR = "La carga terminó con error en el servidor.";
const UNKNOWN_OUTCOME_PREFIX = "No se pudo confirmar el resultado del trabajo";
const UNKNOWN_OUTCOME_SUFFIX = "Revise la tabla destino antes de volver a cargar.";
const GLOBAL_KEY = "__gisToolsCargarPadronesRunStore";

const IDLE_SNAPSHOT: CargarPadronesRunSnapshot = { phase: CargarPadronesRunPhase.IDLE };

interface RunStoreHolder {
  [GLOBAL_KEY]?: CargarPadronesRunStore;
}

const defaultSetTimer = (callback: () => void, ms: number): unknown => setTimeout(callback, ms);
const defaultClearTimer = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>);

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() !== "" ? error.message : fallback;

const unknownOutcomeMessage = (jobId: string): string =>
  `${UNKNOWN_OUTCOME_PREFIX} ${jobId}. ${UNKNOWN_OUTCOME_SUFFIX}`;

export function createCargarPadronesRunStore(deps: CargarPadronesRunStoreDeps): CargarPadronesRunStore {
  const { client } = deps;
  const setTimer = deps.setTimer ?? defaultSetTimer;
  const clearTimer = deps.clearTimer ?? defaultClearTimer;
  const now = deps.now ?? Date.now;
  const pollMs = deps.pollMs ?? POLL_INTERVAL_MS;
  const giveUpMs = deps.giveUpMs ?? GIVE_UP_AFTER_MS;

  const listeners = new Set<() => void>();
  let snapshot: CargarPadronesRunSnapshot = IDLE_SNAPSHOT;
  let generation = 0;
  let pendingTimer: { handle: unknown } | null = null;
  let failingSince: number | null = null;

  const publish = (next: CargarPadronesRunSnapshot): void => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const cancelTimer = (): void => {
    if (pendingTimer) clearTimer(pendingTimer.handle);
    pendingTimer = null;
  };

  const finishUnknown = (jobId: string): void => {
    publish({
      phase: CargarPadronesRunPhase.UNKNOWN,
      jobId,
      job: snapshot.job,
      startedAt: snapshot.startedAt,
      error: unknownOutcomeMessage(jobId),
    });
  };

  const handlePollFailure = (current: number, jobId: string): void => {
    failingSince ??= now();
    if (now() - failingSince >= giveUpMs) {
      finishUnknown(jobId);
      return;
    }
    schedulePoll(current, jobId);
  };

  const applyJob = (current: number, jobId: string, job: JobStatusView): void => {
    failingSince = null;
    const base = { jobId, job, startedAt: snapshot.startedAt };
    if (job.state === "DONE") {
      publish({ ...base, phase: CargarPadronesRunPhase.DONE });
      return;
    }
    if (job.state === "FAILED") {
      publish({ ...base, phase: CargarPadronesRunPhase.FAILED, error: job.error && job.error.trim() !== "" ? job.error : JOB_FAILED_ERROR });
      return;
    }
    publish({ ...base, phase: CargarPadronesRunPhase.RUNNING });
    schedulePoll(current, jobId);
  };

  async function pollOnce(current: number, jobId: string): Promise<void> {
    let job: JobStatusView;
    try {
      job = await client.readStatus(jobId);
    } catch {
      if (current === generation) handlePollFailure(current, jobId);
      return;
    }
    if (current === generation) applyJob(current, jobId, job);
  }

  function schedulePoll(current: number, jobId: string): void {
    pendingTimer = {
      handle: setTimer(() => {
        pendingTimer = null;
        void pollOnce(current, jobId);
      }, pollMs),
    };
  }

  async function start(request: StartRequest): Promise<void> {
    if (snapshot.phase === CargarPadronesRunPhase.STARTING || snapshot.phase === CargarPadronesRunPhase.RUNNING) return;
    generation += 1;
    const current = generation;
    cancelTimer();
    failingSince = null;
    publish({ phase: CargarPadronesRunPhase.STARTING, startedAt: now() });

    let jobId: string;
    try {
      ({ jobId } = await client.start(request));
    } catch (error: unknown) {
      if (current === generation) {
        publish({ phase: CargarPadronesRunPhase.FAILED, error: messageOf(error, START_FALLBACK_ERROR) });
      }
      return;
    }
    if (current !== generation) return;
    publish({ phase: CargarPadronesRunPhase.RUNNING, jobId, startedAt: snapshot.startedAt });
    schedulePoll(current, jobId);
  }

  function reset(): void {
    generation += 1;
    cancelTimer();
    failingSince = null;
    if (snapshot.phase !== CargarPadronesRunPhase.IDLE) publish(IDLE_SNAPSHOT);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start,
    reset,
  };
}

export function getCargarPadronesRunStore(): CargarPadronesRunStore {
  const holder = globalThis as typeof globalThis & RunStoreHolder;
  holder[GLOBAL_KEY] ??= createCargarPadronesRunStore({ client: createRoutineJobsClient() });
  return holder[GLOBAL_KEY];
}
