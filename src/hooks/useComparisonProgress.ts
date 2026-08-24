import { useState } from "react";

export interface ComparisonProgress {
  phase: string;
  current: number;
  total: number;
  pct: number;
}

const INITIAL_PROGRESS: ComparisonProgress = {
  phase: "",
  current: 0,
  total: 0,
  pct: 0,
};

/**
 * Hook that tracks comparison progress emitted by the Web Worker via the WorkerBridge.
 * Returns the current progress state and stable callbacks to pass to the engine.
 * useCallback omitted — React Compiler manages memoization automatically.
 */
export function useComparisonProgress() {
  const [progress, setProgress] = useState<ComparisonProgress>(INITIAL_PROGRESS);

  function onProgress(phase: string, current: number, total: number) {
    setProgress({
      phase,
      current,
      total,
      pct: total > 0 ? Math.round((current / total) * 100) : 0,
    });
  }

  function resetProgress() {
    setProgress(INITIAL_PROGRESS);
  }

  return { progress, onProgress, resetProgress };
}
