"use client";

import { useState, useRef } from "react";
import { Database, Layers } from "lucide-react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { ShapefileUploader } from "@/components/tools/db-shapefile-sync/ShapefileUploader";
import {
  buildResultsStep,
  buildSuidMappingStep,
  buildSyncParametersStep,
} from "@/components/tools/db-sync-common/wizardSteps";
import { DbColumnMetadata, DbConfig, DbConnectionFormRef } from "@/core/types/db";
import { ParsedShapefileData } from "@/core/types/shp";
import { ColumnMappingConfig, SuidMappingStepRef, SyncParametersStepRef } from "@/core/types/comparison";
import { WizardStepDef } from "@/ui-kit/types/ui";
import { DbConnectionForm } from "@/ui-kit/components/DbConnectionForm";
import { DB_VS_SHAPEFILE_DESCRIPTOR } from "@/core/constants/comparisonDescriptors";
import { WizardOrchestrator } from "@/ui-kit/components/WizardOrchestrator";

export default function DbShapefileSyncToolPage() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [columnDetails, setColumnDetails] = useState<DbColumnMetadata[]>([]);
  const [isDbConnected, setIsDbConnected] = useState(false);

  const [shapefileData, setShapefileData] = useState<ParsedShapefileData | null>(null);
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

  const handleShapefileSuccess = (parsedData: ParsedShapefileData) => {
    setShapefileData(parsedData);
  };

  const handleShapefileDiscard = () => {
    setShapefileData(null);
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
    // eslint-disable-next-line react-hooks/refs
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
