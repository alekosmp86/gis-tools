import {
  runFullReplace,
  type FullReplaceParams,
  type FullReplaceProgress,
  type FullReplaceResult,
} from "@/core/services/fullReplaceService";
import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import type { DbConfig } from "@/core/types/db";

export const FullReplaceRunStatus = {
  IDLE: "idle",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;

export type FullReplaceRunStatus = (typeof FullReplaceRunStatus)[keyof typeof FullReplaceRunStatus];

export interface FullReplaceRunContext {
  sourceLabel: string;
  targetLabel: string;
  sourceServer: string;
  targetServer: string;
  startedAt: number;
}

export interface FullReplaceRunState {
  status: FullReplaceRunStatus;
  progress: FullReplaceProgress | null;
  result: FullReplaceResult | null;
  error: string | null;
  context: FullReplaceRunContext | null;
}

const IDLE_STATE: FullReplaceRunState = {
  status: FullReplaceRunStatus.IDLE,
  progress: null,
  result: null,
  error: null,
  context: null,
};

let state: FullReplaceRunState = IDLE_STATE;
let currentRunId = 0;
const listeners = new Set<() => void>();

export const describeDbServer = (config: DbConfig): string => `${config.host}:${config.port}/${config.db_name}`;

const warnBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();

function setState(next: FullReplaceRunState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function registerBeforeUnload(): void {
  if (typeof window !== "undefined") window.addEventListener("beforeunload", warnBeforeUnload);
}

function unregisterBeforeUnload(): void {
  if (typeof window !== "undefined") window.removeEventListener("beforeunload", warnBeforeUnload);
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getSnapshot = (): FullReplaceRunState => state;

export const getServerSnapshot = (): FullReplaceRunState => IDLE_STATE;

export async function start(params: Omit<FullReplaceParams, "onProgress">): Promise<void> {
  if (state.status === FullReplaceRunStatus.RUNNING) return;

  const { sourceConfig, targetConfig } = params;
  const context: FullReplaceRunContext = {
    sourceLabel: buildQualifiedTableLabel(sourceConfig.schema_name, sourceConfig.table_name),
    targetLabel: buildQualifiedTableLabel(targetConfig.schema_name, targetConfig.table_name),
    sourceServer: describeDbServer(sourceConfig),
    targetServer: describeDbServer(targetConfig),
    startedAt: Date.now(),
  };
  const runId = ++currentRunId;
  const isCurrentRun = () => runId === currentRunId && state.status === FullReplaceRunStatus.RUNNING;
  setState({ ...IDLE_STATE, status: FullReplaceRunStatus.RUNNING, context });
  registerBeforeUnload();

  try {
    const result = await runFullReplace({
      ...params,
      onProgress: (progress) => {
        if (!isCurrentRun()) return;
        setState({ ...state, progress });
      },
    });
    if (isCurrentRun()) setState({ ...state, status: FullReplaceRunStatus.DONE, result });
  } catch (runError: unknown) {
    const error = runError instanceof Error ? runError.message : "Error desconocido durante el reemplazo completo.";
    if (isCurrentRun()) setState({ ...state, status: FullReplaceRunStatus.FAILED, error });
  } finally {
    unregisterBeforeUnload();
  }
}

export function reset(): void {
  if (state.status === FullReplaceRunStatus.RUNNING || state.status === FullReplaceRunStatus.IDLE) return;
  setState(IDLE_STATE);
}
