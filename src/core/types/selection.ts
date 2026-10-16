export type SelectionIdSet = ReadonlySet<string>;

export const SelectionCheckState = {
  NONE: "none",
  SOME: "some",
  ALL: "all",
} as const;

export type SelectionCheckState = (typeof SelectionCheckState)[keyof typeof SelectionCheckState];

export interface SelectedPatchCounts {
  updates: number;
  inserts: number;
}
