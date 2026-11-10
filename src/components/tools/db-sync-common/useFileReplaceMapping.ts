import { useReplaceColumnMapping } from "@/components/tools/db-sync-common/useReplaceColumnMapping";
import { findMissingRequiredColumns, resolveInsertColumns } from "@/core/services/replaceColumnMapping";
import { applyGeometryDefault, buildShapefileSourceColumns } from "@/core/services/shpReplaceSource";
import type { DbColumnMetadata } from "@/core/types/db";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";

export interface UseFileReplaceMappingParams {
  attributes: string[];
  hasGeometry: boolean;
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
}

const FILE_REPLACE_MAPPING_OPTIONS = { smart: true, excludeSources: [SHP_GEOMETRY_SOURCE] };

export function useFileReplaceMapping({
  attributes,
  hasGeometry,
  targetColumns,
  targetDetails,
}: UseFileReplaceMappingParams) {
  const source = buildShapefileSourceColumns(attributes, hasGeometry);
  const {
    mapping: baseMapping,
    autoMatches,
    setSource,
    setDefault,
  } = useReplaceColumnMapping(source.columns, targetColumns, FILE_REPLACE_MAPPING_OPTIONS);
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

export type FileReplaceMapping = ReturnType<typeof useFileReplaceMapping>;
