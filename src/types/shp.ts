import type { FeatureCollection, Geometry, GeoJsonProperties } from "geojson";

export interface ParsedShapefileData {
  fileName: string;
  fileSize: number;
  featureCount: number;
  geometryType: string;
  attributes: string[];
  crs?: string;
  geojson: FeatureCollection<Geometry, GeoJsonProperties>;
}

export interface ShapefileUploaderProps {
  onSuccess: (data: ParsedShapefileData) => void;
  onDiscard: () => void;
  loadedData?: ParsedShapefileData | null;
}
