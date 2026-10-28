"use client";

import React from "react";
import ActualizarPadronWizard from "./ActualizarPadronWizard";
import { CargarLocalidadesWizard } from "./CargarLocalidadesWizard";
import { CargarPadronesWizard } from "./CargarPadronesWizard";
import { CompletarUnidadTerritorialWizard } from "./CompletarUnidadTerritorialWizard";
import { UnidadTerritorialWizard } from "./UnidadTerritorialWizard";
import type { ClientConnection, StagingSelection } from "./clientTypes";
import { MonthlyStage } from "./monthlyCartoStages";

export interface MonthlyCartoStagePanelProps {
  stage: MonthlyStage;
  connection: ClientConnection;
  staging: StagingSelection | null;
  onStagingChosen: (staging: StagingSelection | null) => void;
}

export const MonthlyCartoStagePanel: React.FC<MonthlyCartoStagePanelProps> = ({
  stage,
  connection,
  staging,
  onStagingChosen,
}) => {
  switch (stage) {
    case MonthlyStage.CARGAR_PADRONES:
      return <CargarPadronesWizard connection={connection} onStagingChosen={onStagingChosen} />;
    case MonthlyStage.CARGAR_LOCALIDADES:
      return <CargarLocalidadesWizard connection={connection} initialStaging={staging ?? undefined} />;
    case MonthlyStage.UNIDAD_TERRITORIAL:
      return <UnidadTerritorialWizard connection={connection} />;
    case MonthlyStage.COMPLETAR_UNIDAD_TERRITORIAL:
      return <CompletarUnidadTerritorialWizard connection={connection} />;
    case MonthlyStage.ACTUALIZAR_PADRON:
      return (
        <ActualizarPadronWizard connection={connection} initialStaging={staging ?? undefined} />
      );
    default:
      return null;
  }
};
