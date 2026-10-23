import { useReplaceColumnMapping } from "@/components/tools/db-sync-common/useReplaceColumnMapping";
import { findMissingRequiredColumns, resolveInsertColumns } from "@/core/services/replaceColumnMapping";
import { applyGeometryDefault, buildShapefileSourceColumns } from "@/core/services/shpReplaceSource";
import type { DbColumnMetadata } from "@/core/types/db";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";
import type { ParsedShapefileData } from "@/core/types/shp";

export interface UseShpReplaceMappingParams {
  shapefileData: ParsedShapefileData | null;
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
}

const SHP_REPLACE_MAPPING_OPTIONS = { smart: true, excludeSources: [SHP_GEOMETRY_SOURCE] };

export function useShpReplaceMapping({ shapefileData, targetColumns, targetDetails }: UseShpReplaceMappingParams) {
  const hasGeometry = shapefileData !== null;
  const source = buildShapefileSourceColumns(shapefileData?.attributes ?? [], hasGeometry);
  const {
    mapping: baseMapping,
    autoMatches,
    setSource,
    setDefault,
  } = useReplaceColumnMapping(source.columns, targetColumns, SHP_REPLACE_MAPPING_OPTIONS);
  const mapping = applyGeometryDefault(baseMapping, targetDetails, hasGeometry);
  const insertColumns = resolveInsertColumns(mapping, targetColumns);
  const isMappingValid =
    insertColumns.length > 0 && findMissingRequiredColumns(insertColumns, targetDetails).length === 0;

  return {
    sourceColumns: source.columns,
    sourceDetails: source.details,
    mapping,
    autoMatches,
    setSource,
    setDefault,
    isMappingValid,
  };
}
