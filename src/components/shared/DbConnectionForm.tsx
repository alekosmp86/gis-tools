import React, { useImperativeHandle } from "react";
import {
  Database,
  Server,
  User,
  Key,
  Table,
  Layers,
  Loader2,
  Save,
  Trash2,
  Bookmark,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { ColumnsList } from "@/components/shared/ColumnsList";
import { ProfileSelect } from "@/components/shared/ProfileSelect";
import { useDbConnectionForm } from "@/hooks/useDbConnectionForm";
import type {
  DbConfig,
  DbColumnMetadata,
  DbConnectionFormRef,
  DbConnectionStatusPayload,
} from "@/types/db";
import styles from "./DbConnectionForm.module.css";

export interface DbConnectionFormProps {
  onSuccess: (
    config: DbConfig,
    columns: string[],
    totalRows: number,
    columnDetails?: DbColumnMetadata[]
  ) => void;
  onStatusChange?: (status: DbConnectionStatusPayload) => void;
}

export const DbConnectionForm = React.forwardRef<DbConnectionFormRef, DbConnectionFormProps>(
  ({ onSuccess, onStatusChange }, ref) => {
    const {
      config,
      statusMessage,
      columnsLoaded,
      totalRowsLoaded,
      isConnected,
      savedProfiles,
      activeProfileId,
      profileNameInput,
      isPending,
      setProfileNameInput,
      handleChange,
      handleSelectProfile,
      handleResetForm,
      handleConnectAndFetchColumns,
      handleSaveNewProfile,
      handleUpdateActiveProfile,
      handleDeleteProfile,
      handleProceed,
    } = useDbConnectionForm(onSuccess, onStatusChange);

    useImperativeHandle(ref, () => ({
      proceed: handleProceed,
    }), [handleProceed]);

    return (
      <div className={styles.formContainer}>
        {/* Profiles Dropdown Bar */}
        {savedProfiles.length > 0 && (
          <div className={styles.profilesBar}>
            <div className={styles.profilesLabel}>
              <Bookmark size={15} color="var(--accent-cyan)" />
              <span>Perfiles guardados:</span>
            </div>

            <div className={styles.profilesControls}>
              <ProfileSelect
                profiles={savedProfiles}
                activeProfileId={activeProfileId}
                onSelectProfile={handleSelectProfile}
              />

              {activeProfileId ? (
                <Button
                  variant="ghost"
                  onClick={() => handleDeleteProfile(activeProfileId)}
                  type="button"
                  title="Eliminar este perfil de almacenamiento local"
                  aria-label="Eliminar perfil"
                >
                  <Trash2 size={16} color="var(--accent-rose)" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  onClick={handleResetForm}
                  type="button"
                  title="Limpiar formulario para una nueva conexión"
                >
                  <Plus size={14} />
                  <span>Limpiar campos</span>
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Inputs Grid */}
        <div className={styles.inputGrid}>
          <FormField
            label="Host / Servidor"
            icon={Server}
            value={config.host}
            onChange={(value) => handleChange("host", value)}
            placeholder="localhost"
          />

          <FormField
            label="Puerto"
            icon={Server}
            value={config.port}
            onChange={(value) => handleChange("port", value)}
            placeholder="5432"
          />

          <FormField
            label="Nombre de Base de Datos"
            icon={Database}
            value={config.db_name}
            onChange={(value) => handleChange("db_name", value)}
            placeholder="ej. sig_db"
          />

          <FormField
            label="Usuario"
            icon={User}
            value={config.user}
            onChange={(value) => handleChange("user", value)}
            placeholder="postgres"
          />

          <FormField
            label="Contraseña (no se guarda)"
            icon={Key}
            type="password"
            value={config.password || ""}
            onChange={(value) => handleChange("password", value)}
            placeholder="••••••••"
          />

          <FormField
            label="Esquema (Schema)"
            icon={Layers}
            value={config.schema_name}
            onChange={(value) => handleChange("schema_name", value)}
            placeholder="public"
          />

          <FormField
            label="Nombre de la Tabla"
            icon={Table}
            value={config.table_name}
            onChange={(value) => handleChange("table_name", value)}
            placeholder="ej. parcelas_catastro, rutas_nacionales"
            isFullWidth
          />
        </div>

        {/* Manual Profile Save Bar */}
        <div className={styles.prefRow}>
          <span className={styles.saveSectionTitle}>Guardar perfil en este equipo:</span>

          <div className={styles.saveProfileGroup}>
            <input
              type="text"
              placeholder="Nombre del perfil (ej. Catastro Local)"
              value={profileNameInput}
              onChange={(event) => setProfileNameInput(event.target.value)}
              className={styles.profileNameInput}
              aria-label="Nombre del perfil de conexión"
            />

            <Button variant="ghost" onClick={handleSaveNewProfile} type="button" title="Guardar como un nuevo perfil separado">
              <Plus size={14} />
              <span>Guardar como nuevo</span>
            </Button>

            {activeProfileId && (
              <Button variant="ghost" onClick={handleUpdateActiveProfile} type="button" title="Actualizar datos del perfil seleccionado actualmente">
                <Save size={14} />
                <span>Actualizar activo</span>
              </Button>
            )}
          </div>
        </div>

        {/* Primary Connect & Fetch Action */}
        <div className={styles.actionsRow}>
          <Button variant="primary" onClick={handleConnectAndFetchColumns} isDisabled={isPending}>
            {isPending ? <Loader2 size={16} className={styles.spin} /> : <Database size={16} />}
            <span>Conectar y Obtener Columnas</span>
          </Button>
        </div>

        {/* Status Alert Message */}
        {statusMessage && (
          <AlertMessage type={statusMessage.type} text={statusMessage.text} />
        )}

        {/* Reusable Columns Display */}
        {isConnected && columnsLoaded.length > 0 && (
          <div className={styles.columnsPreviewSection}>
            <ColumnsList
              columns={columnsLoaded}
              totalRows={totalRowsLoaded}
              title="Columnas Disponibles en Base de Datos"
            />
          </div>
        )}
      </div>
    );
  }
);

DbConnectionForm.displayName = "DbConnectionForm";
