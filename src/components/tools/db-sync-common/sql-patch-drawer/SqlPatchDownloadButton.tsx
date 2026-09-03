import React from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import styles from "./SqlPatchDrawer.module.css";

export interface SqlPatchDownloadButtonProps {
  disabled: boolean;
  isLoading: boolean;
  onClick: () => void;
}

export const SqlPatchDownloadButton: React.FC<SqlPatchDownloadButtonProps> = ({
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
      ) : (
        <Download size={16} />
      )}
      <span>{isLoading ? "Generando..." : "Descargar .sql"}</span>
    </Button>
  );
};
