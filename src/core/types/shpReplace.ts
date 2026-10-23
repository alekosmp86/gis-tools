export const SHP_GEOMETRY_SOURCE = "__geometry__";

export const ShpReplacePhase = {
  STAGING: "staging",
  PROCESSING: "processing",
  SWAPPING: "swapping",
  FINALIZING: "finalizing",
} as const;

export type ShpReplacePhase = (typeof ShpReplacePhase)[keyof typeof ShpReplacePhase];

export const ShpJobState = {
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
} as const;

export type ShpJobState = (typeof ShpJobState)[keyof typeof ShpJobState];
