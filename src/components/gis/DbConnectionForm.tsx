import React from "react";
import { Database, Server, User, Key, Table, Layers, Loader2, Save, Trash2, ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "../ui/Button";
import { FormField } from "../ui/FormField";
import { AlertMessage } from "../shared/AlertMessage";
import { ColumnsList } from "../shared/ColumnsList";
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
    hasSavedConfig,
    autoSave,
    isPending,
    setAutoSave,
    handleChange,
    handleConnectAndFetchColumns,
    handleSaveConfigManual,
    handleClearSavedConfig,
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

          {hasSavedConfig && (
            <div className={styles.savedNotice}>
              <ShieldCheck size={14} color="var(--accent-emerald)" />
              <span>Configuración guardada activa</span>
            </div>
          )}
        </div>
      </div>

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

      {/* LocalStorage Preference Controls */}
      <div className={styles.prefRow}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={autoSave}
            onChange={(e) => setAutoSave(e.target.checked)}
          />
          <span>Recordar esta configuración en este equipo (excepto contraseña)</span>
        </label>

        <div className={styles.storageButtons}>
          <Button variant="ghost" onClick={handleSaveConfigManual} type="button">
            <Save size={14} />
            <span>Guardar ahora</span>
          </Button>

          {hasSavedConfig && (
            <Button variant="ghost" onClick={handleClearSavedConfig} type="button">
              <Trash2 size={14} color="var(--accent-rose)" />
              <span style={{ color: "var(--accent-rose)" }}>Borrar guardada</span>
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
              <span>Continuar al Paso 2: Cargar Shapefile</span>
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
