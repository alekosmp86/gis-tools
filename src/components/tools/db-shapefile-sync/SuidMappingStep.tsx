import React from "react";
import { GitMerge, ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SuidSelectorCard } from "./SuidSelectorCard";
import { AttributeFieldsCard } from "./AttributeFieldsCard";
import { GeometryToggleCard } from "./GeometryToggleCard";
import { useSuidMappingForm } from "@/hooks/useSuidMappingForm";
import type { SuidMappingStepProps } from "@/types/gis";
import styles from "./SuidMappingStep.module.css";

export const SuidMappingStep: React.FC<SuidMappingStepProps> = ({
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
    compareGeometry,
    shpAttrMap,
    setSelectedSuid,
    setCompareGeometry,
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
          <h2 className={styles.title}>3. Configuración de SUID y Campos a Comparar</h2>
          <p className={styles.subtitle}>
            Seleccione el campo clave identificador (SUID) y los atributos alfanuméricos y geométricos que desea analizar.
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

      {/* 3. Geometry Comparison Toggle Card */}
      <GeometryToggleCard
        compareGeometry={compareGeometry}
        onToggleGeometry={setCompareGeometry}
      />

      {/* Navigation Actions */}
      <div className={styles.actionsRow}>
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Volver al Paso 2: Shapefile</span>
        </Button>

        <Button variant="primary" onClick={handleProceed} isDisabled={!selectedSuid}>
          <span>Iniciar Análisis y Comparación</span>
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
};
