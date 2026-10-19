export const SyncMode = {
  COMPARE: "compare",
  REPLACE: "replace",
} as const;

export type SyncMode = (typeof SyncMode)[keyof typeof SyncMode];
