"use client";

import { useState } from "react";
import { Eraser, FileSpreadsheet, GitCompare } from "lucide-react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { CsvUploader } from "@/components/tools/db-csv-sync/CsvUploader";
import { buildCsvReplaceSteps } from "@/components/tools/db-csv-sync/csvReplaceWizardSteps";
import { getCsvReplaceUnavailableReason } from "@/components/tools/db-csv-sync/csvReplaceAvailability";
import { useCsvReplaceRun } from "@/components/tools/db-csv-sync/useCsvReplaceRun";
import { ShpReplaceRunPanel } from "@/components/tools/db-shapefile-sync/ShpReplaceRunPanel";
import {
  buildDbConnectionStep,
  buildResultsStep,
  buildSuidMappingStep,
  buildSyncParametersStep,
} from "@/components/tools/db-sync-common/wizardSteps";
import { SyncModeStep } from "@/components/tools/db-sync-common/SyncModeStep";
import { SyncMode } from "@/components/tools/db-sync-common/syncMode";
import { useDbSourceConnection } from "@/components/tools/db-sync-common/useDbSourceConnection";
import { useFileReplaceMapping } from "@/components/tools/db-sync-common/useFileReplaceMapping";
import { useWizardMappingState } from "@/components/tools/db-sync-common/useWizardMappingState";
import { reset as resetCsvReplaceRun } from "@/core/services/csvReplaceRunStore";
import { hasSpatialColumns } from "@/core/services/parsers/csvDialect";
import { ShpReplaceRunStatus } from "@/core/services/replaceRunTypes";
import { ParsedFileDataset } from "@/core/types/parsers";
import { WizardStepDef } from "@/ui-kit/types/ui";
import { DB_VS_CSV_DESCRIPTOR } from "@/core/constants/comparisonDescriptors";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";

const NO_CSV_COLUMNS: string[] = [];

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
  } = useWizardMappingState(1);
  const {
    dbConfig,
    dbColumns,
    columnDetails,
    dbTotalRows,
    isDbConnected,
    dbFormRef,
    handleDbSuccess,
    handleDbStatusChange,
  } = useDbSourceConnection(() => setCurrentStep(2));

  const [csvDataset, setCsvDataset] = useState<ParsedFileDataset | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>(SyncMode.COMPARE);
  const replaceRun = useCsvReplaceRun();

  const csvColumns = csvDataset?.attributes ?? NO_CSV_COLUMNS;
  const replaceUnavailableReason = getCsvReplaceUnavailableReason(csvFile);
  const effectiveMode = replaceUnavailableReason ? SyncMode.COMPARE : syncMode;
  const replaceMapping = useFileReplaceMapping({
    attributes: csvColumns,
    hasGeometry: hasSpatialColumns(csvColumns),
    targetColumns: dbColumns,
    targetDetails: columnDetails,
  });

  const handleCsvSuccess = (parsedData: ParsedFileDataset, file: File) => {
    resetCsvReplaceRun();
    setCsvDataset(parsedData);
    setCsvFile(file);
  };

  const handleCsvDiscard = () => {
    resetCsvReplaceRun();
    setCsvDataset(null);
    setCsvFile(null);
  };

  const modeStep: WizardStepDef = {
    id: 3,
    title: "Modo",
    subtitle: "Comparar o Reemplazar",
    cardTitle: "Modo de Sincronización",
    cardSubtitle:
      "Elija si desea comparar ambas capas por SUID y generar parches, o reemplazar por completo la tabla destino con el CSV.",
    icon: effectiveMode === SyncMode.REPLACE ? Eraser : GitCompare,
    content: (
      <SyncModeStep mode={effectiveMode} onModeChange={setSyncMode} replaceDisabledReason={replaceUnavailableReason} />
    ),
    canProceed: true,
    nextLabel: effectiveMode === SyncMode.REPLACE ? "Continuar a Mapeo de Columnas" : "Continuar a Mapeo SUID",
    onNext: () => setCurrentStep(4),
    onBack: () => setCurrentStep(2),
    backLabel: "Volver al Paso 2: Capa Tabular",
  };

  const compareSteps: WizardStepDef[] = [
    {
      // react-doctor-disable-next-line react-hooks-js/refs
      ...buildSuidMappingStep({
        ref: suidMappingRef,
        isSourceReady: Boolean(csvDataset),
        dbColumns,
        columnDetails,
        fileAttributes: csvColumns,
        initialConfig: mappingConfig,
        showGeometryToggle: true,
        onReadyChange: setIsMappingReady,
        onSuccess: handleMappingSuccess,
        cardSubtitle:
          "Seleccione una o más columnas como clave SUID única o compuesta, escoja los atributos a comparar y configure la comparación de geometrías.",
        onBack: () => setCurrentStep(3),
        isMappingReady,
      }),
      id: 4,
      backLabel: "Volver al Paso 3: Modo",
    },
    {
      // react-doctor-disable-next-line react-hooks-js/refs
      ...buildSyncParametersStep({
        ref: syncParametersRef,
        dbColumns,
        columnDetails,
        initialConfig: mappingConfig,
        onSuccess: handleSyncParametersSuccess,
        onBack: () => setCurrentStep(4),
      }),
      id: 5,
      backLabel: "Volver al Paso 4: Mapeo SUID",
    },
    {
      ...buildResultsStep({
        dbConfig,
        fileDataset: csvDataset,
        mappingConfig,
        descriptor: DB_VS_CSV_DESCRIPTOR,
        cardSubtitleWhenReady:
          dbConfig && csvDataset
            ? `Correlación realizada entre ${dbConfig.schema_name}.${dbConfig.table_name} y ${csvDataset.fileName}.`
            : "",
        onBack: () => setCurrentStep(5),
      }),
      id: 6,
      backLabel: "Volver al Paso 5: Parámetros de Sincronización",
    },
  ];

  const replaceSteps = buildCsvReplaceSteps({
    replaceMapping,
    targetColumns: dbColumns,
    targetDetails: columnDetails,
    targetConfig: dbConfig,
    targetRowCount: dbTotalRows,
    file: csvFile,
    recordCount: csvDataset?.featureCount ?? 0,
    uploadId: replaceRun.uploadId,
    goToStep: setCurrentStep,
  });

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
      content: <CsvUploader onSuccess={handleCsvSuccess} onDiscard={handleCsvDiscard} loadedData={csvDataset} />,
      canProceed: Boolean(csvDataset),
      onNext: () => setCurrentStep(3),
      onBack: () => setCurrentStep(1),
    },
    modeStep,
    ...(effectiveMode === SyncMode.REPLACE ? replaceSteps : compareSteps),
  ];

  return (
    <ToolWorkspaceLayout
      title="Sincronización de Datos DB vs. Archivo CSV"
      description="Compare registros de PostgreSQL contra archivos CSV con geometrías o coordenadas espaciales, detecte discrepancias y genere parches SQL de sincronización para PostGIS, o reemplace por completo una tabla destino con el contenido del CSV."
    >
      {replaceRun.status === ShpReplaceRunStatus.IDLE ? (
        <WizardOrchestrator steps={steps} currentStep={currentStep} onStepClick={handleStepClick} />
      ) : (
        <ShpReplaceRunPanel run={replaceRun} onNewOperation={() => resetCsvReplaceRun()} sourceLabel="CSV" />
      )}
    </ToolWorkspaceLayout>
  );
}
