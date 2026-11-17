import { GEOMETRY_EQUALITY_DECIMALS } from "../constants";

/** The grid the geometry comparisons snap to: GEOMETRY_EQUALITY_DECIMALS decimals of a degree-free metre grid (EJ-9). */
const SNAP_GRID = 10 ** -GEOMETRY_EQUALITY_DECIMALS;

/** A line in its comparable form: merged, snapped to SNAP_GRID and normalised. Two lines equal here are the same line for the job. */
export const comparableLineSql = (geometry: string): string =>
  `ST_Normalize(ST_SnapToGrid(ST_LineMerge(${geometry}), ${SNAP_GRID}))`;
