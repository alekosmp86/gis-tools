"use client";

import React, { useState } from "react";
import { Button } from "@/ui-kit/components/ui/Button";
import { connectionBlockingReason, initialWizardState, type ConnectionField } from "./cargarPadronesWizardState";
import type { ClientConnection } from "./clientTypes";
import { trimConnection } from "./connectionProfiles";
import { ConnectionStep } from "./steps/ConnectionStep";
import { useConnectionProfiles } from "./useConnectionProfiles";
import styles from "./MonthlyCartoUpdate.module.css";

const CONNECT_LABEL = "Continuar a las etapas";
const DESCRIPTION = "Servidor, base de datos y usuario. La misma conexión se usa en todas las etapas.";

export interface MonthlyCartoConnectionProps {
  onConnected: (connection: ClientConnection) => void;
}

export const MonthlyCartoConnection: React.FC<MonthlyCartoConnectionProps> = ({ onConnected }) => {
  const [draft, setDraft] = useState<ClientConnection>(() => initialWizardState().connection);
  const { profiles, activeProfileId, selectProfile, saveProfile: saveConnectionProfile, deleteProfile } = useConnectionProfiles();
  const blockingReason = connectionBlockingReason(draft);

  const changeField = (field: ConnectionField, value: string) => setDraft((current) => ({ ...current, [field]: value }));

  const saveProfile = (name: string) => saveConnectionProfile(name, draft);

  const pickProfile = (profileId: string) => {
    const config = selectProfile(profileId);
    if (config === null) return;
    setDraft((current) => ({
      ...current,
      host: config.host,
      port: config.port,
      db_name: config.db_name,
      user: config.user,
    }));
  };

  return (
    <section className={styles.stack}>
      <p className={styles.hint}>{DESCRIPTION}</p>
      <ConnectionStep
        connection={draft}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onFieldChange={changeField}
        onSelectProfile={pickProfile}
        onSaveProfile={saveProfile}
        onDeleteProfile={deleteProfile}
        blockingReason={blockingReason}
      />
      <div className={styles.actions}>
        <Button isDisabled={blockingReason !== null} onClick={() => onConnected(trimConnection(draft))}>
          <span>{CONNECT_LABEL}</span>
        </Button>
      </div>
    </section>
  );
};
