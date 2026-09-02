"use client";

import React, { useState, useRef } from "react";
import { Database, MapPin } from "lucide-react";
import { ToolWorkspaceLayout } from "@/components/layout/ToolWorkspaceLayout";
import { WizardOrchestrator } from "@/components/shared/WizardOrchestrator";
import { DbConnectionForm } from "@/components/shared/DbConnectionForm";
import { DbTableViewerContainer } from "@/components/tools/db-table-viewer/DbTableViewerContainer";
import type { DbConfig, DbConnectionFormRef } from "@/types/db";
import type { WizardStepDef } from "@/types/ui";

export default function DbTableViewerPage() {
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [dbColumns, setDbColumns] = useState<string[]>([]);
  const [totalRows, setTotalRows] = useState<number>(0);
  const [isDbConnected, setIsDbConnected] = useState<boolean>(false);

  const dbFormRef = useRef<DbConnectionFormRef | null>(null);

  const handleDbSuccess = (
    config: DbConfig,
    columns: string[],
    rows: number
  ) => {
    setDbConfig(config);
    setDbColumns(columns);
    setTotalRows(rows);
    setCurrentStep(2);
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
      cardTitle: "Conexión a Base de Datos PostgreSQL / PostGIS",
      cardSubtitle: "Ingrese o seleccione un perfil guardado para conectar a la base de datos e inspeccionar la tabla seleccionada.",
      icon: Database,
      content: (
        <DbConnectionForm
          ref={dbFormRef}
          onSuccess={handleDbSuccess}
          onStatusChange={(status) => setIsDbConnected(status.isConnected && status.columns.length > 0)}
        />
      ),
      canProceed: isDbConnected,
      nextLabel: "Visualizar Tabla en Mapa y Atributos",
      onNext: () => dbFormRef.current?.proceed(),
    },
    {
      id: 2,
      title: "Vista Espacial",
      subtitle: "Mapa y Atributos",
      cardTitle: "Vista Espacial y Tabla de Atributos",
      cardSubtitle: dbConfig
        ? `Visualización en vivo de ${dbConfig.schema_name}.${dbConfig.table_name}`
        : "Explore las geometrías en el mapa interactivo e inspeccione la tabla de atributos.",
      icon: MapPin,
      content: dbConfig ? (
        <DbTableViewerContainer
          config={dbConfig}
          columns={dbColumns}
          totalRows={totalRows}
        />
      ) : null,
      onBack: () => setCurrentStep(1),
      backLabel: "Volver al Paso 1: Conexión de Base de Datos",
    },
  ];

  return (
    <ToolWorkspaceLayout
      title="Visor de Tabla PostGIS / PostgreSQL"
      description="Conéctese a cualquier tabla de PostgreSQL/PostGIS para inspeccionar sus registros en tiempo real, visualizar geometrías espaciales en el mapa interactivo de Leaflet y consultar sus atributos en una tabla paginada."
    >
      <WizardOrchestrator
        steps={steps}
        currentStep={currentStep}
        onStepClick={handleStepClick}
      />
    </ToolWorkspaceLayout>
  );
}
