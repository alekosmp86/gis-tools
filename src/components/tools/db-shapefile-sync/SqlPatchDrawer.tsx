import React, { useState } from "react";
import { Copy, Check, Download, FileCode, RefreshCw, PlusSquare } from "lucide-react";
import { Button } from "@/components/ui/Button";
import type { SqlPatchDrawerProps } from "@/types/comparison";
import styles from "./SqlPatchDrawer.module.css";

const ScriptTab = {
  UPDATE: "UPDATE",
  INSERT: "INSERT",
} as const;

type ScriptTab = (typeof ScriptTab)[keyof typeof ScriptTab];

export const SqlPatchDrawer: React.FC<SqlPatchDrawerProps> = ({
  sqlUpdateScript,
  sqlInsertScript,
  tableName,
}) => {
  const [activeTab, setActiveTab] = useState<ScriptTab>(ScriptTab.UPDATE);
  const [copied, setCopied] = useState(false);

  const activeScript = activeTab === ScriptTab.UPDATE ? sqlUpdateScript : sqlInsertScript;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(activeScript);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  const handleDownload = () => {
    const suffix = activeTab === ScriptTab.UPDATE ? "update" : "insert";
    const blob = new Blob([activeScript], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${suffix}_${tableName}_${new Date().toISOString().slice(0, 10)}.sql`;
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
            <h3 className={styles.title}>Scripts SQL PostGIS</h3>
            <p className={styles.subtitle}>
              Seleccione el tipo de script a visualizar, copiar o descargar.
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
            <span>Descargar .sql</span>
          </Button>
        </div>
      </div>

      {/* Script Type Tabs */}
      <div className={styles.scriptTabs}>
        <button
          type="button"
          className={`${styles.scriptTabBtn} ${activeTab === ScriptTab.UPDATE ? styles.scriptTabActive : ""}`}
          onClick={() => { setActiveTab(ScriptTab.UPDATE); setCopied(false); }}
        >
          <RefreshCw size={15} />
          <span>Script UPDATE</span>
          <span className={styles.scriptTabHint}>Corregir atributos existentes</span>
        </button>

        <button
          type="button"
          className={`${styles.scriptTabBtn} ${activeTab === ScriptTab.INSERT ? styles.scriptTabInsert : ""} ${activeTab === ScriptTab.INSERT ? styles.scriptTabActive : ""}`}
          onClick={() => { setActiveTab(ScriptTab.INSERT); setCopied(false); }}
        >
          <PlusSquare size={15} />
          <span>Script INSERT</span>
          <span className={styles.scriptTabHint}>Agregar registros faltantes</span>
        </button>
      </div>

      <div className={styles.codeBox}>
        <pre className={styles.codeContent}>{activeScript}</pre>
      </div>
    </div>
  );
};
