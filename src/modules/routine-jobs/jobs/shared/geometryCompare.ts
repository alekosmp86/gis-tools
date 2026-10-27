const SNAP_GRID_M = 0.001;

const SNAP = `${SNAP_GRID_M}`;
const MULTIPOLYGON_TYPE = "ST_MultiPolygon";

export const MATCH_CLASS = {
  NEW: "NEW",
  UNCHANGED: "UNCHANGED",
  WITHIN_TOLERANCE: "WITHIN_TOLERANCE",
  CHANGED: "CHANGED",
  AMBIGUOUS: "AMBIGUOUS",
} as const;

export const wasInvalidSql = (geometry: string): string => `(${geometry} IS NOT NULL AND NOT ST_IsValid(${geometry}))`;

export const repairedGeometrySql = (geometry: string, wasInvalid: string): string =>
  `CASE WHEN ${wasInvalid} THEN ST_Multi(ST_CollectionExtract(ST_MakeValid(${geometry}), 3)) ELSE ST_Multi(${geometry}) END`;

export const usableGeometrySql = (geometry: string): string =>
  `COALESCE(${geometry} IS NOT NULL AND NOT ST_IsEmpty(${geometry}) AND ST_GeometryType(${geometry}) = '${MULTIPOLYGON_TYPE}', false)`;

export const geometriesEqualSql = (targetGeometry: string, candidateGeometry: string): string =>
  `COALESCE(${targetGeometry} IS NOT NULL AND ST_Normalize(ST_SnapToGrid(ST_Multi(${targetGeometry}), ${SNAP})) = ST_Normalize(ST_SnapToGrid(${candidateGeometry}, ${SNAP})), false)`;

export const hausdorffDistanceSql = (targetGeometry: string, candidateGeometry: string, equal: string): string =>
  `CASE WHEN ${targetGeometry} IS NOT NULL AND NOT ${equal} THEN ST_HausdorffDistance(ST_Multi(${targetGeometry}), ${candidateGeometry}) END`;

export function matchClassSql(tolerance: number, rows: string, equal: string, distance: string): string {
  return [
    "CASE",
    `WHEN ${rows} IS NULL THEN '${MATCH_CLASS.NEW}'`,
    `WHEN ${rows} > 1 THEN '${MATCH_CLASS.AMBIGUOUS}'`,
    `WHEN ${equal} THEN '${MATCH_CLASS.UNCHANGED}'`,
    `WHEN ${distance} <= ${tolerance} THEN '${MATCH_CLASS.WITHIN_TOLERANCE}'`,
    `ELSE '${MATCH_CLASS.CHANGED}' END`,
  ].join(" ");
}

const polygonalOf = (geometry: string): string => `ST_CollectionExtract(ST_MakeValid(${geometry}), 3)`;

export const areaRatioOf = (existing: string, incoming: string): string =>
  [
    `CASE WHEN ${existing} IS NOT NULL THEN`,
    `ST_Area(ST_SymDifference(${polygonalOf(existing)}, ${polygonalOf(incoming)}))`,
    `/ NULLIF(ST_Area(ST_Union(${polygonalOf(existing)}, ${polygonalOf(incoming)})), 0) END`,
  ].join(" ");
