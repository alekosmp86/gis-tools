import { useReplaceColumnMapping } from "@/components/tools/db-sync-common/useReplaceColumnMapping";
import { findMissingRequiredColumns, resolveInsertColumns } from "@/core/services/replaceColumnMapping";
import { applyGeometryDefault, buildShapefileSourceColumns } from "@/core/services/shpReplaceSource";
import type { DbColumnMetadata } from "@/core/types/db";
import type { ParsedShapefileData } from "@/core/types/shp";

export interface UseShpReplaceMappingParams {
  shapefileData: ParsedShapefileData | null;
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
}

export function useShpReplaceMapping({ shapefileData, targetColumns, targetDetails }: UseShpReplaceMappingParams) {
  const hasGeometry = shapefileData !== null;
  const source = buildShapefileSourceColumns(shapefileData?.attributes ?? [], hasGeometry);
  const { mapping: baseMapping, setSource, setDefault } = useReplaceColumnMapping(source.columns, targetColumns);
  const mapping = applyGeometryDefault(baseMapping, targetDetails, hasGeometry);
  const insertColumns = resolveInsertColumns(mapping, targetColumns);
  const isMappingValid =
    insertColumns.length > 0 && findMissingRequiredColumns(insertColumns, targetDetails).length === 0;

  return {
    sourceColumns: source.columns,
    sourceDetails: source.details,
    mapping,
    setSource,
    setDefault,
    isMappingValid,
  };
}
