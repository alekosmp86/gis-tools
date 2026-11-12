import type { Geometry } from "geojson";

export const OUTLINE_ROLE = {
  OLD: "old",
  NEW: "new",
} as const;

export type OutlineRole = (typeof OUTLINE_ROLE)[keyof typeof OUTLINE_ROLE];

/** One outline the server returned for a requested item; `itemIndex` is the position of that item in the request. */
export interface OutlineFeature {
  itemIndex: number;
  role: OutlineRole;
  label: string;
  geometry: Geometry;
}

/** What the map needs of an outline: its minimal label and, when its role colour is not enough, its own colour type. */
export interface OutlineLabel {
  label: string;
  mapType?: string;
}

/** The items of one map request. `items[i]` is the request item of `outlines[i]`: the two lists are parallel. */
export interface OutlineMapSubject<Item, Outline extends OutlineLabel = OutlineLabel> {
  title: string;
  items: Item[];
  outlines: Outline[];
}
