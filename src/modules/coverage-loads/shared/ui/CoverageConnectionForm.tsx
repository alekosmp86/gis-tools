"use client";

import React from "react";
import { ArrowRight, Database, Lock, Save, Server, User } from "lucide-react";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { Button } from "@/ui-kit/components/ui/Button";
import { ProfileSelect } from "@/ui-kit/components/ProfileSelect";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { ConnectionPayload } from "../../types";
import { useCoverageProfiles } from "./useCoverageProfiles";
import styles from "./CoverageConnectionForm.module.css";

interface CoverageConnectionFormProps {
  connection: ConnectionPayload;
  canSubmit: boolean;
  onFieldChange: (field: keyof ConnectionPayload, value: string) => void;
  onProfileLoaded: (values: Partial<Omit<ConnectionPayload, "password">>) => void;
  onSubmit: () => void;
}

/** Host, port, database, user and password. The password lives in memory only and is never saved with a profile. */
export const CoverageConnectionForm: React.FC<CoverageConnectionFormProps> = ({
  connection,
  canSubmit,
  onFieldChange,
  onProfileLoaded,
  onSubmit,
}) => {
  const { profiles, activeProfileId, selectProfile, saveProfile } = useCoverageProfiles();

  const handleSelectProfile = (profileId: string) => {
    const profile = selectProfile(profileId);
    if (!profile) return;
    onProfileLoaded({ host: profile.host, port: profile.port, db_name: profile.db_name, user: profile.user });
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <ProfileSelect profiles={profiles} activeProfileId={activeProfileId} onSelectProfile={handleSelectProfile} />

      <div className={styles.fieldGrid}>
        <FormField
          label="Servidor"
          icon={Server}
          value={connection.host}
          onChange={(value) => onFieldChange("host", value)}
          placeholder="localhost"
        />
        <FormField
          label="Puerto"
          type="number"
          value={connection.port}
          onChange={(value) => onFieldChange("port", value)}
          placeholder="5432"
        />
        <FormField
          label="Base de datos"
          icon={Database}
          value={connection.db_name}
          onChange={(value) => onFieldChange("db_name", value)}
        />
        <FormField
          label="Usuario"
          icon={User}
          value={connection.user}
          onChange={(value) => onFieldChange("user", value)}
        />
        <FormField
          label="Contraseña"
          icon={Lock}
          type="password"
          value={connection.password}
          onChange={(value) => onFieldChange("password", value)}
        />
      </div>

      <div className={styles.actions}>
        <Button type="button" variant={ButtonVariant.SECONDARY} onClick={() => saveProfile(connection)}>
          <Save size={15} />
          Guardar perfil
        </Button>
        <Button type="submit" isDisabled={!canSubmit}>
          Continuar
          <ArrowRight size={15} />
        </Button>
      </div>
    </form>
  );
};
