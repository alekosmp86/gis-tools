import React, { useImperativeHandle } from "react";
import { EncodingToleranceCard } from "./EncodingToleranceCard";
import { PkOptimizationCard } from "./PkOptimizationCard";
import { InsertDefaultsCard } from "./InsertDefaultsCard";
import { useSyncParametersForm } from "@/hooks/useSyncParametersForm";
import type { DbColumnMetadata } from "@/core/types/db";
import type { ColumnMappingConfig, SyncParametersStepRef } from "@/core/types/comparison";
import styles from "./SyncParametersStep.module.css";

export interface SyncParametersStepProps {
  dbColumns: string[];
  columnDetails?: DbColumnMetadata[];
  initialConfig?: ColumnMappingConfig | null;
  onSuccess: (finalConfig: ColumnMappingConfig) => void;
}

export const SyncParametersStep = React.forwardRef<
  SyncParametersStepRef,
  SyncParametersStepProps
>(
  (
    {
      dbColumns,
      columnDetails = [],
      initialConfig = null,
      onSuccess,
    },
    ref
  ) => {
    const {
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
    } = useSyncParametersForm({
      dbColumns,
      columnDetails,
      initialConfig,
      onSuccess,
    });

    useImperativeHandle(
      ref,
      () => ({
        proceed: handleProceed,
      }),
      [handleProceed]
    );

    return (
      <div className={styles.container}>
        {/* 1. Encoding Glitch Tolerance Card */}
        <EncodingToleranceCard
          isEnabled={ignoreEncodingArtifacts}
          onToggleEnabled={setIgnoreEncodingArtifacts}
        />

        {/* 2. Primary Key UPDATE Optimization Card */}
        <PkOptimizationCard
          availableColumns={dbColumns}
          detectedPrimaryKey={detectedPrimaryKey}
          selectedPrimaryKey={selectedPkColumn}
          isEnabled={isPkOptimizationEnabled}
          onToggleEnabled={setIsPkOptimizationEnabled}
          onSelectPrimaryKey={setSelectedPkColumn}
        />

        {/* 3. Insert Defaults for Unmapped DB Fields (NOT NULL Handling) */}
        <InsertDefaultsCard
          unmappedColumns={unmappedDbColumns}
          columnDetails={columnDetails}
          defaults={insertDefaults}
          onChangeDefault={handleUpdateInsertDefault}
        />
      </div>
    );
  }
);

SyncParametersStep.displayName = "SyncParametersStep";
