"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { CsvUploader } from "@/components/tools/db-csv-sync/CsvUploader";
import {
  buildDbConnectionStep,
  buildResultsStep,
  buildSuidMappingStep,
  buildSyncParametersStep,
} from "@/components/tools/db-sync-common/wizardSteps";
import { useDbSourceConnection } from "@/components/tools/db-sync-common/useDbSourceConnection";
import { useWizardMappingState } from "@/components/tools/db-sync-common/useWizardMappingState";
import { ParsedFileDataset } from "@/core/types/parsers";
import { WizardStepDef } from "@/ui-kit/types/ui";
import { DB_VS_CSV_DESCRIPTOR } from "@/core/constants/comparisonDescriptors";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";

export default function DbCsvSyncToolPage() {
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

  const [csvDataset, setCsvDataset] = useState<ParsedFileDataset | null>(null);

  const handleCsvSuccess = (parsedData: ParsedFileDataset) => {
    setCsvDataset(parsedData);
  };

  const handleCsvDiscard = () => {
    setCsvDataset(null);
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
      title: "Capa Tabular",
      subtitle: "Cargar Archivo CSV",
      cardTitle: "Cargar Archivo de Datos CSV",
      cardSubtitle: "Suba un archivo CSV con coordenadas espaciales o información tabular para comparar.",
      icon: FileSpreadsheet,
      content: (
        <CsvUploader
          onSuccess={handleCsvSuccess}
          onDiscard={handleCsvDiscard}
          loadedData={csvDataset}
        />
      ),
      canProceed: Boolean(csvDataset),
      onNext: () => setCurrentStep(3),
      onBack: () => setCurrentStep(1),
    },
    // react-doctor-disable-next-line react-hooks-js/refs
    buildSuidMappingStep({
      ref: suidMappingRef,
      isSourceReady: Boolean(csvDataset),
      dbColumns,
      columnDetails,
      fileAttributes: csvDataset?.attributes || [],
      initialConfig: mappingConfig,
      showGeometryToggle: true,
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
      fileDataset: csvDataset,
      mappingConfig,
      descriptor: DB_VS_CSV_DESCRIPTOR,
      cardSubtitleWhenReady:
        dbConfig && csvDataset
          ? `Correlación realizada entre ${dbConfig.schema_name}.${dbConfig.table_name} y ${csvDataset.fileName}.`
          : "",
      onBack: () => setCurrentStep(4),
    }),
  ];

  return (
    <ToolWorkspaceLayout
      title="Sincronización de Datos DB vs. Archivo CSV"
      description="Compare registros de PostgreSQL contra archivos CSV con geometrías o coordenadas espaciales, detecte discrepancias y genere parches SQL de sincronización para PostGIS."
    >
      <WizardOrchestrator steps={steps} currentStep={currentStep} onStepClick={handleStepClick} />
    </ToolWorkspaceLayout>
  );
}
