"use client";

import { useState, useRef } from "react";
import { Database, Layers, GitMerge } from "lucide-react";
import { ToolWorkspaceLayout } from "@/components/layout/ToolWorkspaceLayout";
import { WizardOrchestrator } from "@/components/shared/WizardOrchestrator";
import { DbConnectionForm } from "@/components/shared/DbConnectionForm";
import { ShapefileUploader } from "@/components/tools/db-shapefile-sync/ShapefileUploader";
import { SuidMappingStep } from "@/components/tools/db-sync-common/SuidMappingStep";
import { Step4ResultsView } from "@/components/tools/db-sync-common/Step4ResultsView";
import { DB_VS_SHAPEFILE_DESCRIPTOR } from "@/constants/comparisonDescriptors";
import type { DbConfig, DbColumnMetadata, DbConnectionFormRef } from "@/types/db";
import type { ColumnMappingConfig, SuidMappingStepRef } from "@/types/comparison";
import type { WizardStepDef } from "@/types/ui";
import { ParsedShapefileData } from "@/types/shp";

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
    setMappingConfig(config);
    setCurrentStep(4);
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
    {
      id: 3,
      title: "Mapeo SUID",
      subtitle: "Identificador y Atributos",
      cardTitle: "Configuración de SUID y Campos a Comparar",
      cardSubtitle: "Seleccione una o más columnas como clave SUID única o compuesta, escoja los atributos a comparar y configure valores por defecto.",
      icon: GitMerge,
      content: shapefileData ? (
        <SuidMappingStep
          ref={suidMappingRef}
          dbColumns={dbColumns}
          columnDetails={columnDetails}
          fileAttributes={shapefileData.attributes}
          onSuccess={handleMappingSuccess}
          onBack={() => setCurrentStep(2)}
          initialConfig={mappingConfig}
          onReadyChange={setIsMappingReady}
        />
      ) : null,
      canProceed: isMappingReady,
      nextLabel: "Iniciar Análisis y Comparación",
      onNext: () => suidMappingRef.current?.proceed(),
      onBack: () => setCurrentStep(2),
    },
    {
      id: 4,
      title: "Resultados",
      subtitle: "Discrepancias y Script",
      cardTitle: "Resultados de Análisis y Discrepancias",
      cardSubtitle: dbConfig && shapefileData
        ? `Correlación realizada entre ${dbConfig.schema_name}.${dbConfig.table_name} y ${shapefileData.fileName}.`
        : "Visualice las diferencias detectadas y genere scripts SQL de sincronización.",
      icon: Database,
      content: dbConfig && shapefileData && mappingConfig ? (
        <Step4ResultsView
          dbConfig={dbConfig}
          fileDataset={shapefileData}
          mappingConfig={mappingConfig}
          descriptor={DB_VS_SHAPEFILE_DESCRIPTOR}
        />
      ) : null,
      onBack: () => setCurrentStep(3),
      backLabel: "Volver al Paso 3: Mapeo SUID",
    },
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

