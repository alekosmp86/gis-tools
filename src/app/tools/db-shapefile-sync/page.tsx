"use client";

import { useState } from "react";
import { Eraser, GitCompare, Layers } from "lucide-react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { ShapefileUploader } from "@/components/tools/db-shapefile-sync/ShapefileUploader";
import {
  buildDbConnectionStep,
  buildResultsStep,
  buildSuidMappingStep,
  buildSyncParametersStep,
} from "@/components/tools/db-sync-common/wizardSteps";
import { SyncModeStep } from "@/components/tools/db-sync-common/SyncModeStep";
import { SyncMode } from "@/components/tools/db-sync-common/syncMode";
import { useDbSourceConnection } from "@/components/tools/db-sync-common/useDbSourceConnection";
import { useWizardMappingState } from "@/components/tools/db-sync-common/useWizardMappingState";
import { ShpReplaceRunPanel } from "@/components/tools/db-shapefile-sync/ShpReplaceRunPanel";
import type { ShpRerunRequest } from "@/components/tools/db-shapefile-sync/ShpReplaceFollowUp";
import { useShpReplaceRun } from "@/components/tools/db-shapefile-sync/useShpReplaceRun";
import { useGeometryProcessingOptions } from "@/components/tools/db-sync-common/geometry-processing/useGeometryProcessingOptions";
import { useShpReplaceMapping } from "@/components/tools/db-shapefile-sync/useShpReplaceMapping";
import { buildShpReplaceSteps } from "@/components/tools/db-shapefile-sync/shpReplaceWizardSteps";
import { getShpReplaceUnavailableReason } from "@/components/tools/db-shapefile-sync/shpReplaceAvailability";
import {
  ShpReplaceRunStatus,
  rerun as rerunShpReplace,
  reset as resetShpReplaceRun,
} from "@/core/services/shpReplaceRunStore";
import { detectSridFromPrj } from "@/core/services/shpSrid";
import { ParsedShapefileData } from "@/core/types/shp";
import { WizardStepDef } from "@/ui-kit/types/ui";
import { DB_VS_SHAPEFILE_DESCRIPTOR } from "@/core/constants/comparisonDescriptors";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";

const NO_DBF_FIELDS: string[] = [];

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
  } = useWizardMappingState(1);
  const {
    dbConfig,
    dbColumns,
    columnDetails,
    dbTotalRows,
    uniqueKeys,
    isDbConnected,
    dbFormRef,
    handleDbSuccess,
    handleDbStatusChange,
  } = useDbSourceConnection(() => setCurrentStep(2));

  const [shapefileData, setShapefileData] = useState<ParsedShapefileData | null>(null);
  const [shapefileFile, setShapefileFile] = useState<File | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>(SyncMode.COMPARE);
  const { status: replaceRunStatus, uploadId } = useShpReplaceRun();

  const replaceUnavailableReason = getShpReplaceUnavailableReason(shapefileFile);
  const effectiveMode = replaceUnavailableReason ? SyncMode.COMPARE : syncMode;
  const replaceMapping = useShpReplaceMapping({
    shapefileData,
    targetColumns: dbColumns,
    targetDetails: columnDetails,
  });
  const detectedSrid = detectSridFromPrj(shapefileData?.prjText);

  const dbfFields = shapefileData?.attributes ?? NO_DBF_FIELDS;
  const geometry = useGeometryProcessingOptions({
    target: dbConfig,
    uniqueKeys,
    mapping: replaceMapping.mapping,
    dbfFields,
  });

  const handleShapefileSuccess = (parsedData: ParsedShapefileData, file: File) => {
    resetShpReplaceRun();
    setShapefileData(parsedData);
    setShapefileFile(file);
  };

  const handleShapefileDiscard = () => {
    resetShpReplaceRun();
    setShapefileData(null);
    setShapefileFile(null);
  };

  const handleRerun = (request: ShpRerunRequest) => {
    geometry.onChange(request.processing);
    geometry.prepareRun(request.processing, request.dryRun);
    void rerunShpReplace({ password: request.password, processing: request.processing, dryRun: request.dryRun });
  };

  const handleReconfigure = () => resetShpReplaceRun({ keepUpload: true });

  const modeStep: WizardStepDef = {
    id: 3,
    title: "Modo",
    subtitle: "Comparar o Reemplazar",
    cardTitle: "Modo de Sincronización",
    cardSubtitle:
      "Elija si desea comparar ambas capas por SUID y generar parches, o reemplazar por completo la tabla destino con el Shapefile.",
    icon: effectiveMode === SyncMode.REPLACE ? Eraser : GitCompare,
    content: (
      <SyncModeStep
        mode={effectiveMode}
        onModeChange={setSyncMode}
        replaceDisabledReason={replaceUnavailableReason}
      />
    ),
    canProceed: true,
    nextLabel: effectiveMode === SyncMode.REPLACE ? "Continuar a Mapeo de Columnas" : "Continuar a Mapeo SUID",
    onNext: () => setCurrentStep(4),
    onBack: () => setCurrentStep(2),
    backLabel: "Volver al Paso 2: Capa Espacial",
  };

  const compareSteps: WizardStepDef[] = [
    // react-doctor-disable-next-line react-hooks-js/refs
    {
      ...buildSuidMappingStep({
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
        fileDataset: shapefileData,
        mappingConfig,
        descriptor: DB_VS_SHAPEFILE_DESCRIPTOR,
        cardSubtitleWhenReady:
          dbConfig && shapefileData
            ? `Correlación realizada entre ${dbConfig.schema_name}.${dbConfig.table_name} y ${shapefileData.fileName}.`
            : "",
        onBack: () => setCurrentStep(5),
      }),
      id: 6,
      backLabel: "Volver al Paso 5: Parámetros de Sincronización",
    },
  ];

  const replaceSteps = buildShpReplaceSteps({
    sourceColumns: replaceMapping.sourceColumns,
    sourceDetails: replaceMapping.sourceDetails,
    targetColumns: dbColumns,
    targetDetails: columnDetails,
    mapping: replaceMapping.mapping,
    autoMatches: replaceMapping.autoMatches,
    isMappingValid: replaceMapping.isMappingValid,
    onSourceChange: replaceMapping.setSource,
    onDefaultChange: replaceMapping.setDefault,
    targetConfig: dbConfig,
    targetRowCount: dbTotalRows,
    file: shapefileFile,
    recordCount: shapefileData?.featureCount ?? 0,
    detectedSrid,
    prjText: shapefileData?.prjText,
    fileDate: shapefileData?.modifiedAt ? new Date(shapefileData.modifiedAt) : null,
    dbfFields,
    geometry,
    uploadId,
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
    modeStep,
    ...(effectiveMode === SyncMode.REPLACE ? replaceSteps : compareSteps),
  ];

  return (
    <ToolWorkspaceLayout
      title="Sincronización de Datos DB vs. Shapefile"
      description="Correlacione registros de bases de datos PostgreSQL contra archivos Shapefile (.shp/.zip), analice discrepancias de atributos y geometrías, y genere scripts SQL de actualización para PostGIS."
    >
      {replaceRunStatus === ShpReplaceRunStatus.IDLE ? (
        <WizardOrchestrator steps={steps} currentStep={currentStep} onStepClick={handleStepClick} />
      ) : (
        <ShpReplaceRunPanel
          processing={geometry.analyzedOptions ?? geometry.options}
          onRerun={handleRerun}
          onReconfigure={handleReconfigure}
        />
      )}
    </ToolWorkspaceLayout>
  );
}
