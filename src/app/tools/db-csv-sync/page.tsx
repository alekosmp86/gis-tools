"use client";

import { useState, useRef } from "react";
import { Database, FileSpreadsheet, GitMerge, Sliders } from "lucide-react";
import { ToolWorkspaceLayout } from "@/components/layout/ToolWorkspaceLayout";
import { WizardOrchestrator } from "@/components/shared/WizardOrchestrator";
import { DbConnectionForm } from "@/components/shared/DbConnectionForm";
import { CsvUploader } from "@/components/tools/db-csv-sync/CsvUploader";
import { SuidMappingStep } from "@/components/tools/db-sync-common/SuidMappingStep";
import { SyncParametersStep } from "@/components/tools/db-sync-common/SyncParametersStep";
import { ComparisonResultsView } from "@/components/tools/db-sync-common/ComparisonResultsView";
import { DB_VS_CSV_DESCRIPTOR } from "@/constants/comparisonDescriptors";
import type { DbConfig, DbColumnMetadata, DbConnectionFormRef } from "@/types/db";
import type { ColumnMappingConfig, SuidMappingStepRef, SyncParametersStepRef } from "@/types/comparison";
import type { WizardStepDef } from "@/types/ui";
import { ParsedFileDataset } from "@/types/parsers";

export default function DbCsvSyncToolPage() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [columnDetails, setColumnDetails] = useState<DbColumnMetadata[]>([]);
  const [isDbConnected, setIsDbConnected] = useState(false);

  const [csvDataset, setCsvDataset] = useState<ParsedFileDataset | null>(null);
  const [mappingConfig, setMappingConfig] = useState<ColumnMappingConfig | null>(null);
  const [isMappingReady, setIsMappingReady] = useState(true);

  const dbFormRef = useRef<DbConnectionFormRef | null>(null);
  const suidMappingRef = useRef<SuidMappingStepRef | null>(null);
  const syncParametersRef = useRef<SyncParametersStepRef | null>(null);

  const handleDbSuccess = (
    config: DbConfig,
    columns: string[],
    _totalRows: number,
    details?: DbColumnMetadata[]
  ) => {
    setDbConfig(config);
    setDbColumns(columns);
    setColumnDetails(details || []);
    setCurrentStep(2);
  };

  const handleCsvSuccess = (parsedData: ParsedFileDataset) => {
    setCsvDataset(parsedData);
  };

  const handleCsvDiscard = () => {
    setCsvDataset(null);
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

  const steps: WizardStepDef[] = [
    {
      id: 1,
      title: "Base de Datos",
      subtitle: "Conexión y Tabla",
      cardTitle: "Conectar a Base de Datos PostgreSQL",
      cardSubtitle: "Ingrese las credenciales para conectar a la base de datos e inspeccionar la tabla seleccionada.",
      icon: Database,
      content: (
        <DbConnectionForm
          ref={dbFormRef}
          onSuccess={handleDbSuccess}
          onStatusChange={(status) => setIsDbConnected(status.isConnected && status.columns.length > 0)}
        />
      ),
      canProceed: isDbConnected,
      onNext: () => dbFormRef.current?.proceed(),
    },
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
    {
      id: 3,
      title: "Mapeo SUID",
      subtitle: "Identificador y Atributos",
      cardTitle: "Configuración de SUID y Campos a Comparar",
      cardSubtitle: "Seleccione una o más columnas como clave SUID única o compuesta, escoja los atributos a comparar y configure la comparación de geometrías.",
      icon: GitMerge,
      content: csvDataset ? (
        <SuidMappingStep
          ref={suidMappingRef}
          dbColumns={dbColumns}
          columnDetails={columnDetails}
          fileAttributes={csvDataset.attributes}
          onSuccess={handleMappingSuccess}
          initialConfig={mappingConfig}
          showGeometryToggle={true}
          onReadyChange={setIsMappingReady}
        />
      ) : null,
      canProceed: isMappingReady,
      nextLabel: "Continuar a Parámetros de Sincronización",
      onNext: () => suidMappingRef.current?.proceed(),
      onBack: () => setCurrentStep(2),
    },
    {
      id: 4,
      title: "Parámetros",
      subtitle: "Tolerancia y Parches SQL",
      cardTitle: "Parámetros Avanzados de Sincronización",
      cardSubtitle: "Configure la tolerancia a fallas de codificación, optimización de sentencias UPDATE y valores por defecto para INSERT.",
      icon: Sliders,
      content: (
        <SyncParametersStep
          ref={syncParametersRef}
          dbColumns={dbColumns}
          columnDetails={columnDetails}
          initialConfig={mappingConfig}
          onSuccess={handleSyncParametersSuccess}
        />
      ),
      canProceed: true,
      nextLabel: "Iniciar Análisis y Comparación",
      onNext: () => syncParametersRef.current?.proceed(),
      onBack: () => setCurrentStep(3),
      backLabel: "Volver al Paso 3: Mapeo SUID",
    },
    {
      id: 5,
      title: "Resultados",
      subtitle: "Discrepancias y Script",
      cardTitle: "Resultados de Análisis y Discrepancias",
      cardSubtitle: dbConfig && csvDataset
        ? `Correlación realizada entre ${dbConfig.schema_name}.${dbConfig.table_name} y ${csvDataset.fileName}.`
        : "Visualice las diferencias detectadas y genere scripts SQL de sincronización.",
      icon: Database,
      content: dbConfig && csvDataset && mappingConfig ? (
        <ComparisonResultsView
          dbConfig={dbConfig}
          fileDataset={csvDataset}
          mappingConfig={mappingConfig}
          descriptor={DB_VS_CSV_DESCRIPTOR}
        />
      ) : null,
      onBack: () => setCurrentStep(4),
      backLabel: "Volver al Paso 4: Parámetros de Sincronización",
    },
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
