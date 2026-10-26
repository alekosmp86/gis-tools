import { CLEAR_MODE } from "../constants";
import type { CargarPadronesParams, RunProgress, StepTiming } from "../types";

export const STEP = {
  VALIDATE: "Validación de tablas",
  COUNT: "Conteo de filas",
  PRIVILEGES: "Privilegios de vaciado",
  CLEAR: "Vaciado de la tabla destino",
  SEQUENCES_RESET: "Reinicio de secuencias",
  LOAD_RURAL: "Carga rural",
  LOAD_URBANO: "Carga urbana",
  REPORT: "Reportes y muestras",
  SEQUENCES_REPAIR: "Ajuste de secuencias",
  COMMIT: "COMMIT",
  ANALYZE: "ANALYZE",
} as const;

export interface StepTimer {
  timings: StepTiming[];
  run<T>(label: string, work: () => Promise<T>): Promise<T>;
}

export interface StepTimerOptions {
  now: () => number;
  total: number;
  onProgress?: (progress: RunProgress) => void;
}

const CORE_STEP_COUNT = 6;
const PRIVILEGE_STEP_COUNT = 1;
const SEQUENCE_STEP_COUNT = 2;
const COMMIT_STEP_COUNT = 2;

export function plannedStepCount(params: CargarPadronesParams): number {
  const { options, dryRun } = params;
  const privileges = options.clearMode === CLEAR_MODE.TRUNCATE ? PRIVILEGE_STEP_COUNT : 0;
  const sequences = options.resetSequences && !dryRun ? SEQUENCE_STEP_COUNT : 0;
  const commit = dryRun ? 0 : COMMIT_STEP_COUNT;
  return CORE_STEP_COUNT + privileges + sequences + commit;
}

function notify(onProgress: StepTimerOptions["onProgress"], progress: RunProgress): void {
  if (!onProgress) return;
  try {
    onProgress(progress);
  } catch {
    // A progress sink never fails the run.
  }
}

export function createStepTimer({ now, total, onProgress }: StepTimerOptions): StepTimer {
  const timings: StepTiming[] = [];
  let started = 0;
  return {
    timings,
    async run<T>(label: string, work: () => Promise<T>): Promise<T> {
      started += 1;
      notify(onProgress, { label, current: started, total });
      const startedAt = now();
      const value = await work();
      timings.push({ label, ms: now() - startedAt });
      return value;
    },
  };
}
