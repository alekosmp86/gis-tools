import React, { useState } from "react";
import { Database, Lock, Eye, EyeOff, X, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { DbConfig } from "@/types/db";
import type { SqlScriptType } from "@/types/comparison";
import styles from "./SqlExecutionModal.module.css";

interface SqlExecutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmExecute: (password: string) => Promise<void>;
  dbConfig: DbConfig;
  scriptType: SqlScriptType;
  statementCount: number;
}

export const SqlExecutionModal: React.FC<SqlExecutionModalProps> = ({
  isOpen,
  onClose,
  onConfirmExecute,
  dbConfig,
  scriptType,
  statementCount,
}) => {
  const [passwordInput, setPasswordInput] = useState<string>(dbConfig.password || "");
  const [showPassword, setShowPassword] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;

    const password = passwordInput;
    onClose();
    onConfirmExecute(password);
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <div className={styles.titleGroup}>
            <div className={styles.headerIcon}>
              <Database size={22} />
            </div>
            <div>
              <h3 className={styles.title}>Confirmación de Ejecución en Base de Datos</h3>
              <p className={styles.subtitle}>
                Autentique y confirme la ejecución directa de sentencias SQL PostGIS.
              </p>
            </div>
          </div>

          <button
            type="button"
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Cerrar modal"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {/* Connection Information Summary */}
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
                  Script {scriptType} &bull; {statementCount.toLocaleString("es-UY")} sentencias
                </span>
              </div>
            </div>

            {/* Password Input Field */}
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
                  onChange={(e) => setPasswordInput(e.target.value)}
                  placeholder="Ingrese su contraseña de PostgreSQL"
                  className={styles.passwordInput}
                  required
                  autoFocus
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  className={styles.toggleEyeBtn}
                  title={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {/* Safety Notice */}
            <div className={styles.noticeAlert}>
              <ShieldAlert size={18} className={styles.noticeIcon} />
              <div>
                <strong>Ejecución Segura en Transacción aislada:</strong> Las sentencias se ejecutarán bajo un bloque <code>BEGIN; ... COMMIT;</code>. Si ocurre algún error en cualquier registro, se realizará un <code>ROLLBACK;</code> automático para proteger la base de datos.
              </div>
            </div>
          </div>

          <div className={styles.modalFooter}>
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
            >
              Cancelar
            </Button>

            <Button
              type="submit"
              variant="primary"
              disabled={!passwordInput.trim()}
            >
              <Database size={16} />
              <span>Confirmar y Ejecutar en BD</span>
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};
