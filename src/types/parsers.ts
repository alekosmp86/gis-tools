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
  /** Raw binary DBF buffer for zero-copy worker transfer */
  dbfBuffer?: Uint8Array;
  /** Raw binary SHP buffer for lazy geometry decoding */
  shpBuffer?: Uint8Array;
  /** Coordinate projection PRJ text */
  prjText?: string;
  /** Character encoding CPG text */
  cpgText?: string;
  /** Flag indicating dataset has >50k records and uses memory-optimized columnar storage */
  isLargeDataset?: boolean;
}

export interface ISpatialFileParser {
  readonly formatName: string;
  readonly supportedExtensions: string[];
  parse(file: File): Promise<ParsedFileDataset>;
}


