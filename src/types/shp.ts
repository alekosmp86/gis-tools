import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";
import { FileSourceKind } from "./parsers";

export interface ParsedShapefileData {
  kind: typeof FileSourceKind.SHAPEFILE;
  fileName: string;
  fileSize: number;
  featureCount: number;
  geometryType: string;
  attributes: string[];
  crs?: string;
  geojson: FeatureCollection<Geometry, GeoJsonProperties>;
}
