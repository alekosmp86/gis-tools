import { ProjectionEngine } from "./ProjectionEngine";

const WGS84_SRID = 4326;

export interface FileSridSource {
  shpBuffer?: Uint8Array | null;
  prjText?: string | null;
}

/**
 * SRID of the geometries handed to the SQL builder. Feature-based sources (CSV, GeoJSON) are
 * already reprojected to WGS84 by the parsers; shapefile geometries stay in the .prj SRID.
 */
export function resolveFileSridForSql(source: FileSridSource): number | undefined {
  if (!source.shpBuffer) return WGS84_SRID;
  return source.prjText ? ProjectionEngine.extractEpsg(source.prjText) ?? undefined : undefined;
}
