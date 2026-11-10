import type { GeometrySourceKind } from "@/core/services/server/shpReplace/replaceSql";

export interface ReplaceSourceWording {
  readonly missingFields: string;
  readonly geometryName: string;
  readonly noGeometry: string;
}

export interface ReplaceRecordRow {
  readonly rec: number;
  readonly values: Record<string, string | null>;
  readonly geometryJson: string | null;
}

export interface ReplaceRecordSource {
  readonly fieldNames: string[];
  readonly recordCount: number;
  readonly hasGeometry?: boolean;
  readonly geometryFormat?: GeometrySourceKind;
  readonly wording?: ReplaceSourceWording;
  records(): Iterable<ReplaceRecordRow>;
}

const SHAPEFILE_WORDING: ReplaceSourceWording = {
  missingFields: "Campos del DBF",
  geometryName: "SHP",
  noGeometry: "El archivo no tiene geometrías para mapear a la columna geométrica destino.",
};

export const wordingOf = (source: ReplaceRecordSource): ReplaceSourceWording => source.wording ?? SHAPEFILE_WORDING;

export const hasSourceGeometry = (source: ReplaceRecordSource): boolean => source.hasGeometry ?? true;
