import type {
  JobDbConnection,
  JobGates,
  JobMode,
  JobProgress,
  JobStageId,
  JobTarget,
  LogLevel,
  TestReport,
} from "./types.ts";

export type PipelineOutcome =
  | { kind: "SUCCEEDED"; gates?: JobGates; testReport?: TestReport; leftovers?: string[] }
  | { kind: "FAILED"; error: { code: string; message: string } }
  | { kind: "CANCELLED" };

export type CancelHook = () => void | Promise<void>;

/** What the runtime hands the pipeline. `connection` is opaque and in memory only. */
export interface JobContext {
  readonly signal: AbortSignal;
  readonly mode: JobMode;
  readonly target: JobTarget;
  readonly sourcePath: string;
  readonly connection: Readonly<JobDbConnection>;
  log(level: LogLevel, message: string): void;
  setStage(id: JobStageId): void;
  updateProgress(partial: Partial<JobProgress>): void;
  /** Registers the hook run once when a cancel is observed (later: pg_cancel_backend). `null` clears it. */
  registerOnCancel(hook: CancelHook | null): void;
}

export interface JobPipeline {
  run(context: JobContext): Promise<PipelineOutcome>;
}
