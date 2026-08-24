"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./page.module.css";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { StepIndicator } from "@/components/gis/StepIndicator";
import { DbConnectionForm } from "@/components/gis/DbConnectionForm";
import { ShapefileUploader } from "@/components/gis/ShapefileUploader";
import type { DbConfig } from "@/types/db";
import type { ParsedShapefileData } from "@/types/shp";
import { ArrowLeft } from "lucide-react";

export default function DbShapefileSyncToolPage() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [dbTotalRows, setDbTotalRows] = useState<number>(0);
  const [shapefileData, setShapefileData] = useState<ParsedShapefileData | null>(null);

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

        {/* Step 3 Placeholder */}
        {currentStep === 3 && (
          <div className="glass-panel" style={{ padding: "32px", textAlign: "center" }}>
            <h2 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Paso 3: Mapeo SUID y Atributos</h2>
            <p style={{ color: "var(--text-muted)", marginTop: "8px" }}>
              Base de datos: <strong>{dbConfig?.db_name}</strong> (Tabla: <code>{dbConfig?.table_name}</code> - {dbColumns.length} cols, {dbTotalRows} rows) <br />
              Shapefile cargado: <strong>{shapefileData?.fileName}</strong> ({shapefileData?.featureCount} geometrías, {shapefileData?.attributes.length} atributos DBF)
            </p>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
