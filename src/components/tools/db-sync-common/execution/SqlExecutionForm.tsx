import React from "react";
import { Lock, Eye, EyeOff, ShieldCheck, AlertTriangle, Database } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { formatNumber } from "@/utils/formatters";
import type { DbConfig } from "@/types/db";
import styles from "../SqlExecutionModal.module.css";

export interface SqlExecutionFormProps {
  dbConfig: DbConfig;
  scriptType: string;
  statementCount: number;
  passwordInput: string;
  showPassword: boolean;
  generalError: string | null;
  onPasswordChange: (value: string) => void;
  onToggleShowPassword: () => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export const SqlExecutionForm: React.FC<SqlExecutionFormProps> = ({
  dbConfig,
  scriptType,
  statementCount,
  passwordInput,
  showPassword,
  generalError,
  onPasswordChange,
  onToggleShowPassword,
  onSubmit,
  onCancel,
}) => {
  return (
    <form onSubmit={onSubmit}>
      <div className={styles.modalBody}>
        {/* Info Grid */}
        <div className={styles.infoGrid}>
          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Servidor / Base de Datos</span>
            <span className={styles.infoValue}>
              {dbConfig.host}:{dbConfig.port} / {dbConfig.db_name}
            </span>
          </div>

          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Tabla Objetivo</span>
            <span className={styles.infoValue}>
              {dbConfig.schema_name}.{dbConfig.table_name}
            </span>
          </div>

          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Usuario PostgreSQL</span>
            <span className={styles.infoValue}>{dbConfig.user}</span>
          </div>

          <div className={styles.infoCard}>
            <span className={styles.infoLabel}>Script a Ejecutar</span>
            <span className={styles.scriptBadge} data-tab={scriptType}>
              Script {scriptType} &bull; {formatNumber(statementCount)} sentencias
            </span>
          </div>
        </div>

        {/* Password Input */}
        <div className={styles.formGroup}>
          <label htmlFor="dbPasswordInput" className={styles.formLabel}>
            <Lock size={15} />
            <span>Contraseña de PostgreSQL</span>
          </label>

          <div className={styles.passwordInputWrapper}>
            <input
              id="dbPasswordInput"
              type={showPassword ? "text" : "password"}
              value={passwordInput}
              onChange={(e) => onPasswordChange(e.target.value)}
              placeholder="Ingrese su contraseña de PostgreSQL"
              className={styles.passwordInput}
              required
              autoFocus
            />
            <button
              type="button"
              onClick={onToggleShowPassword}
              className={styles.toggleEyeBtn}
              title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        {/* Error Alert */}
        {generalError && (
          <div className={`${styles.summaryAlert} ${styles.summaryAlertWarning}`}>
            <AlertTriangle size={18} />
            <span>{generalError}</span>
          </div>
        )}

        {/* Security Notice */}
        <div className={styles.noticeAlert}>
          <ShieldCheck size={18} className={styles.noticeIcon} />
          <div>
            <strong>Ejecución Progresiva por Lotes (500 por lote):</strong> Las sentencias se
            confirmarán en bloques de 500 registros. Si un lote presenta algún error, los lotes
            restantes continuarán ejecutándose sin anular los ya guardados.
          </div>
        </div>
      </div>

      <div className={styles.modalFooter}>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancelar
        </Button>

        <Button type="submit" variant="primary" disabled={!passwordInput.trim()}>
          <Database size={16} />
          <span>Iniciar Ejecución por Lotes</span>
        </Button>
      </div>
    </form>
  );
};
