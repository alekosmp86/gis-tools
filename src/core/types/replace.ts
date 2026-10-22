export const AnalyzeStatus = {
  OK: "ok",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type AnalyzeStatus = (typeof AnalyzeStatus)[keyof typeof AnalyzeStatus];

export interface AnalyzeOutcome {
  status: AnalyzeStatus;
  message?: string;
}

export interface SequenceAdjustment {
  qualifiedLabel: string;
  nextValue: number;
  resetToStart: boolean;
}
