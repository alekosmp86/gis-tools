import React from "react";
import { Eye, EyeOff, Globe, Lock } from "lucide-react";
import { parseSourceSrid, type ShpReplaceWorkflow } from "./useShpReplaceWorkflow";
import { buildCrsHint } from "./shpCrsHint";
import styles from "./ShpReplaceFormFields.module.css";

export interface ShpReplaceFormFieldsProps {
  workflow: ShpReplaceWorkflow;
  prjText: string | undefined;
  targetUser: string;
}

const INVALID_SRID_HINT = "Ingrese un SRID entero entre 1 y 998999.";

export const ShpReplaceFormFields: React.FC<ShpReplaceFormFieldsProps> = ({ workflow, prjText, targetUser }) => {
  const isSridInvalid = workflow.sridText.trim() !== "" && parseSourceSrid(workflow.sridText) === null;
  return (
    <div className={styles.fields}>
      <div className={styles.formGroup}>
        <label htmlFor="shpReplaceSridInput" className={styles.formLabel}>
          <Globe size={15} />
          <span>SRID de origen</span>
        </label>
        <input
          id="shpReplaceSridInput"
          type="number"
          inputMode="numeric"
          step={1}
          min={1}
          value={workflow.sridText}
          onChange={(event) => workflow.setSridText(event.target.value)}
          placeholder="Ej. 32721"
          className={`${styles.input} ${isSridInvalid ? styles.inputInvalid : ""}`}
          autoComplete="off"
        />
        <span className={isSridInvalid ? styles.errorHint : styles.hint}>
          {isSridInvalid ? INVALID_SRID_HINT : buildCrsHint(prjText)}
        </span>
      </div>

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={workflow.resetSequences}
          onChange={(event) => workflow.setResetSequences(event.target.checked)}
        />
        <span>Reiniciar secuencias del destino</span>
      </label>

      <div className={styles.formGroup}>
        <label htmlFor="shpReplaceConfirmInput" className={styles.formLabel}>
          <span>
            Para confirmar, escriba <code className={styles.code}>{workflow.confirmText}</code>
          </span>
        </label>
        <input
          id="shpReplaceConfirmInput"
          type="text"
          value={workflow.confirmValue}
          onChange={(event) => workflow.setConfirmValue(event.target.value)}
          placeholder={workflow.confirmText}
          className={`${styles.input} ${styles.inputDanger}`}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="shpReplacePasswordInput" className={styles.formLabel}>
          <Lock size={15} />
          <span>Contraseña de PostgreSQL del destino ({targetUser})</span>
        </label>
        <div className={styles.inputWrapper}>
          <input
            id="shpReplacePasswordInput"
            type={workflow.showPassword ? "text" : "password"}
            value={workflow.password}
            onChange={(event) => workflow.setPassword(event.target.value)}
            placeholder="Ingrese su contraseña de PostgreSQL"
            className={styles.input}
            autoComplete="off"
          />
          <button
            type="button"
            onClick={workflow.toggleShowPassword}
            className={styles.toggleEyeBtn}
            title={workflow.showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-label={workflow.showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
          >
            {workflow.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
};
