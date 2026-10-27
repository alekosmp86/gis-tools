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
import type { JobProfile } from "../jobProfileStorage";
import styles from "./WizardSteps.module.css";

const NO_PROFILE = "";
const toSavedDbProfile = ({ name, savedAt, setup }: JobProfile): SavedDbProfile => ({
  id: name,
  name,
  updatedAt: savedAt,
  config: { host: setup.host, port: setup.port, db_name: setup.db_name, user: setup.user, schema_name: setup.schema, table_name: "" },
});

const FIELDS: ReadonlyArray<{ field: ConnectionField; label: string }> = [
  { field: "host", label: "Servidor" },
  { field: "port", label: "Puerto" },
  { field: "db_name", label: "Base de datos" },
  { field: "user", label: "Usuario" },
  { field: "password", label: "Contraseña" },
];

export interface ConnectionStepProps {
  connection: ClientConnection;
  profiles: JobProfile[];
  activeProfile: string;
  onFieldChange: (field: ConnectionField, value: string) => void;
  onSelectProfile: (name: string) => void;
  onSaveProfile: (name: string) => void;
  onDeleteProfile: (name: string) => void;
  blockingReason: string | null;
}

export const ConnectionStep: React.FC<ConnectionStepProps> = ({
  connection,
  profiles,
  activeProfile,
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
            profiles={profiles.map(toSavedDbProfile)}
            activeProfileId={activeProfile}
            onSelectProfile={onSelectProfile}
          />
        </div>
        {activeProfile !== NO_PROFILE && (
          <Button variant={ButtonVariant.SECONDARY} onClick={() => onDeleteProfile(activeProfile)}>
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
      <p className={styles.hint}>El perfil guarda el servidor, la base, el usuario y las tablas. La contraseña se escribe en cada carga.</p>

      {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
    </div>
  );
};
