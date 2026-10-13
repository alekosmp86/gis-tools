import type { CancelHook, JobContext } from "@/modules/coverage-loads/shp/job/pipeline.ts";
import type { JobMode, JobProgress, JobStageId, LogLevel } from "@/modules/coverage-loads/shp/job/types.ts";
import { CANARY_CONNECTION } from "./jobTestEnv.ts";

export interface RecordingContext {
  context: JobContext;
  abort: AbortController;
  stages: JobStageId[];
  progress: Partial<JobProgress>[];
  logs: { level: LogLevel; message: string }[];
  hooks: (CancelHook | null)[];
}

/** A hand-rolled JobContext that only records what the pipeline does. No fs, no timers. */
export function createRecordingContext(mode: JobMode = "LOAD"): RecordingContext {
  const abort = new AbortController();
  const recorder: RecordingContext = { context: undefined as unknown as JobContext, abort, stages: [], progress: [], logs: [], hooks: [] };
  recorder.context = {
    signal: abort.signal,
    mode,
    target: { table: "lte", prefix: "LTEUruguay", fechaact: "2026-01-31" },
    sourcePath: "unused.shp",
    connection: CANARY_CONNECTION,
    log: (level, message) => recorder.logs.push({ level, message }),
    setStage: (id) => recorder.stages.push(id),
    updateProgress: (partial) => recorder.progress.push(partial),
    registerOnCancel: (hook) => recorder.hooks.push(hook),
  };
  return recorder;
}
