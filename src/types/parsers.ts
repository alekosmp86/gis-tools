import type { FeatureCollection } from "geojson";

export const FileSourceKind = {
  SHAPEFILE: "shapefile",
  CSV: "csv",
} as const;

export type FileSourceKind = (typeof FileSourceKind)[keyof typeof FileSourceKind];

export interface ParsedFileDataset {
  kind: FileSourceKind;
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

