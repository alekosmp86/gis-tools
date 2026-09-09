import React, { useImperativeHandle } from "react";
import { SuidSelectorCard } from "./SuidSelectorCard";
import { AttributeFieldsCard } from "./AttributeFieldsCard";
import { GeometryToggleCard } from "../db-shapefile-sync/GeometryToggleCard";
import { useSuidMappingForm } from "@/hooks/useSuidMappingForm";
import type { DbColumnMetadata } from "@/core/types/db";
import type { ColumnMappingConfig, SuidMappingStepRef } from "@/core/types/comparison";
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
      toggleSuidColumn,
      setCompareGeometry,
      toggleField,
      handleMapField,
      selectAllFields,
      clearAllFields,
      handleProceed,
    } = useSuidMappingForm(
      dbColumns,
      fileAttributes,
      onSuccess,
      initialConfig,
      onReadyChange
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

        {/* 3. Geometry Comparison Toggle Card (optional for spatial shapefiles/CSVs) */}
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
