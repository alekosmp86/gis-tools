import type { FeatureCollection } from "geojson";

export interface ParsedFileDataset {
  fileName: string;
  fileSize: number;
  featureCount: number;
  geometryType?: string;
  attributes: string[];
  recordsMap: Map<string, Record<string, unknown>>;
  geojson?: FeatureCollection;
}

export interface ISpatialFileParser {
  readonly formatName: string;
  readonly supportedExtensions: string[];
  parse(file: File): Promise<ParsedFileDataset>;
}
