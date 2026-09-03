import React from "react";
import { Copy, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import styles from "./SqlPatchDrawer.module.css";

export interface SqlPatchCopyButtonProps {
  copied: boolean;
  disabled: boolean;
  isLoading: boolean;
  onClick: () => void;
}

export const SqlPatchCopyButton: React.FC<SqlPatchCopyButtonProps> = ({
  copied,
  disabled,
  isLoading,
  onClick,
}) => {
  return (
    <Button
      variant="secondary"
      onClick={onClick}
      type="button"
      disabled={disabled || isLoading}
    >
      {isLoading ? (
        <Loader2 size={16} className={styles.spin} />
      ) : copied ? (
        <Check size={16} color="var(--accent-emerald)" />
      ) : (
        <Copy size={16} />
      )}
      <span>{isLoading ? "Generando..." : copied ? "¡Copiado!" : "Copiar SQL"}</span>
    </Button>
  );
};
