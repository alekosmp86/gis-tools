"use client";

import { useState, useRef } from "react";
import { Database } from "lucide-react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";
import { DbConnectionForm } from "@/ui-kit/components/DbConnectionForm";
import {
  buildResultsStep,
  buildSuidMappingStep,
  buildSyncParametersStep,
} from "@/components/tools/db-sync-common/wizardSteps";
import { DB_VS_DB_DESCRIPTOR } from "@/core/constants/comparisonDescriptors";
import type { DbConfig, DbColumnMetadata, DbConnectionFormRef } from "@/core/types/db";
import { FileSourceKind, type ParsedFileDataset } from "@/core/types/parsers";
import type { ColumnMappingConfig, SuidMappingStepRef, SyncParametersStepRef } from "@/core/types/comparison";
import type { WizardStepDef } from "@/ui-kit/types/ui";

export default function DbDbSyncToolPage() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [dbConfig1, setDbConfig1] = useState<DbConfig | null>(null);
  const [dbColumns1, setDbColumns1] = useState<string[]>([]);
  const [isDb1Connected, setIsDb1Connected] = useState(false);

  const [dbConfig2, setDbConfig2] = useState<DbConfig | null>(null);
  const [dbColumns2, setDbColumns2] = useState<string[]>([]);
  const [columnDetails2, setColumnDetails2] = useState<DbColumnMetadata[]>([]);
  const [isDb2Connected, setIsDb2Connected] = useState(false);

  const [mappingConfig, setMappingConfig] = useState<ColumnMappingConfig | null>(null);
  const [isMappingReady, setIsMappingReady] = useState(true);

  const db1FormRef = useRef<DbConnectionFormRef | null>(null);
  const db2FormRef = useRef<DbConnectionFormRef | null>(null);
  const suidMappingRef = useRef<SuidMappingStepRef | null>(null);
  const syncParametersRef = useRef<SyncParametersStepRef | null>(null);

  const handleDb1Success = (
    config: DbConfig,
    columns: string[]
  ) => {
    setDbConfig1(config);
    setDbColumns1(columns);
    setCurrentStep(2);
  };

  const handleDb2Success = (
    config: DbConfig,
    columns: string[],
    _totalRows: number,
    details?: DbColumnMetadata[]
  ) => {
    setDbConfig2(config);
    setDbColumns2(columns);
    setColumnDetails2(details || []);
    setCurrentStep(3);
  };

  const handleMappingSuccess = (config: ColumnMappingConfig) => {
    setMappingConfig((previous) => ({
      ...previous,
      ...config,
    }));
    setCurrentStep(4);
  };

  const handleSyncParametersSuccess = (finalConfig: ColumnMappingConfig) => {
    setMappingConfig(finalConfig);
    setCurrentStep(5);
  };

  const handleStepClick = (stepId: number) => {
    if (stepId < currentStep) {
      setCurrentStep(stepId);
    }
  };

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
          onStatusChange={(status) => setIsDb1Connected(status.isConnected && status.columns.length > 0)}
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
          onStatusChange={(status) => setIsDb2Connected(status.isConnected && status.columns.length > 0)}
        />
      ),
      canProceed: isDb2Connected,
      onNext: () => db2FormRef.current?.proceed(),
      onBack: () => setCurrentStep(1),
    },
    // react-doctor-disable-next-line react-hooks-js/refs
    // eslint-disable-next-line react-hooks/refs
    buildSuidMappingStep({
      ref: suidMappingRef,
      isSourceReady: dbColumns1.length > 0,
      dbColumns: dbColumns2,
      columnDetails: columnDetails2,
      fileAttributes: dbColumns1,
      initialConfig: mappingConfig,
      showGeometryToggle: false,
      onReadyChange: setIsMappingReady,
      onSuccess: handleMappingSuccess,
      cardSubtitle:
        "Seleccione una o más columnas como clave SUID única o compuesta y configure atributos a comparar entre ambas tablas.",
      onBack: () => setCurrentStep(2),
      isMappingReady,
    }),
    // react-doctor-disable-next-line react-hooks-js/refs
    // eslint-disable-next-line react-hooks/refs
    buildSyncParametersStep({
      ref: syncParametersRef,
      dbColumns: dbColumns2,
      columnDetails: columnDetails2,
      initialConfig: mappingConfig,
      onSuccess: handleSyncParametersSuccess,
      onBack: () => setCurrentStep(3),
    }),
    buildResultsStep({
      dbConfig: dbConfig2,
      fileDataset: sourceDataset,
      mappingConfig,
      sourceDbConfig: dbConfig1 || undefined,
      descriptor: DB_VS_DB_DESCRIPTOR,
      cardSubtitleWhenReady:
        dbConfig1 && dbConfig2
          ? `Correlación realizada entre DB 1 (${dbConfig1.db_name}.${dbConfig1.table_name}) y DB 2 (${dbConfig2.db_name}.${dbConfig2.table_name}).`
          : "",
      onBack: () => setCurrentStep(4),
    }),
  ];

  return (
    <ToolWorkspaceLayout
      title="Sincronización de Datos DB vs. DB (Réplicas)"
      description="Correlacione registros entre dos tablas de bases de datos PostgreSQL/PostGIS (incluso en distintas bases de datos o esquemas), identifique discrepancias alfanuméricas y aplique parches SQL de actualización e inserción."
    >
      <WizardOrchestrator
        steps={steps}
        currentStep={currentStep}
        onStepClick={handleStepClick}
      />
    </ToolWorkspaceLayout>
  );
}
