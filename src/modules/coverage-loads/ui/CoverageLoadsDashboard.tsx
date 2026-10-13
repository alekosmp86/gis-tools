"use client";

import React, { useState } from "react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { COVERAGE_SECTIONS, type CoverageSectionId } from "./coverageSections";
import { CoverageSectionTabs } from "./CoverageSectionTabs";

/** The page this module owns, served at /tools/m/coverage-loads. */
export const CoverageLoadsDashboard: React.FC = () => {
  const [activeId, setActiveId] = useState<CoverageSectionId>(COVERAGE_SECTIONS[0].id);

  return (
    <ToolWorkspaceLayout
      title="Cargas de Coberturas"
      description="Cargue los indicadores de cobertura LTE (IndicadoresLTE_aaaammdd.csv) al histórico de PostgreSQL. Primero se revisa qué se va a reemplazar y recién después, al confirmar, se escribe en la base. Luego se generan los reportes CSV."
    >
      <CoverageSectionTabs sections={COVERAGE_SECTIONS} activeId={activeId} onChange={setActiveId} />
    </ToolWorkspaceLayout>
  );
};
