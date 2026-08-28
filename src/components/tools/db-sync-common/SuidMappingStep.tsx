import React, { useImperativeHandle, useEffect } from "react";
import { SuidSelectorCard } from "./SuidSelectorCard";
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
  onBack: () => void;
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
      toggleSuidColumn,
      setCompareGeometry,
      toggleField,
      handleMapField,
      selectAllFields,
      clearAllFields,
      handleUpdateInsertDefault,
      handleProceed,
    } = useSuidMappingForm(dbColumns, fileAttributes, onSuccess, initialConfig);

    useImperativeHandle(ref, () => ({
      proceed: handleProceed,
    }), [handleProceed]);

    useEffect(() => {
      onReadyChange?.(selectedSuids.length > 0);
    }, [selectedSuids.length, onReadyChange]);

    return (
      <div className={styles.container}>
        {/* 1. SUID Selection Card (Supports single or multi-column composite keys) */}
        <SuidSelectorCard
          selectableColumns={selectableColumns}
          selectedSuids={selectedSuids}
          matchedFileSuids={matchedFileSuids}
          onToggleSuid={toggleSuidColumn}
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
