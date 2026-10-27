"use client";

import React, { useState } from "react";
import { Trash2 } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { ProfileSelect } from "@/ui-kit/components/ProfileSelect";
import type { SavedDbProfile } from "@/core/types/db";
import { Button } from "@/ui-kit/components/ui/Button";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { ConnectionField } from "../cargarPadronesWizardState";
import type { ClientConnection } from "../clientTypes";
import styles from "./WizardSteps.module.css";

const NO_PROFILE = "";

const FIELDS: ReadonlyArray<{ field: ConnectionField; label: string }> = [
  { field: "host", label: "Servidor" },
  { field: "port", label: "Puerto" },
  { field: "db_name", label: "Base de datos" },
  { field: "user", label: "Usuario" },
  { field: "password", label: "Contraseña" },
];

export interface ConnectionStepProps {
  connection: ClientConnection;
  profiles: SavedDbProfile[];
  activeProfileId: string;
  onFieldChange: (field: ConnectionField, value: string) => void;
  onSelectProfile: (profileId: string) => void;
  onSaveProfile: (name: string) => void;
  onDeleteProfile: (profileId: string) => void;
  blockingReason: string | null;
}

export const ConnectionStep: React.FC<ConnectionStepProps> = ({
  connection,
  profiles,
  activeProfileId,
  onFieldChange,
  onSelectProfile,
  onSaveProfile,
  onDeleteProfile,
  blockingReason,
}) => {
  const [profileName, setProfileName] = useState("");
  const canSave = profileName.trim() !== "";

  const saveProfile = () => {
    if (!canSave) return;
    onSaveProfile(profileName);
    setProfileName("");
  };

  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <div className={styles.field}>
          <span>Perfil guardado</span>
          <ProfileSelect
            profiles={profiles}
            activeProfileId={activeProfileId}
            onSelectProfile={onSelectProfile}
          />
        </div>
        {activeProfileId !== NO_PROFILE && (
          <Button variant={ButtonVariant.SECONDARY} onClick={() => onDeleteProfile(activeProfileId)}>
            <Trash2 size={15} />
            <span>Eliminar perfil</span>
          </Button>
        )}
      </div>

      <div className={styles.grid}>
        {FIELDS.map(({ field, label }) => (
          <FormField
            key={field}
            label={label}
            type={field === "password" ? "password" : "text"}
            value={connection[field]}
            onChange={(value) => onFieldChange(field, value)}
          />
        ))}
      </div>

      <div className={styles.row}>
        <FormField label="Nombre del perfil" value={profileName} onChange={setProfileName} />
        <Button variant={ButtonVariant.SECONDARY} isDisabled={!canSave} onClick={saveProfile}>
          <span>Guardar perfil</span>
        </Button>
      </div>
      <p className={styles.hint}>El perfil guarda el servidor, la base y el usuario. La contraseña se escribe en cada carga.</p>

      {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
    </div>
  );
};
