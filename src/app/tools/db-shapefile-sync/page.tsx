"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { StepIndicator } from "@/components/shared/StepIndicator";
import { DbConnectionForm } from "@/components/tools/db-shapefile-sync/DbConnectionForm";
import { ShapefileUploader } from "@/components/tools/db-shapefile-sync/ShapefileUploader";
import { SuidMappingStep } from "@/components/tools/db-shapefile-sync/SuidMappingStep";
import type { DbConfig } from "@/types/db";
import type { ParsedShapefileData } from "@/types/shp";
import type { ColumnMappingConfig } from "@/types/gis";
import { ArrowLeft } from "lucide-react";

export default function DbShapefileSyncToolPage() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [, setDbTotalRows] = useState<number>(0);
  const [shapefileData, setShapefileData] = useState<ParsedShapefileData | null>(null);
  const [mappingConfig, setMappingConfig] = useState<ColumnMappingConfig | null>(null);

  const handleDbSuccess = (config: DbConfig, columns: string[], totalRows: number) => {
    setDbConfig(config);
    setDbColumns(columns);
    setDbTotalRows(totalRows);
    setCurrentStep(2);
  };

  const handleShapefileSuccess = (parsedData: ParsedShapefileData) => {
    setShapefileData(parsedData);
    setCurrentStep(3);
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
          <h1 className={styles.title}>Sincronización de Datos DB vs. Shapefile</h1>
          <p className={styles.description}>
            Correlacione registros de bases de datos PostgreSQL contra archivos Shapefile (.shp/.zip),
            analice discrepancias de atributos y geometrías, y genere scripts SQL de actualización para PostGIS.
          </p>
        </div>

        {/* 4-Step Wizard Indicator */}
        <StepIndicator currentStep={currentStep} onStepClick={handleStepClick} />

        {/* Step 1: Database Connection & Introspection */}
        {currentStep === 1 && (
          <DbConnectionForm onSuccess={handleDbSuccess} />
        )}

        {/* Step 2: Shapefile / GeoJSON Upload */}
        {currentStep === 2 && (
          <ShapefileUploader
            onSuccess={handleShapefileSuccess}
            onDiscard={handleShapefileDiscard}
            loadedData={shapefileData}
          />
        )}

        {/* Step 3: SUID & Attributes Column Mapping */}
        {currentStep === 3 && shapefileData && (
          <SuidMappingStep
            dbColumns={dbColumns}
            shpAttributes={shapefileData.attributes}
            onSuccess={handleMappingSuccess}
            onBack={() => setCurrentStep(2)}
            initialConfig={mappingConfig}
          />
        )}

        {/* Step 4 Placeholder: Results & Analysis */}
        {currentStep === 4 && (
          <div className={`glass-panel ${styles.placeholderCard}`}>
            <h2 className={styles.placeholderTitle}>Paso 4: Resultados y Discrepancias</h2>
            <p className={styles.placeholderText}>
              Base de datos: <strong>{dbConfig?.db_name}</strong> (Tabla: <code>{dbConfig?.table_name}</code>) <br />
              SUID Mapeado: <code>{mappingConfig?.suidColumn}</code> &rarr; <code>{mappingConfig?.matchedShpSuidColumn}</code> <br />
              Atributos a comparar ({mappingConfig?.fieldsToCompare.length}): {mappingConfig?.fieldsToCompare.join(", ")} <br />
              Comparación Geométrica Topológica: {mappingConfig?.compareGeometry ? "Activada" : "Desactivada"}
            </p>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
