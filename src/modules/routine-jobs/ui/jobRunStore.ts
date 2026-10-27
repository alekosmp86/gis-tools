export const RunPhase = {
  IDLE: "idle",
  STARTING: "starting",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
  UNKNOWN: "unknown",
} as const;

export type RunPhase = (typeof RunPhase)[keyof typeof RunPhase];

export interface RunJobView {
  state: "RUNNING" | "DONE" | "FAILED";
  error?: string;
}

export interface RunSnapshot<Job, Plan> {
  phase: RunPhase;
  jobId?: string;
  job?: Job;
  error?: string;
  startedAt?: number;
  plan?: Plan;
}

export interface RunClient<Request, Job> {
  start(request: Request): Promise<{ jobId: string }>;
  readStatus(jobId: string): Promise<Job>;
}

export interface RunMessages {
  startFallback: string;
  jobFailed: string;
  unknownOutcome(jobId: string): string;
}

export interface RunStoreDeps<Request, Job, Plan> {
  client: RunClient<Request, Job>;
  planOf(request: Request): Plan;
  messages: RunMessages;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  now?: () => number;
  pollMs?: number;
  giveUpMs?: number;
}

export interface RunStore<Request, Job, Plan> {
  getSnapshot(): RunSnapshot<Job, Plan>;
  subscribe(listener: () => void): () => void;
  start(request: Request): Promise<void>;
  reset(): void;
}

const POLL_INTERVAL_MS = 2000;
const GIVE_UP_AFTER_MS = 60_000;
const JOB_STATE = { DONE: "DONE", FAILED: "FAILED" } as const;

const defaultSetTimer = (callback: () => void, ms: number): unknown => setTimeout(callback, ms);
const defaultClearTimer = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>);

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() !== "" ? error.message : fallback;

export function createJobRunStore<Request, Job extends RunJobView, Plan>(
  deps: RunStoreDeps<Request, Job, Plan>,
): RunStore<Request, Job, Plan> {
  const { client, planOf, messages } = deps;
  const setTimer = deps.setTimer ?? defaultSetTimer;
  const clearTimer = deps.clearTimer ?? defaultClearTimer;
  const now = deps.now ?? Date.now;
  const pollMs = deps.pollMs ?? POLL_INTERVAL_MS;
  const giveUpMs = deps.giveUpMs ?? GIVE_UP_AFTER_MS;

  const idleSnapshot: RunSnapshot<Job, Plan> = { phase: RunPhase.IDLE };
  const listeners = new Set<() => void>();
  let snapshot: RunSnapshot<Job, Plan> = idleSnapshot;
  let generation = 0;
  let pendingTimer: { handle: unknown } | null = null;
  let failingSince: number | null = null;

  const publish = (next: RunSnapshot<Job, Plan>): void => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };

  const cancelTimer = (): void => {
    if (pendingTimer) clearTimer(pendingTimer.handle);
    pendingTimer = null;
  };

  const finishUnknown = (jobId: string): void => {
    publish({
      phase: RunPhase.UNKNOWN,
      jobId,
      job: snapshot.job,
      startedAt: snapshot.startedAt,
      plan: snapshot.plan,
      error: messages.unknownOutcome(jobId),
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

  const failedError = (job: Job): string => (job.error && job.error.trim() !== "" ? job.error : messages.jobFailed);

  const applyJob = (current: number, jobId: string, job: Job): void => {
    failingSince = null;
    const base = { jobId, job, startedAt: snapshot.startedAt, plan: snapshot.plan };
    if (job.state === JOB_STATE.DONE) {
      publish({ ...base, phase: RunPhase.DONE });
      return;
    }
    if (job.state === JOB_STATE.FAILED) {
      publish({ ...base, phase: RunPhase.FAILED, error: failedError(job) });
      return;
    }
    publish({ ...base, phase: RunPhase.RUNNING });
    schedulePoll(current, jobId);
  };

  async function pollOnce(current: number, jobId: string): Promise<void> {
    let job: Job;
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

  async function start(request: Request): Promise<void> {
    if (snapshot.phase === RunPhase.STARTING || snapshot.phase === RunPhase.RUNNING) return;
    generation += 1;
    const current = generation;
    cancelTimer();
    failingSince = null;
    publish({ phase: RunPhase.STARTING, startedAt: now(), plan: planOf(request) });

    let jobId: string;
    try {
      ({ jobId } = await client.start(request));
    } catch (error: unknown) {
      if (current === generation) {
        publish({ phase: RunPhase.FAILED, error: messageOf(error, messages.startFallback) });
      }
      return;
    }
    if (current !== generation) return;
    publish({ phase: RunPhase.RUNNING, jobId, startedAt: snapshot.startedAt, plan: snapshot.plan });
    schedulePoll(current, jobId);
  }

  function reset(): void {
    generation += 1;
    cancelTimer();
    failingSince = null;
    if (snapshot.phase !== RunPhase.IDLE) publish(idleSnapshot);
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

/** One store per browser tab, kept on globalThis so that in-app navigation does not lose a running job. */
export function sharedRunStore<Store>(key: string, create: () => Store): Store {
  const holder = globalThis as unknown as Record<string, Store | undefined>;
  const existing = holder[key] ?? create();
  holder[key] = existing;
  return existing;
}
