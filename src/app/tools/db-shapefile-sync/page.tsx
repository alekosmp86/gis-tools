"use client";

import { useState } from "react";
import { Layers } from "lucide-react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { ShapefileUploader } from "@/components/tools/db-shapefile-sync/ShapefileUploader";
import {
  buildDbConnectionStep,
  buildResultsStep,
  buildSuidMappingStep,
  buildSyncParametersStep,
} from "@/components/tools/db-sync-common/wizardSteps";
import { useDbSourceConnection } from "@/components/tools/db-sync-common/useDbSourceConnection";
import { useWizardMappingState } from "@/components/tools/db-sync-common/useWizardMappingState";
import { ParsedShapefileData } from "@/core/types/shp";
import { WizardStepDef } from "@/ui-kit/types/ui";
import { DB_VS_SHAPEFILE_DESCRIPTOR } from "@/core/constants/comparisonDescriptors";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";

export default function DbShapefileSyncToolPage() {
  const {
    currentStep,
    setCurrentStep,
    mappingConfig,
    isMappingReady,
    setIsMappingReady,
    suidMappingRef,
    syncParametersRef,
    handleMappingSuccess,
    handleSyncParametersSuccess,
    handleStepClick,
  } = useWizardMappingState();
  const { dbConfig, dbColumns, columnDetails, isDbConnected, dbFormRef, handleDbSuccess, handleDbStatusChange } =
    useDbSourceConnection(() => setCurrentStep(2));

  const [shapefileData, setShapefileData] = useState<ParsedShapefileData | null>(null);

  const handleShapefileSuccess = (parsedData: ParsedShapefileData) => {
    setShapefileData(parsedData);
  };

  const handleShapefileDiscard = () => {
    setShapefileData(null);
  };

  const steps: WizardStepDef[] = [
    buildDbConnectionStep({
      formRef: dbFormRef,
      onSuccess: handleDbSuccess,
      onStatusChange: handleDbStatusChange,
      canProceed: isDbConnected,
    }),
    {
      id: 2,
      title: "Capa Espacial",
      subtitle: "Cargar Shapefile (.zip)",
      cardTitle: "Cargar Capa Espacial Shapefile",
      cardSubtitle: "Suba un archivo .zip (que contenga .shp, .dbf, .shx) o .geojson.",
      icon: Layers,
      content: (
        <ShapefileUploader
          onSuccess={handleShapefileSuccess}
          onDiscard={handleShapefileDiscard}
          loadedData={shapefileData}
        />
      ),
      canProceed: Boolean(shapefileData),
      onNext: () => setCurrentStep(3),
      onBack: () => setCurrentStep(1),
    },
    // react-doctor-disable-next-line react-hooks-js/refs
    buildSuidMappingStep({
      ref: suidMappingRef,
      isSourceReady: Boolean(shapefileData),
      dbColumns,
      columnDetails,
      fileAttributes: shapefileData?.attributes || [],
      initialConfig: mappingConfig,
      onReadyChange: setIsMappingReady,
      onSuccess: handleMappingSuccess,
      cardSubtitle:
        "Seleccione una o más columnas como clave SUID única o compuesta, escoja los atributos a comparar y configure la comparación de geometrías.",
      onBack: () => setCurrentStep(2),
      isMappingReady,
    }),
    // react-doctor-disable-next-line react-hooks-js/refs
    buildSyncParametersStep({
      ref: syncParametersRef,
      dbColumns,
      columnDetails,
      initialConfig: mappingConfig,
      onSuccess: handleSyncParametersSuccess,
      onBack: () => setCurrentStep(3),
    }),
    buildResultsStep({
      dbConfig,
      fileDataset: shapefileData,
      mappingConfig,
      descriptor: DB_VS_SHAPEFILE_DESCRIPTOR,
      cardSubtitleWhenReady:
        dbConfig && shapefileData
          ? `Correlación realizada entre ${dbConfig.schema_name}.${dbConfig.table_name} y ${shapefileData.fileName}.`
          : "",
      onBack: () => setCurrentStep(4),
    }),
  ];

  return (
    <ToolWorkspaceLayout
      title="Sincronización de Datos DB vs. Shapefile"
      description="Correlacione registros de bases de datos PostgreSQL contra archivos Shapefile (.shp/.zip), analice discrepancias de atributos y geometrías, y genere scripts SQL de actualización para PostGIS."
    >
      <WizardOrchestrator steps={steps} currentStep={currentStep} onStepClick={handleStepClick} />
    </ToolWorkspaceLayout>
  );
}
