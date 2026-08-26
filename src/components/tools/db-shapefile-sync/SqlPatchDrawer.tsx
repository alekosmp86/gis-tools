import React, { useState } from "react";
import { Copy, Check, Download, FileCode, RefreshCw, PlusSquare, Play } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { AlertMessage } from "@/components/shared/AlertMessage";
import { SqlExecutionModal } from "./SqlExecutionModal";
import { executeSqlScript } from "@/services/dbExecutionService";
import { SqlScriptType } from "@/types/comparison";
import type { SqlPatchDrawerProps } from "@/types/comparison";
import { AlertType } from "@/types/ui";
import styles from "./SqlPatchDrawer.module.css";

export const SqlPatchDrawer: React.FC<SqlPatchDrawerProps> = ({
  sqlUpdateScript,
  sqlInsertScript,
  tableName,
  dbConfig,
}) => {
  const [activeTab, setActiveTab] = useState<SqlScriptType>(SqlScriptType.UPDATE);
  const [copied, setCopied] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionResult, setExecutionResult] = useState<{
    type: AlertType;
    text: string;
  } | null>(null);

  const activeScript = activeTab === SqlScriptType.UPDATE ? sqlUpdateScript : sqlInsertScript;
  const statementCount = (activeScript.match(/;/g) || []).length || (activeScript.trim() ? 1 : 0);

  const handleCopy = () => {
    navigator.clipboard
      .writeText(activeScript)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      })
      .catch(() => {
        setCopied(false);
      });
  };

  const handleDownload = () => {
    const suffix = activeTab === SqlScriptType.UPDATE ? "update" : "insert";
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

  const handleConfirmExecute = (passwordInput: string): Promise<void> => {
    setExecuting(true);
    setExecutionResult(null);

    return executeSqlScript(dbConfig, passwordInput, activeScript)
      .then((res) => {
        setExecutionResult({
          type: AlertType.SUCCESS,
          text: res.message || `Ejecución exitosa. ${res.affectedRows || 0} registros modificados/insertados.`,
        });
      })
      .catch((err: unknown) => {
        const errMsg = err instanceof Error ? err.message : "Error al ejecutar en la base de datos.";
        setExecutionResult({
          type: AlertType.ERROR,
          text: errMsg,
        });
        throw err;
      })
      .finally(() => {
        setExecuting(false);
      });
  };

  return (
    <div className={styles.container}>
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
          <Button variant="secondary" onClick={handleCopy} type="button" disabled={executing}>
            {copied ? <Check size={16} color="var(--accent-emerald)" /> : <Copy size={16} />}
            <span>{copied ? "¡Copiado!" : "Copiar SQL"}</span>
          </Button>

          <Button variant="secondary" onClick={handleDownload} type="button" disabled={executing}>
            <Download size={16} />
            <span>Descargar .sql</span>
          </Button>

          <Button
            variant="primary"
            onClick={() => setIsModalOpen(true)}
            type="button"
            disabled={!activeScript.trim() || executing}
          >
            <Play size={16} />
            <span>Ejecutar en BD</span>
          </Button>
        </div>
      </div>

      {/* Execution Feedback Alert */}
      {executionResult && (
        <div style={{ marginTop: "16px" }}>
          <AlertMessage type={executionResult.type} text={executionResult.text} />
        </div>
      )}

      {/* Script Type Tabs */}
      <div className={styles.scriptTabs}>
        <button
          type="button"
          className={`${styles.scriptTabBtn} ${activeTab === SqlScriptType.UPDATE ? styles.scriptTabActive : ""}`}
          onClick={() => {
            setActiveTab(SqlScriptType.UPDATE);
            setCopied(false);
            setExecutionResult(null);
          }}
        >
          <RefreshCw size={15} />
          <span>Script UPDATE</span>
          <span className={styles.scriptTabHint}>Corregir atributos existentes</span>
        </button>

        <button
          type="button"
          className={`${styles.scriptTabBtn} ${activeTab === SqlScriptType.INSERT ? styles.scriptTabInsert : ""} ${activeTab === SqlScriptType.INSERT ? styles.scriptTabActive : ""}`}
          onClick={() => {
            setActiveTab(SqlScriptType.INSERT);
            setCopied(false);
            setExecutionResult(null);
          }}
        >
          <PlusSquare size={15} />
          <span>Script INSERT</span>
          <span className={styles.scriptTabHint}>Agregar registros faltantes</span>
        </button>
      </div>

      <div className={styles.codeBox}>
        <pre className={styles.codeContent}>{activeScript}</pre>
      </div>

      {/* Password & Execution Confirmation Modal */}
      <SqlExecutionModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onConfirmExecute={handleConfirmExecute}
        dbConfig={dbConfig}
        scriptType={activeTab}
        statementCount={statementCount}
      />
    </div>
  );
};
