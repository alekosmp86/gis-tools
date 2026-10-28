"use client";

import React, { useState } from "react";
import { ArrowLeft, Unplug } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { ClientConnection, StagingSelection } from "./clientTypes";
import { MonthlyCartoConnection } from "./MonthlyCartoConnection";
import { MonthlyCartoStageList } from "./MonthlyCartoStageList";
import { MonthlyCartoStagePanel } from "./MonthlyCartoStagePanel";
import { MONTHLY_STAGES, type MonthlyStage } from "./monthlyCartoStages";
import styles from "./MonthlyCartoUpdate.module.css";

const CONNECTION_TITLE = "Conexión";
const STAGES_TITLE = "Etapas";
const BACK_TO_STAGES_LABEL = "Volver a las etapas";
const CHANGE_CONNECTION_LABEL = "Cambiar conexión";

const titleOf = (stage: MonthlyStage): string => MONTHLY_STAGES.find((def) => def.id === stage)?.title ?? "";

const connectionSummaryOf = (connection: ClientConnection): string =>
  `Conectado a ${connection.host}:${connection.port} · ${connection.db_name} como ${connection.user}`;

export const MonthlyCartoUpdate: React.FC = () => {
  const [connection, setConnection] = useState<ClientConnection | null>(null);
  const [openedStage, setOpenedStage] = useState<MonthlyStage | null>(null);
  const [staging, setStaging] = useState<StagingSelection | null>(null);

  const changeConnection = () => {
    setConnection(null);
    setStaging(null);
  };

  if (connection === null) {
    return (
      <div className={styles.stack}>
        <h3 className={styles.sectionTitle}>{CONNECTION_TITLE}</h3>
        <MonthlyCartoConnection onConnected={setConnection} />
      </div>
    );
  }

  if (openedStage !== null) {
    return (
      <div className={styles.stack}>
        <div className={styles.stageHeader}>
          <h3 className={styles.sectionTitle}>{titleOf(openedStage)}</h3>
          <Button variant={ButtonVariant.SECONDARY} onClick={() => setOpenedStage(null)}>
            <ArrowLeft size={15} />
            <span>{BACK_TO_STAGES_LABEL}</span>
          </Button>
        </div>
        <MonthlyCartoStagePanel
          stage={openedStage}
          connection={connection}
          staging={staging}
          onStagingChosen={setStaging}
        />
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      <div className={styles.stageHeader}>
        <p className={styles.hint}>{connectionSummaryOf(connection)}</p>
        <Button variant={ButtonVariant.SECONDARY} onClick={changeConnection}>
          <Unplug size={15} />
          <span>{CHANGE_CONNECTION_LABEL}</span>
        </Button>
      </div>
      <h3 className={styles.sectionTitle}>{STAGES_TITLE}</h3>
      <MonthlyCartoStageList onOpen={setOpenedStage} />
    </div>
  );
};
