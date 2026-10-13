"use client";

import React from "react";
import { ToolWorkspaceLayout } from "@/ui-kit/components/layout/ToolWorkspaceLayout";
import { CoverageWorkflow } from "../workflow/ui/CoverageWorkflow";

/** The page this module owns, served at /tools/m/coverage-loads. */
export const CoverageLoadsDashboard: React.FC = () => (
  <ToolWorkspaceLayout
    title="Cargas de Coberturas"
    description="Cargue los indicadores de cobertura LTE (IndicadoresLTE_aaaammdd.csv) al histórico de PostgreSQL. Primero se confirma la conexión; luego cada paso es independiente y se puede omitir. Antes de escribir en la base se revisa qué se va a reemplazar, y al final se resume el resultado y se generan los reportes CSV."
  >
    <CoverageWorkflow />
  </ToolWorkspaceLayout>
);
