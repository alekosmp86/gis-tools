"use client";

import { useState, useRef } from "react";
import { Database, FileSpreadsheet } from "lucide-react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { CsvUploader } from "@/components/tools/db-csv-sync/CsvUploader";
import {
  buildResultsStep,
  buildSuidMappingStep,
  buildSyncParametersStep,
} from "@/components/tools/db-sync-common/wizardSteps";
import { DbColumnMetadata, DbConfig, DbConnectionFormRef } from "@/core/types/db";
import { ParsedFileDataset } from "@/core/types/parsers";
import { ColumnMappingConfig, SuidMappingStepRef, SyncParametersStepRef } from "@/core/types/comparison";
import { WizardStepDef } from "@/ui-kit/types/ui";
import { DbConnectionForm } from "@/ui-kit/components/DbConnectionForm";
import { DB_VS_CSV_DESCRIPTOR } from "@/core/constants/comparisonDescriptors";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";

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
    // react-doctor-disable-next-line react-hooks-js/refs
    // eslint-disable-next-line react-hooks/refs
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
    // eslint-disable-next-line react-hooks/refs
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
