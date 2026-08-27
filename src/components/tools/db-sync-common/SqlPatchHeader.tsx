import React from "react";
import { FileCode, Copy, Check, Download, Play, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import styles from "./SqlPatchDrawer.module.css";

export interface SqlPatchHeaderProps {
  copied: boolean;
  executing: boolean;
  hasExecutableStatements: boolean;
  isCurrentTabExecuted: boolean;
  onCopy: () => void;
  onDownload: () => void;
  onOpenExecuteModal: () => void;
}

export const SqlPatchHeader: React.FC<SqlPatchHeaderProps> = ({
  copied,
  executing,
  hasExecutableStatements,
  isCurrentTabExecuted,
  onCopy,
  onDownload,
  onOpenExecuteModal,
}) => {
  return (
    <div className={styles.header}>
      <div className={styles.titleGroup}>
        <FileCode size={20} className={styles.icon} />
        <div>
          <h3 className={styles.title}>Scripts SQL PostGIS</h3>
          <p className={styles.subtitle}>
            Seleccione el tipo de script a visualizar, copiar, descargar o ejecutar directamente.
          </p>
        </div>
      </div>

      <div className={styles.actionButtons}>
        <Button variant="secondary" onClick={onCopy} type="button" disabled={executing}>
          {copied ? <Check size={16} color="var(--accent-emerald)" /> : <Copy size={16} />}
          <span>{copied ? "¡Copiado!" : "Copiar SQL"}</span>
        </Button>

        <Button variant="secondary" onClick={onDownload} type="button" disabled={executing}>
          <Download size={16} />
          <span>Descargar .sql</span>
        </Button>

        <Button
          variant="primary"
          onClick={onOpenExecuteModal}
          type="button"
          disabled={!hasExecutableStatements || executing || isCurrentTabExecuted}
          title={
            !hasExecutableStatements
              ? "No hay sentencias SQL para ejecutar en este script"
              : isCurrentTabExecuted
              ? "El script ya ha sido ejecutado con éxito"
              : "Ejecutar sentencias en la base de datos"
          }
        >
          {isCurrentTabExecuted ? (
            <>
              <CheckCircle2 size={16} color="var(--accent-emerald)" />
              <span>Script Ejecutado</span>
            </>
          ) : (
            <>
              <Play size={16} />
              <span>Ejecutar en BD</span>
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
