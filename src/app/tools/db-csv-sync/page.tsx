"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, Database, FileSpreadsheet, GitMerge } from "lucide-react";
import styles from "./page.module.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { WizardOrchestrator } from "@/components/shared/WizardOrchestrator";
import { DbConnectionForm } from "@/components/shared/DbConnectionForm";
import { CsvUploader } from "@/components/tools/db-csv-sync/CsvUploader";
import { SuidMappingStep } from "@/components/tools/db-sync-common/SuidMappingStep";
import { Step4ResultsView } from "@/components/tools/db-sync-common/Step4ResultsView";
import type { DbConfig, DbColumnMetadata, DbConnectionFormRef } from "@/types/db";
import type { ColumnMappingConfig, SuidMappingStepRef } from "@/types/gis";
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
  const [isMappingReady, setIsMappingReady] = useState(false);

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

  const handleCsvSuccess = (parsedData: ParsedFileDataset) => {
    setCsvDataset(parsedData);
  };

  const handleCsvDiscard = () => {
    setCsvDataset(null);
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
      title: "Archivo CSV",
      subtitle: "Cargar Archivo (.csv)",
      cardTitle: "Cargar Archivo de Datos CSV",
      cardSubtitle: "Suba un archivo .csv delimitado por comas. Los datos se inspeccionan en la memoria local.",
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
      cardSubtitle: "Seleccione una o más columnas como clave SUID única o compuesta, escoja los atributos a comparar y configure valores por defecto.",
      icon: GitMerge,
      content: csvDataset ? (
        <SuidMappingStep
          ref={suidMappingRef}
          dbColumns={dbColumns}
          columnDetails={columnDetails}
          fileAttributes={csvDataset.attributes}
          onSuccess={handleMappingSuccess}
          onBack={() => setCurrentStep(2)}
          initialConfig={mappingConfig}
          showGeometryToggle={false}
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
      cardSubtitle: dbConfig && csvDataset
        ? `Correlación realizada entre ${dbConfig.schema_name}.${dbConfig.table_name} y ${csvDataset.fileName}.`
        : "Visualice las diferencias detectadas y genere scripts SQL de sincronización.",
      icon: Database,
      content: dbConfig && csvDataset && mappingConfig ? (
        <Step4ResultsView
          dbConfig={dbConfig}
          fileDataset={csvDataset}
          mappingConfig={mappingConfig}
        />
      ) : null,
      onBack: () => setCurrentStep(3),
      backLabel: "Volver al Paso 3: Mapeo SUID",
    },
  ];

  return (
    <div className={styles.container}>
      <Header />

      <main className={styles.main}>
        {/* Back to Portal Link */}
        <div className={styles.backArea}>
          <Link href="/" className={styles.backBtn}>
            <ArrowLeft size={16} />
            <span>Volver al Portal de Herramientas SIG</span>
          </Link>
        </div>

        <div className={styles.workspaceHeader}>
          <h1 className={styles.title}>Sincronización de Datos DB vs. CSV</h1>
          <p className={styles.description}>
            Correlacione registros de bases de datos PostgreSQL contra archivos alfanuméricos CSV (.csv),
            analice discrepancias de atributos y genere parches SQL de actualización e inserción para PostGIS.
          </p>
        </div>

        {/* Wizard Orchestrator */}
        <WizardOrchestrator
          steps={steps}
          currentStep={currentStep}
          onStepClick={handleStepClick}
        />
      </main>

      <Footer />
    </div>
  );
}

