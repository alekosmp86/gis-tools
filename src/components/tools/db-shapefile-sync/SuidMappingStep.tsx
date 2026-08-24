import React from "react";
import { GitMerge, ArrowRight, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { SuidSelectorCard } from "./SuidSelectorCard";
import { AttributeFieldsCard } from "./AttributeFieldsCard";
import { GeometryToggleCard } from "./GeometryToggleCard";
import { InsertDefaultsCard } from "./InsertDefaultsCard";
import { useSuidMappingForm } from "@/hooks/useSuidMappingForm";
import type { SuidMappingStepProps } from "@/types/gis";
import styles from "./SuidMappingStep.module.css";

export const SuidMappingStep: React.FC<SuidMappingStepProps> = ({
  dbColumns,
  columnDetails,
  shpAttributes,
  onSuccess,
  onBack,
  initialConfig = null,
}) => {
  const {
    selectableColumns,
    selectedSuids,
    matchedShpSuids,
    availableCompareFields,
    selectedFields,
    compareGeometry,
    unmappedDbColumns,
    insertDefaults,
    shpAttrMap,
    toggleSuidColumn,
    setCompareGeometry,
    toggleField,
    selectAllFields,
    clearAllFields,
    handleUpdateInsertDefault,
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
            Seleccione una o más columnas como clave SUID única o compuesta, escoja los atributos a comparar y configure valores por defecto.
          </p>
        </div>
      </div>

      {/* 1. SUID Selection Card (Supports single or multi-column composite keys) */}
      <SuidSelectorCard
        selectableColumns={selectableColumns}
        selectedSuids={selectedSuids}
        matchedShpSuids={matchedShpSuids}
        onToggleSuid={toggleSuidColumn}
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

      {/* 3. Insert Defaults for Unmapped DB Fields (NOT NULL Handling) */}
      <InsertDefaultsCard
        unmappedColumns={unmappedDbColumns}
        columnDetails={columnDetails}
        defaults={insertDefaults}
        onChangeDefault={handleUpdateInsertDefault}
      />

      {/* 4. Geometry Comparison Toggle Card */}
      <GeometryToggleCard
        compareGeometry={compareGeometry}
        onToggleGeometry={setCompareGeometry}
      />

      {/* Navigation Actions */}
      <div className={styles.actionsRow}>
        <Button variant="secondary" onClick={onBack}>
          <ArrowLeft size={16} />
          <span>Volver al Paso 2: Archivo Fuente</span>
        </Button>

        <Button variant="primary" onClick={handleProceed} isDisabled={selectedSuids.length === 0}>
          <span>Iniciar Análisis y Comparación</span>
          <ArrowRight size={16} />
        </Button>
      </div>
    </div>
  );
};
