import React from "react";
import { Play, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import styles from "./SqlPatchDrawer.module.css";

export interface SqlPatchExecuteButtonProps {
  disabled: boolean;
  isLoading: boolean;
  onClick: () => void;
}

/**
 * Standard button variant to trigger database SQL execution.
 */
export const SqlPatchExecuteButton: React.FC<SqlPatchExecuteButtonProps> = ({
  disabled,
  isLoading,
  onClick,
}) => {
  return (
    <Button
      variant="primary"
      onClick={onClick}
      type="button"
      disabled={disabled || isLoading}
      title={
        disabled
          ? "No hay sentencias SQL para ejecutar en este script"
          : "Ejecutar sentencias en la base de datos"
      }
    >
      {isLoading ? (
        <>
          <Loader2 size={16} className={styles.spin} />
          <span>Generando...</span>
        </>
      ) : (
        <>
          <Play size={16} />
          <span>Ejecutar en BD</span>
        </>
      )}
    </Button>
  );
};

/**
 * Explicit variant rendered when the script in the current tab has already been executed.
 */
export const SqlPatchExecutedButton: React.FC = () => {
  return (
    <Button
      variant="primary"
      type="button"
      disabled
      title="El script ya ha sido ejecutado con éxito"
    >
      <CheckCircle2 size={16} color="var(--accent-emerald)" />
      <span>Script Ejecutado</span>
    </Button>
  );
};
