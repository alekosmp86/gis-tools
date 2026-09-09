import { useState } from "react";
import type { DbColumnMetadata } from "@/core/types/db";
import type { ColumnMappingConfig, InsertFieldDefault } from "@/core/types/comparison";

export interface UseSyncParametersFormProps {
  dbColumns: string[];
  columnDetails?: DbColumnMetadata[];
  initialConfig?: ColumnMappingConfig | null;
  onSuccess: (finalConfig: ColumnMappingConfig) => void;
}

export function useSyncParametersForm({
  dbColumns,
  columnDetails = [],
  initialConfig = null,
  onSuccess,
}: UseSyncParametersFormProps) {
  const detectedPrimaryKey =
    columnDetails.find((detail) => detail.is_primary_key)?.column_name ?? null;

  const [ignoreEncodingArtifacts, setIgnoreEncodingArtifacts] = useState<boolean>(
    () => initialConfig?.ignoreEncodingArtifacts ?? true
  );

  const [isPkOptimizationEnabled, setIsPkOptimizationEnabled] = useState<boolean>(() => {
    if (initialConfig?.primaryKeyColumn !== undefined) {
      return initialConfig.primaryKeyColumn !== null;
    }
    return Boolean(detectedPrimaryKey);
  });

  const [selectedPkColumn, setSelectedPkColumn] = useState<string>(() => {
    return initialConfig?.primaryKeyColumn || detectedPrimaryKey || "";
  });

  const [insertDefaults, setInsertDefaults] = useState<Record<string, InsertFieldDefault>>(
    () => initialConfig?.insertDefaults || {}
  );

  const suidColumns = initialConfig?.suidColumns || [];
  const fieldsToCompare = initialConfig?.fieldsToCompare || [];
  const mappedSet = new Set([...suidColumns, ...fieldsToCompare]);

  const unmappedDbColumns = dbColumns.filter(
    (column) =>
      !mappedSet.has(column) &&
      !["geom", "geometry", "wkb_geometry"].includes(column.toLowerCase())
  );

  const handleUpdateInsertDefault = (
    fieldName: string,
    fieldDefault: InsertFieldDefault
  ) => {
    setInsertDefaults((previous) => ({
      ...previous,
      [fieldName]: fieldDefault,
    }));
  };

  const handleProceed = () => {
    const effectivePk =
      isPkOptimizationEnabled && selectedPkColumn ? selectedPkColumn : null;

    const baseConfig: ColumnMappingConfig = initialConfig ?? {
      suidColumns: [],
      matchedFileSuidColumns: [],
      fieldsToCompare: [],
      compareGeometry: false,
    };

    const finalConfig: ColumnMappingConfig = {
      ...baseConfig,
      primaryKeyColumn: effectivePk,
      insertDefaults,
      ignoreEncodingArtifacts,
    };

    onSuccess(finalConfig);
  };

  return {
    detectedPrimaryKey,
    ignoreEncodingArtifacts,
    setIgnoreEncodingArtifacts,
    isPkOptimizationEnabled,
    setIsPkOptimizationEnabled,
    selectedPkColumn,
    setSelectedPkColumn,
    insertDefaults,
    unmappedDbColumns,
    handleUpdateInsertDefault,
    handleProceed,
  };
}
