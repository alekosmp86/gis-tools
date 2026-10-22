import type { ReplaceColumnMapping } from "@/core/services/replaceColumnMapping";
import type { DbColumnMetadata } from "@/core/types/db";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";

export const SHP_GEOMETRY_LABEL = "Geometría del archivo";

const SHP_ATTRIBUTE_DATA_TYPE = "text";
const SHP_GEOMETRY_DATA_TYPE = "geometry";
const GEOMETRY_TYPE_TOKENS: readonly string[] = ["geometry", "geography"];

export interface ShpSourceColumns {
  columns: string[];
  details: DbColumnMetadata[];
}

const buildAttributeDetail = (fieldName: string): DbColumnMetadata => ({
  column_name: fieldName,
  data_type: SHP_ATTRIBUTE_DATA_TYPE,
  is_nullable: true,
  column_default: null,
});

const buildGeometryDetail = (): DbColumnMetadata => ({
  column_name: SHP_GEOMETRY_SOURCE,
  data_type: SHP_GEOMETRY_DATA_TYPE,
  is_nullable: true,
  column_default: null,
});

export function buildShapefileSourceColumns(attributes: string[], hasGeometry: boolean): ShpSourceColumns {
  const details = Array.from(new Set(attributes)).map(buildAttributeDetail);
  if (hasGeometry) details.push(buildGeometryDetail());
  return { columns: details.map((detail) => detail.column_name), details };
}

const isGeometryColumn = (detail: DbColumnMetadata): boolean => {
  const dataType = detail.data_type.toLowerCase();
  return GEOMETRY_TYPE_TOKENS.some((token) => dataType.includes(token));
};

export function applyGeometryDefault(
  mapping: ReplaceColumnMapping,
  targetDetails: DbColumnMetadata[],
  hasGeometry: boolean
): ReplaceColumnMapping {
  if (!hasGeometry) return mapping;
  const geometryColumns = targetDetails.filter(isGeometryColumn);
  if (geometryColumns.length !== 1) return mapping;
  const geometryColumn = geometryColumns[0].column_name;
  const currentSource = mapping.sourceByTarget[geometryColumn] ?? null;
  return {
    ...mapping,
    sourceByTarget: { ...mapping.sourceByTarget, [geometryColumn]: currentSource ?? SHP_GEOMETRY_SOURCE },
  };
}
