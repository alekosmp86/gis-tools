"use client";

import React from "react";
import { Database, Loader2, Save, Search, User, Lock, Server, MapPin } from "lucide-react";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { Button } from "@/ui-kit/components/ui/Button";
import { ProfileSelect } from "@/ui-kit/components/ProfileSelect";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { DbConfig } from "@/core/types/db";
import { useDedupProfiles } from "./useDedupProfiles";
import styles from "./DedupConnectionForm.module.css";

interface DedupConnectionFormProps {
  config: DbConfig;
  provinceId: string;
  isSubmitting: boolean;
  onConfigChange: (field: keyof DbConfig, value: string) => void;
  onProfileLoaded: (config: Partial<DbConfig>) => void;
  onProvinceChange: (value: string) => void;
  onSubmit: () => void;
  children?: React.ReactNode;
}

export const DedupConnectionForm: React.FC<DedupConnectionFormProps> = ({
  config,
  provinceId,
  isSubmitting,
  onConfigChange,
  onProfileLoaded,
  onProvinceChange,
  onSubmit,
  children,
}) => {
  const { profiles, activeProfileId, selectProfile, saveProfile } = useDedupProfiles();

  const handleSelectProfile = (profileId: string) => {
    const profileConfig = selectProfile(profileId);
    onProfileLoaded(profileConfig ? { ...profileConfig, password: "" } : {});
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit();
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <ProfileSelect
        profiles={profiles}
        activeProfileId={activeProfileId}
        onSelectProfile={handleSelectProfile}
      />

      <div className={styles.fieldGrid}>
        <FormField
          label="Servidor"
          icon={Server}
          value={config.host}
          onChange={(value) => onConfigChange("host", value)}
          placeholder="localhost"
        />
        <FormField
          label="Puerto"
          type="number"
          value={config.port}
          onChange={(value) => onConfigChange("port", value)}
          placeholder="5432"
        />
        <FormField
          label="Base de datos"
          icon={Database}
          value={config.db_name}
          onChange={(value) => onConfigChange("db_name", value)}
        />
        <FormField
          label="Usuario"
          icon={User}
          value={config.user}
          onChange={(value) => onConfigChange("user", value)}
        />
        <FormField
          label="Contraseña"
          icon={Lock}
          type="password"
          value={config.password ?? ""}
          onChange={(value) => onConfigChange("password", value)}
        />
        <FormField
          label="Id de provincia"
          icon={MapPin}
          type="number"
          value={provinceId}
          onChange={onProvinceChange}
          placeholder="7"
        />
      </div>

      {children}

      <div className={styles.actions}>
        <Button type="button" variant={ButtonVariant.SECONDARY} onClick={() => saveProfile(config)}>
          <Save size={15} />
          Guardar perfil
        </Button>
        <Button type="submit" isDisabled={isSubmitting}>
          {isSubmitting ? <Loader2 size={15} className={styles.spin} /> : <Search size={15} />}
          {isSubmitting ? "Analizando..." : "Analizar duplicados"}
        </Button>
      </div>
    </form>
  );
};
