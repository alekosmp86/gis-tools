"use client";

import { useState } from "react";
import { Columns3, Database, Eraser, GitCompare } from "lucide-react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import { DbConnectionForm } from "@/ui-kit/components/DbConnectionForm";
import {
  buildResultsStep,
  buildSuidMappingStep,
  buildSyncParametersStep,
} from "@/components/tools/db-sync-common/wizardSteps";
import { SyncModeStep } from "@/components/tools/db-sync-common/SyncModeStep";
import { SyncMode } from "@/components/tools/db-sync-common/syncMode";
import { ColumnMappingStep } from "@/components/tools/db-sync-common/ColumnMappingStep";
import { FullReplaceRunPanel } from "@/components/tools/db-sync-common/FullReplaceRunPanel";
import { useFullReplaceRun } from "@/components/tools/db-sync-common/useFullReplaceRun";
import { FullReplaceRunStatus } from "@/core/services/fullReplaceRunStore";
import { FullReplaceStep } from "@/components/tools/db-sync-common/FullReplaceStep";
import { useReplaceColumnMapping } from "@/components/tools/db-sync-common/useReplaceColumnMapping";
import { findMissingRequiredColumns, resolveInsertColumns } from "@/core/services/replaceColumnMapping";
import { useDbSourceConnection } from "@/components/tools/db-sync-common/useDbSourceConnection";
import { useWizardMappingState } from "@/components/tools/db-sync-common/useWizardMappingState";
import { DB_VS_DB_DESCRIPTOR } from "@/core/constants/comparisonDescriptors";
import { FileSourceKind, type ParsedFileDataset } from "@/core/types/parsers";
import type { WizardStepDef } from "@/ui-kit/types/ui";

export default function DbDbSyncToolPage() {
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
    dbConfig: dbConfig1,
    dbColumns: dbColumns1,
    columnDetails: columnDetails1,
    isDbConnected: isDb1Connected,
    dbFormRef: db1FormRef,
    handleDbSuccess: handleDb1Success,
    handleDbStatusChange: handleDb1StatusChange,
  } = useDbSourceConnection(() => setCurrentStep(2));
  const {
    dbConfig: dbConfig2,
    dbColumns: dbColumns2,
    columnDetails: columnDetails2,
    isDbConnected: isDb2Connected,
    dbFormRef: db2FormRef,
    handleDbSuccess: handleDb2Success,
    handleDbStatusChange: handleDb2StatusChange,
  } = useDbSourceConnection(() => setCurrentStep(3));

  const { status: replaceRunStatus } = useFullReplaceRun();
  const [syncMode, setSyncMode] = useState<SyncMode>(SyncMode.COMPARE);
  const { mapping: replaceMapping, setSource, setDefault } = useReplaceColumnMapping(dbColumns1, dbColumns2);
  const replaceInsertColumns = resolveInsertColumns(replaceMapping, dbColumns2);
  const isReplaceMappingValid =
    replaceInsertColumns.length > 0 && findMissingRequiredColumns(replaceInsertColumns, columnDetails2).length === 0;

  // Build a ParsedFileDataset wrapper for DB 1 to pass seamlessly into ComparisonResultsView & worker
  const sourceDataset: ParsedFileDataset | null = dbConfig1
    ? {
        kind: FileSourceKind.CSV,
        fileName: `${dbConfig1.db_name}.${dbConfig1.schema_name}.${dbConfig1.table_name}`,
        fileSize: 0, // In-memory database recordset
        featureCount: 0,
        attributes: dbColumns1,
        recordsMap: new Map(),
      }
    : null;

  const steps: WizardStepDef[] = [
    {
      id: 1,
      title: "DB Origen",
      subtitle: "Tabla Primaria (DB 1)",
      cardTitle: "Configurar Base de Datos Origen (DB 1)",
      cardSubtitle: "Ingrese las credenciales para conectar a la tabla de base de datos origen / referencia.",
      icon: Database,
      content: (
        <DbConnectionForm
          key="db1-form"
          ref={db1FormRef}
          onSuccess={handleDb1Success}
          onStatusChange={handleDb1StatusChange}
        />
      ),
      canProceed: isDb1Connected,
      onNext: () => db1FormRef.current?.proceed(),
    },
    {
      id: 2,
      title: "DB Destino",
      subtitle: "Tabla Réplica (DB 2)",
      cardTitle: "Configurar Base de Datos Destino (DB 2)",
      cardSubtitle: "Ingrese las credenciales para conectar a la tabla de base de datos destino / réplica.",
      icon: Database,
      content: (
        <DbConnectionForm
          key="db2-form"
          ref={db2FormRef}
          onSuccess={handleDb2Success}
          onStatusChange={handleDb2StatusChange}
        />
      ),
      canProceed: isDb2Connected,
      onNext: () => db2FormRef.current?.proceed(),
      onBack: () => setCurrentStep(1),
    },
    {
      id: 3,
      title: "Modo",
      subtitle: "Comparar o Reemplazar",
      cardTitle: "Modo de Sincronización",
      cardSubtitle: "Elija si desea comparar ambas tablas y generar parches, o reemplazar por completo la tabla destino.",
      icon: syncMode === SyncMode.REPLACE ? Eraser : GitCompare,
      content: <SyncModeStep mode={syncMode} onModeChange={setSyncMode} />,
      canProceed: true,
      nextLabel:
        syncMode === SyncMode.REPLACE ? "Continuar a Mapeo de Columnas" : "Continuar a Mapeo SUID",
      onNext: () => setCurrentStep(4),
      onBack: () => setCurrentStep(2),
      backLabel: "Volver al Paso 2: DB Destino",
    },
    ...(syncMode === SyncMode.COMPARE
      ? [
          {
            // react-doctor-disable-next-line react-hooks-js/refs
            ...buildSuidMappingStep({
              ref: suidMappingRef,
              isSourceReady: dbColumns1.length > 0,
              dbColumns: dbColumns2,
              columnDetails: columnDetails2,
              fileAttributes: dbColumns1,
              initialConfig: mappingConfig,
              showGeometryToggle: false,
              showPlaceholderOption: false,
              onReadyChange: setIsMappingReady,
              onSuccess: handleMappingSuccess,
              cardSubtitle:
                "Seleccione una o más columnas como clave SUID única o compuesta y configure atributos a comparar entre ambas tablas.",
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
              dbColumns: dbColumns2,
              columnDetails: columnDetails2,
              initialConfig: mappingConfig,
              onSuccess: handleSyncParametersSuccess,
              onBack: () => setCurrentStep(4),
            }),
            id: 5,
            backLabel: "Volver al Paso 4: Mapeo SUID",
          },
          {
            ...buildResultsStep({
              dbConfig: dbConfig2,
              fileDataset: sourceDataset,
              mappingConfig,
              sourceDbConfig: dbConfig1 || undefined,
              descriptor: DB_VS_DB_DESCRIPTOR,
              cardSubtitleWhenReady:
                dbConfig1 && dbConfig2
                  ? `Correlación realizada entre DB 1 (${dbConfig1.db_name}.${dbConfig1.table_name}) y DB 2 (${dbConfig2.db_name}.${dbConfig2.table_name}).`
                  : "",
              onBack: () => setCurrentStep(5),
            }),
            id: 6,
            backLabel: "Volver al Paso 5: Parámetros de Sincronización",
          },
        ]
      : [
          {
            id: 4,
            title: "Mapeo de Columnas",
            subtitle: "Origen a Destino",
            cardTitle: "Mapeo de Columnas Origen a Destino",
            cardSubtitle:
              "Para cada columna de la tabla destino elija la columna de la tabla origen que la alimenta, o no la mapee.",
            icon: Columns3,
            content: (
              <ColumnMappingStep
                sourceColumns={dbColumns1}
                sourceDetails={columnDetails1}
                targetColumns={dbColumns2}
                targetDetails={columnDetails2}
                mapping={replaceMapping}
                onSourceChange={setSource}
                onDefaultChange={setDefault}
              />
            ),
            canProceed: isReplaceMappingValid,
            nextLabel: "Continuar a Reemplazo Completo",
            onNext: () => setCurrentStep(5),
            onBack: () => setCurrentStep(3),
            backLabel: "Volver al Paso 3: Modo",
          },
          {
            id: 5,
            title: "Reemplazo Completo",
            subtitle: "Vaciar y Recargar",
            cardTitle: "Reemplazo Completo de la Tabla Destino",
            cardSubtitle: "Vacíe la tabla destino y recárguela con los registros de la tabla origen según el mapeo.",
            icon: Eraser,
            content: (
              <FullReplaceStep
                sourceConfig={dbConfig1}
                targetConfig={dbConfig2}
                sourceColumns={dbColumns1}
                targetColumns={dbColumns2}
                targetDetails={columnDetails2}
                mapping={replaceMapping}
              />
            ),
            onBack: () => setCurrentStep(4),
            backLabel: "Volver al Paso 4: Mapeo de Columnas",
          },
        ]),
  ];

  return (
    <ToolWorkspaceLayout
      title="Sincronización de Datos DB vs. DB (Réplicas)"
      description="Correlacione registros entre dos tablas de bases de datos PostgreSQL/PostGIS (incluso en distintas bases de datos o esquemas), identifique discrepancias alfanuméricas y aplique parches SQL de actualización e inserción."
    >
      {replaceRunStatus === FullReplaceRunStatus.IDLE ? (
        <WizardOrchestrator steps={steps} currentStep={currentStep} onStepClick={handleStepClick} />
      ) : (
        <FullReplaceRunPanel />
      )}
    </ToolWorkspaceLayout>
  );
}
