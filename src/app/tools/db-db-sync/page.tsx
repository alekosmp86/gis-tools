"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { StepIndicator } from "@/components/shared/StepIndicator";
import { DbConnectionForm } from "@/components/shared/DbConnectionForm";
import { SuidMappingStep } from "@/components/tools/db-sync-common/SuidMappingStep";
import { Step4ResultsView } from "@/components/tools/db-sync-common/Step4ResultsView";
import type { DbConfig, DbColumnMetadata } from "@/types/db";
import type { ParsedFileDataset } from "@/types/parsers";
import { FileSourceKind } from "@/types/parsers";
import type { ColumnMappingConfig } from "@/types/gis";
import { ArrowLeft, Database } from "lucide-react";

export default function DbDbSyncToolPage() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [dbConfig1, setDbConfig1] = useState<DbConfig | null>(null);
  const [dbColumns1, setDbColumns1] = useState<string[]>([]);
  const [dbConfig2, setDbConfig2] = useState<DbConfig | null>(null);
  const [dbColumns2, setDbColumns2] = useState<string[]>([]);
  const [columnDetails2, setColumnDetails2] = useState<DbColumnMetadata[]>([]);
  const [mappingConfig, setMappingConfig] = useState<ColumnMappingConfig | null>(null);

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
    setMappingConfig(config);
    setCurrentStep(4);
  };

  const handleStepClick = (stepId: number) => {
    if (stepId < currentStep) {
      setCurrentStep(stepId);
    }
  };

  // Build a ParsedFileDataset wrapper for DB 1 to pass seamlessly into Step4ResultsView & worker
  const sourceDataset: ParsedFileDataset | null = dbConfig1
    ? {
        kind: FileSourceKind.CSV,
        fileName: `${dbConfig1.db_name}.${dbConfig1.schema_name}.${dbConfig1.table_name}`,
        fileSize: dbColumns1.length * 100,
        featureCount: 0,
        attributes: dbColumns1,
        recordsMap: new Map(),
      }
    : null;

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
          <h1 className={styles.title}>Sincronización de Datos DB vs. DB (Réplicas)</h1>
          <p className={styles.description}>
            Correlacione registros entre dos tablas de bases de datos PostgreSQL/PostGIS (incluso en distintas bases de datos o esquemas),
            identifique discrepancias alfanuméricas y aplique parches SQL de actualización e inserción.
          </p>
        </div>

        {/* 4-Step Wizard Indicator */}
        <StepIndicator
          currentStep={currentStep}
          step1Title="DB Origen"
          step1Subtitle="Tabla Fuente (DB 1)"
          fileStepTitle="DB Destino"
          fileStepSubtitle="Tabla Réplica (DB 2)"
          onStepClick={handleStepClick}
        />

        {/* Step 1: Source Database 1 Connection & Introspection */}
        {currentStep === 1 && (
          <div>
            <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px", color: "var(--accent-cyan)", fontWeight: 600 }}>
              <Database size={18} />
              <span>1. Configurar Conexión a Base de Datos Origen (Tabla Fuente DB 1)</span>
            </div>
            <DbConnectionForm onSuccess={handleDb1Success} />
          </div>
        )}

        {/* Step 2: Target Database 2 Connection & Introspection */}
        {currentStep === 2 && (
          <div>
            <div style={{ marginBottom: "16px", display: "flex", alignItems: "center", gap: "8px", color: "var(--accent-cyan)", fontWeight: 600 }}>
              <Database size={18} />
              <span>2. Configurar Conexión a Base de Datos Destino (Tabla Objetivo DB 2 / Réplica)</span>
            </div>
            <DbConnectionForm onSuccess={handleDb2Success} />
          </div>
        )}

        {/* Step 3: SUID & Attributes Column Mapping */}
        {currentStep === 3 && dbColumns1.length > 0 && (
          <SuidMappingStep
            dbColumns={dbColumns2}
            columnDetails={columnDetails2}
            fileAttributes={dbColumns1}
            onSuccess={handleMappingSuccess}
            onBack={() => setCurrentStep(2)}
            initialConfig={mappingConfig}
            showGeometryToggle={false}
          />
        )}

        {/* Step 4: Full Comparison Results & SQL Patch Export / Direct Execution */}
        {currentStep === 4 && dbConfig2 && sourceDataset && mappingConfig && (
          <Step4ResultsView
            dbConfig={dbConfig2}
            fileDataset={sourceDataset}
            mappingConfig={mappingConfig}
            onBackToMapping={() => setCurrentStep(3)}
            sourceDbConfig={dbConfig1 || undefined}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}
