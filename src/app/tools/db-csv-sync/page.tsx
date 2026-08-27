"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { StepIndicator } from "@/components/shared/StepIndicator";
import { DbConnectionForm } from "@/components/shared/DbConnectionForm";
import { CsvUploader } from "@/components/tools/db-csv-sync/CsvUploader";
import { SuidMappingStep } from "@/components/tools/db-shapefile-sync/SuidMappingStep";
import { Step4ResultsView } from "@/components/tools/db-shapefile-sync/Step4ResultsView";
import type { DbConfig, DbColumnMetadata } from "@/types/db";
import type { ParsedFileDataset } from "@/types/parsers";
import type { ColumnMappingConfig } from "@/types/gis";
import { ArrowLeft } from "lucide-react";

export default function DbCsvSyncToolPage() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [columnDetails, setColumnDetails] = useState<DbColumnMetadata[]>([]);
  const [csvDataset, setCsvDataset] = useState<ParsedFileDataset | null>(null);
  const [mappingConfig, setMappingConfig] = useState<ColumnMappingConfig | null>(null);

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
    setCurrentStep(3);
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

        {/* 4-Step Wizard Indicator */}
        <StepIndicator
          currentStep={currentStep}
          fileStepTitle="Archivo CSV"
          fileStepSubtitle="Cargar Archivo (.csv)"
          onStepClick={handleStepClick}
        />

        {/* Step 1: Database Connection & Introspection */}
        {currentStep === 1 && (
          <DbConnectionForm onSuccess={handleDbSuccess} />
        )}

        {/* Step 2: CSV File Upload & Parsing */}
        {currentStep === 2 && (
          <CsvUploader
            onSuccess={handleCsvSuccess}
            onDiscard={handleCsvDiscard}
            loadedData={csvDataset}
          />
        )}

        {/* Step 3: SUID & Attributes Column Mapping */}
        {currentStep === 3 && csvDataset && (
          <SuidMappingStep
            dbColumns={dbColumns}
            columnDetails={columnDetails}
            fileAttributes={csvDataset.attributes}
            onSuccess={handleMappingSuccess}
            onBack={() => setCurrentStep(2)}
            initialConfig={mappingConfig}
            showGeometryToggle={false}
          />
        )}

        {/* Step 4: Reusable Comparison Results View */}
        {currentStep === 4 && dbConfig && csvDataset && mappingConfig && (
          <Step4ResultsView
            dbConfig={dbConfig}
            fileDataset={csvDataset}
            mappingConfig={mappingConfig}
            onBackToMapping={() => setCurrentStep(3)}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}
