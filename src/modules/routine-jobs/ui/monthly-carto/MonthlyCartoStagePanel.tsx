"use client";

import React from "react";
import ActualizarPadronWizard from "../actualizar-padron/ActualizarPadronWizard";
import { CargarLocalidadesWizard } from "../cargar-localidades/CargarLocalidadesWizard";
import { CargarPadronesWizard } from "../cargar-padrones/CargarPadronesWizard";
import { UnidadTerritorialWizard } from "../unidad-territorial/UnidadTerritorialWizard";
import type { ClientConnection, StagingSelection } from "../shared/clientTypes";
import { MonthlyStage } from "../shared/monthlyCartoStages";

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
    case MonthlyStage.ACTUALIZAR_PADRON:
      return (
        <ActualizarPadronWizard connection={connection} initialStaging={staging ?? undefined} />
      );
    default:
      return null;
  }
};
