import React, { useState } from "react";
import { Copy, Check, Download, FileCode } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { SqlPatchDrawerProps } from "@/types/comparison";
import styles from "./SqlPatchDrawer.module.css";

export const SqlPatchDrawer: React.FC<SqlPatchDrawerProps> = ({
  sqlScript,
  tableName,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sqlScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback if clipboard API fails
      setCopied(false);
    }
  };

  const handleDownload = () => {
    const blob = new Blob([sqlScript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `patch_${tableName}_${new Date().toISOString().slice(0, 10)}.sql`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <FileCode size={20} className={styles.icon} />
          <div>
            <h3 className={styles.title}>Parche de Actualización SQL (PostGIS)</h3>
            <p className={styles.subtitle}>
              Sentencias SQL generadas para aplicar las correcciones de atributos en la base de datos.
            </p>
          </div>
        </div>

        <div className={styles.actionButtons}>
          <Button variant="secondary" onClick={handleCopy} type="button">
            {copied ? <Check size={16} color="var(--accent-emerald)" /> : <Copy size={16} />}
            <span>{copied ? "¡Copiado!" : "Copiar SQL"}</span>
          </Button>

          <Button variant="primary" onClick={handleDownload} type="button">
            <Download size={16} />
            <span>Descargar Script .sql</span>
          </Button>
        </div>
      </div>

      <div className={styles.codeBox}>
        <pre className={styles.codeContent}>{sqlScript}</pre>
      </div>
    </div>
  );
};
