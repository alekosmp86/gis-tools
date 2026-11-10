import { useFileReplaceMapping } from "@/components/tools/db-sync-common/useFileReplaceMapping";
import type { DbColumnMetadata } from "@/core/types/db";
import type { ParsedShapefileData } from "@/core/types/shp";

export interface UseShpReplaceMappingParams {
  shapefileData: ParsedShapefileData | null;
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
}

const NO_ATTRIBUTES: string[] = [];

export function useShpReplaceMapping({ shapefileData, targetColumns, targetDetails }: UseShpReplaceMappingParams) {
  return useFileReplaceMapping({
    attributes: shapefileData?.attributes ?? NO_ATTRIBUTES,
    hasGeometry: shapefileData !== null,
    targetColumns,
    targetDetails,
  });
}
