import React from "react";
import { Zap } from "lucide-react";
import styles from "./SqlPatchDrawer.module.css";

export interface SqlPatchPreviewBoxProps {
  previewScript: string;
  isTruncated: boolean;
  statementCount: number;
}

export const SqlPatchPreviewBox: React.FC<SqlPatchPreviewBoxProps> = ({
  previewScript,
  isTruncated,
  statementCount,
}) => {
  return (
    <>
      {isTruncated && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "0.85rem",
            color: "var(--accent-amber)",
            background: "rgba(245, 158, 11, 0.1)",
            padding: "8px 12px",
            borderRadius: "6px",
            marginBottom: "8px",
            border: "1px solid rgba(245, 158, 11, 0.2)",
          }}
        >
          <Zap size={15} />
          <span>
            Mostrando vista previa de las primeras 500 sentencias (de {statementCount.toLocaleString("es-ES")} totales) para mantener la máxima velocidad. El script completo se mantendrá intacto al Copiar, Descargar (.sql) o Ejecutar en BD.
          </span>
        </div>
      )}

      <div className={styles.codeBox}>
        <pre className={styles.codeContent}>{previewScript}</pre>
      </div>
    </>
  );
};
