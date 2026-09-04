import React, { useImperativeHandle } from "react";
import { SuidSelectorCard } from "./SuidSelectorCard";
import { PkOptimizationCard } from "./PkOptimizationCard";
import { AttributeFieldsCard } from "./AttributeFieldsCard";
import { GeometryToggleCard } from "../db-shapefile-sync/GeometryToggleCard";
import { InsertDefaultsCard } from "./InsertDefaultsCard";
import { useSuidMappingForm } from "@/hooks/useSuidMappingForm";
import type { DbColumnMetadata } from "@/types/db";
import type { ColumnMappingConfig, SuidMappingStepRef } from "@/types/comparison";
import styles from "./SuidMappingStep.module.css";

export interface SuidMappingStepProps {
  dbColumns: string[];
  columnDetails?: DbColumnMetadata[];
  fileAttributes: string[];
  onSuccess: (mappingConfig: ColumnMappingConfig) => void;
  initialConfig?: ColumnMappingConfig | null;
  showGeometryToggle?: boolean;
  onReadyChange?: (ready: boolean) => void;
}

export const SuidMappingStep = React.forwardRef<SuidMappingStepRef, SuidMappingStepProps>(
  (
    {
      dbColumns,
      columnDetails,
      fileAttributes,
      onSuccess,
      initialConfig = null,
      showGeometryToggle = true,
      onReadyChange,
    },
    ref
  ) => {
    const detectedPk =
      columnDetails?.find((detail) => detail.is_primary_key)?.column_name ?? null;

    const {
      selectableColumns,
      selectedSuids,
      matchedFileSuids,
      availableCompareFields,
      selectedFields,
      attributeMap,
      compareGeometry,
      unmappedDbColumns,
      insertDefaults,
      isPkOptimizationEnabled,
      setIsPkOptimizationEnabled,
      selectedPkColumn,
      setSelectedPkColumn,
      toggleSuidColumn,
      setCompareGeometry,
      toggleField,
      handleMapField,
      selectAllFields,
      clearAllFields,
      handleUpdateInsertDefault,
      handleProceed,
    } = useSuidMappingForm(
      dbColumns,
      fileAttributes,
      onSuccess,
      initialConfig,
      onReadyChange,
      detectedPk
    );

    useImperativeHandle(ref, () => ({
      proceed: handleProceed,
    }), [handleProceed]);

    return (
      <div className={styles.container}>
        {/* 1. SUID Selection Card (Supports single or multi-column composite keys) */}
        <SuidSelectorCard
          selectableColumns={selectableColumns}
          selectedSuids={selectedSuids}
          matchedFileSuids={matchedFileSuids}
          onToggleSuid={toggleSuidColumn}
        />

        {/* 1.1. Primary Key UPDATE Optimization Card */}
        <PkOptimizationCard
          availableColumns={dbColumns}
          detectedPrimaryKey={detectedPk}
          selectedPrimaryKey={selectedPkColumn}
          isEnabled={isPkOptimizationEnabled}
          onToggleEnabled={setIsPkOptimizationEnabled}
          onSelectPrimaryKey={setSelectedPkColumn}
        />

        {/* 2. Attributes Selection & 1-to-1 Mapping Card */}
        <AttributeFieldsCard
          availableFields={availableCompareFields}
          selectedFields={selectedFields}
          attributeMap={attributeMap}
          fileAttributes={fileAttributes}
          onToggleField={toggleField}
          onMapField={handleMapField}
          onSelectAll={selectAllFields}
          onClearAll={clearAllFields}
        />

        {/* 3. Insert Defaults for Unmapped DB Fields (NOT NULL Handling) */}
        <InsertDefaultsCard
          unmappedColumns={unmappedDbColumns}
          columnDetails={columnDetails}
          defaults={insertDefaults}
          onChangeDefault={handleUpdateInsertDefault}
        />

        {/* 4. Geometry Comparison Toggle Card (optional for spatial shapefiles) */}
        {showGeometryToggle && (
          <GeometryToggleCard
            compareGeometry={compareGeometry}
            onToggleGeometry={setCompareGeometry}
          />
        )}
      </div>
    );
  }
);

SuidMappingStep.displayName = "SuidMappingStep";
