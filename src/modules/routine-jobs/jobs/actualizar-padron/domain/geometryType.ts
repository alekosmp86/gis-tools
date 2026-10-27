import { GENERIC_SRID } from "../constants";

export interface GeometryTyping {
  typeName: string | undefined;
  srid: number;
}

const GEOMETRY_TYPE_PATTERN = /^geometry(?:\(\s*([A-Za-z]+)\s*(?:,\s*(\d+)\s*)?\))?$/i;
const DIMENSION_SUFFIX = /(ZM|Z|M)$/i;

export function parseGeometryType(dataType: string): GeometryTyping | undefined {
  const match = GEOMETRY_TYPE_PATTERN.exec(dataType.trim());
  if (!match) return undefined;
  return {
    typeName: match[1]?.replace(DIMENSION_SUFFIX, ""),
    srid: Number(match[2] ?? GENERIC_SRID),
  };
}
