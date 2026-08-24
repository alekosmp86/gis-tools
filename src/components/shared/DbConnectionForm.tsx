import React from "react";
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
  ShieldCheck,
  ArrowRight,
  Bookmark,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { ColumnsList } from "@/components/shared/ColumnsList";
import { useDbConnectionForm } from "@/hooks/useDbConnectionForm";
import type { DbConnectionFormProps } from "@/types/db";
import styles from "./DbConnectionForm.module.css";

export const DbConnectionForm: React.FC<DbConnectionFormProps> = ({ onSuccess }) => {
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
  } = useDbConnectionForm(onSuccess);

  return (
    <div className={`glass-panel ${styles.formContainer}`}>
      <div className={styles.header}>
        <div className={styles.headerIcon}>
          <Database size={24} />
        </div>
        <div className={styles.headerTitleRow}>
          <div>
            <h2 className={styles.title}>1. Conectar a Base de Datos PostgreSQL</h2>
            <p className={styles.subtitle}>
              Ingrese las credenciales para conectar a la base de datos e inspeccionar la tabla seleccionada.
            </p>
          </div>

          {savedProfiles.length > 0 && (
            <div className={styles.savedNotice}>
              <ShieldCheck size={14} color="var(--accent-emerald)" />
              <span>{savedProfiles.length} {savedProfiles.length === 1 ? "perfil guardado" : "perfiles guardados"}</span>
            </div>
          )}
        </div>
      </div>

      {/* Profiles Dropdown Bar */}
      {savedProfiles.length > 0 && (
        <div className={styles.profilesBar}>
          <div className={styles.profilesLabel}>
            <Bookmark size={15} color="var(--accent-cyan)" />
            <span>Perfiles guardados:</span>
          </div>

          <div className={styles.profilesControls}>
            <select
              value={activeProfileId}
              onChange={(e) => handleSelectProfile(e.target.value)}
              className={styles.profileSelect}
              aria-label="Cargar perfil guardado"
            >
              <option value="">➕ Nueva conexión (ingresar datos vacíos)...</option>
              {savedProfiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  📌 {profile.name}
                </option>
              ))}
            </select>

            {activeProfileId ? (
              <Button
                variant="ghost"
                onClick={() => handleDeleteProfile(activeProfileId)}
                type="button"
                title="Eliminar este perfil de almacenamiento local"
              >
                <Trash2 size={15} color="var(--accent-rose)" />
                <span className={styles.deleteBtnText}>Eliminar perfil</span>
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
          onChange={(val) => handleChange("host", val)}
          placeholder="localhost"
        />

        <FormField
          label="Puerto"
          icon={Server}
          value={config.port}
          onChange={(val) => handleChange("port", val)}
          placeholder="5432"
        />

        <FormField
          label="Nombre de Base de Datos"
          icon={Database}
          value={config.db_name}
          onChange={(val) => handleChange("db_name", val)}
          placeholder="ej. sig_db"
        />

        <FormField
          label="Usuario"
          icon={User}
          value={config.user}
          onChange={(val) => handleChange("user", val)}
          placeholder="postgres"
        />

        <FormField
          label="Contraseña (no se guarda)"
          icon={Key}
          type="password"
          value={config.password || ""}
          onChange={(val) => handleChange("password", val)}
          placeholder="••••••••"
        />

        <FormField
          label="Esquema (Schema)"
          icon={Layers}
          value={config.schema_name}
          onChange={(val) => handleChange("schema_name", val)}
          placeholder="public"
        />

        <FormField
          label="Nombre de la Tabla"
          icon={Table}
          value={config.table_name}
          onChange={(val) => handleChange("table_name", val)}
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
            onChange={(e) => setProfileNameInput(e.target.value)}
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

      {/* Reusable Columns Display & Proceed Step Button in Parent UI */}
      {isConnected && columnsLoaded.length > 0 && (
        <div className={styles.columnsPreviewSection}>
          <ColumnsList
            columns={columnsLoaded}
            totalRows={totalRowsLoaded}
            title="Columnas Disponibles en Base de Datos"
          />

          <div className={styles.proceedArea}>
            <Button variant="primary" onClick={handleProceed}>
              <span>Continuar al Paso 2</span>
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
