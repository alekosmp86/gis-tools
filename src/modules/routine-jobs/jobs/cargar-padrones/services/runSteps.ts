import type { RunProgress, StepTiming } from "../types";
import { plannedStepLabels, type PlannedStepsInput } from "../domain/plannedSteps";

export interface StepTimer {
  timings: StepTiming[];
  run<T>(label: string, work: () => Promise<T>): Promise<T>;
}

export interface StepTimerOptions {
  now: () => number;
  total: number;
  onProgress?: (progress: RunProgress) => void;
}

export function plannedStepCount(params: PlannedStepsInput): number {
  return plannedStepLabels(params).length;
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
