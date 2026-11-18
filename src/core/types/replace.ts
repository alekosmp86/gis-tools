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

export const GeometryRepairStatus = {
  OFF: "off",
  OK: "ok",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type GeometryRepairStatus = (typeof GeometryRepairStatus)[keyof typeof GeometryRepairStatus];

export interface GeometryRepairColumnOutcome {
  column: string;
  repairedRows: number;
  unrepairableRows: number;
}

export interface GeometryRepairOutcome {
  status: GeometryRepairStatus;
  columns: GeometryRepairColumnOutcome[];
  skippedColumns: string[];
  message?: string;
}
