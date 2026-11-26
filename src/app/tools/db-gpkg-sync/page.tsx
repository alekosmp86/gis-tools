"use client";

import { useState } from "react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import { ShpReplaceRunPanel } from "@/components/tools/db-shapefile-sync/ShpReplaceRunPanel";
import { buildDbConnectionStep } from "@/components/tools/db-sync-common/wizardSteps";
import { useDbSourceConnection } from "@/components/tools/db-sync-common/useDbSourceConnection";
import { useFileReplaceMapping } from "@/components/tools/db-sync-common/useFileReplaceMapping";
import { buildGpkgReplaceSteps } from "@/components/tools/db-gpkg-sync/gpkgSyncWizardSteps";
import { useGpkgReplaceRun } from "@/components/tools/db-gpkg-sync/useGpkgReplaceRun";
import { useGpkgSource } from "@/components/tools/db-gpkg-sync/useGpkgSource";
import { reset as resetGpkgRun, start as startGpkgRun } from "@/core/services/gpkgReplaceRunStore";
import { ShpReplaceRunStatus } from "@/core/services/replaceRunTypes";

const GPKG_SOURCE_LABEL = "GeoPackage";
const GPKG_FILE_HAS_GEOMETRY = true;

export default function DbGpkgSyncToolPage() {
  const [currentStep, setCurrentStep] = useState(1);
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
  const source = useGpkgSource();
  const replaceRun = useGpkgReplaceRun();
  const replaceMapping = useFileReplaceMapping({
    attributes: source.fields,
    hasGeometry: GPKG_FILE_HAS_GEOMETRY,
    targetColumns: dbColumns,
    targetDetails: columnDetails,
  });

  const steps = [
    buildDbConnectionStep({
      formRef: dbFormRef,
      onSuccess: handleDbSuccess,
      onStatusChange: handleDbStatusChange,
      canProceed: isDbConnected,
    }),
    ...buildGpkgReplaceSteps({
      source,
      replaceMapping,
      targetConfig: dbConfig,
      targetColumns: dbColumns,
      targetDetails: columnDetails,
      targetRowCount: dbTotalRows,
      startRun: startGpkgRun,
      goToStep: setCurrentStep,
    }),
  ];

  const handleStepClick = (stepId: number) => {
    if (stepId < currentStep) setCurrentStep(stepId);
  };

  const handleNewOperation = () => {
    resetGpkgRun();
    source.discard();
    setCurrentStep(2);
  };

  return (
    <ToolWorkspaceLayout
      title="Carga completa desde GeoPackage"
      description="Reemplace por completo una tabla PostgreSQL/PostGIS con una capa de un archivo GeoPackage (.gpkg). Conecte la base de datos, elija la tabla destino, mapee las columnas y confirme la carga destructiva."
    >
      {replaceRun.status === ShpReplaceRunStatus.IDLE ? (
        <WizardOrchestrator steps={steps} currentStep={currentStep} onStepClick={handleStepClick} />
      ) : (
        <ShpReplaceRunPanel run={replaceRun} onNewOperation={handleNewOperation} sourceLabel={GPKG_SOURCE_LABEL} />
      )}
    </ToolWorkspaceLayout>
  );
}
