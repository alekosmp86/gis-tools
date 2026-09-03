import React from "react";
import { Zap } from "lucide-react";
import { formatNumber } from "@/utils/common/ValueFormatter";
import styles from "./SqlPatchDrawer.module.css";

export interface SqlPatchPreviewBoxProps {
  previewScript: string;
  isTruncated: boolean;
  statementCount: number;
  maxPreviewLines?: number;
}

export const SqlPatchPreviewBox: React.FC<SqlPatchPreviewBoxProps> = ({
  previewScript,
  isTruncated,
  statementCount,
  maxPreviewLines = 25,
}) => {
  return (
    <>
      {isTruncated && (
        <div className={styles.truncatedNotice}>
          <Zap size={15} />
          <span>
            Mostrando vista previa de las primeras {maxPreviewLines} sentencias (de {formatNumber(statementCount)} totales) para mantener la máxima velocidad. El script completo se mantendrá intacto al Copiar, Descargar (.sql) o Ejecutar en BD.
          </span>
        </div>
      )}

      <div className={styles.codeBox}>
        <pre className={styles.codeContent}>{previewScript}</pre>
      </div>
    </>
  );
};
