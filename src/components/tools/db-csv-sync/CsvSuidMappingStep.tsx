import React from "react";
import { GitMerge, ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SuidSelectorCard } from "@/components/tools/db-shapefile-sync/SuidSelectorCard";
import { AttributeFieldsCard } from "@/components/tools/db-shapefile-sync/AttributeFieldsCard";
import { useSuidMappingForm } from "@/hooks/useSuidMappingForm";
import type { SuidMappingStepProps } from "@/types/gis";
import styles from "./CsvSuidMappingStep.module.css";

export const CsvSuidMappingStep: React.FC<SuidMappingStepProps> = ({
  dbColumns,
  shpAttributes,
  onSuccess,
  onBack,
  initialConfig = null,
}) => {
  const {
    selectableColumns,
    selectedSuid,
    matchedShpSuid,
    availableCompareFields,
    selectedFields,
    shpAttrMap,
    setSelectedSuid,
    toggleField,
    selectAllFields,
    clearAllFields,
    handleProceed,
  } = useSuidMappingForm(dbColumns, shpAttributes, onSuccess, initialConfig);

  return (
    <div className={`glass-panel ${styles.container}`}>
      <div className={styles.header}>
        <div className={styles.headerIcon}>
          <GitMerge size={24} />
        </div>
        <div>
          <h2 className={styles.title}>3. Mapeo de SUID y Atributos CSV</h2>
          <p className={styles.subtitle}>
            Seleccione el campo clave identificador (SUID) y los atributos alfanuméricos que desea comparar contra el archivo CSV.
          </p>
        </div>
      </div>

      {/* 1. SUID Selection Card */}
      <SuidSelectorCard
        selectableColumns={selectableColumns}
        selectedSuid={selectedSuid}
        matchedShpSuid={matchedShpSuid}
        onSelectSuid={setSelectedSuid}
      />

      {/* 2. Attributes Selection Card */}
      <AttributeFieldsCard
        availableFields={availableCompareFields}
        selectedFields={selectedFields}
        shpAttrMap={shpAttrMap}
        onToggleField={toggleField}
        onSelectAll={selectAllFields}
        onClearAll={clearAllFields}
      />

      {/* Navigation Actions */}
      <div className={styles.actionsRow}>
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Volver al Paso 2: CSV</span>
        </Button>

        <Button variant="primary" onClick={handleProceed} isDisabled={!selectedSuid}>
          <span>Iniciar Análisis de Discrepancias</span>
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
};
