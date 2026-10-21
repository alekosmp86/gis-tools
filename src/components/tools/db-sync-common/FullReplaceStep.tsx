import React from "react";
import { AlertTriangle, Eye, EyeOff, Lock, ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { buildQualifiedTableLabel } from "@/core/services/sqlStatements";
import { describeDbServer } from "@/core/services/fullReplaceRunStore";
import { FULL_REPLACE_BATCH_SIZE } from "@/core/services/fullReplaceService";
import {
  getIgnoredSourceColumns,
  resolveInsertColumns,
  type ReplaceColumnMapping,
} from "@/core/services/replaceColumnMapping";
import type { DbColumnMetadata, DbConfig } from "@/core/types/db";
import { useFullReplaceWorkflow } from "./useFullReplaceWorkflow";
import styles from "./FullReplaceStep.module.css";

export interface FullReplaceStepProps {
  sourceConfig: DbConfig | null;
  targetConfig: DbConfig | null;
  sourceColumns: string[];
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
  mapping: ReplaceColumnMapping;
}

export const FullReplaceStep: React.FC<FullReplaceStepProps> = ({
  sourceConfig,
  targetConfig,
  sourceColumns,
  targetColumns,
  targetDetails,
  mapping,
}) => {
  const workflow = useFullReplaceWorkflow({ sourceConfig, targetConfig, sourceColumns, targetColumns, targetDetails, mapping });

  if (!sourceConfig || !targetConfig) return null;

  const allSequences = workflow.sequenceDiscovery.sequences;
  const unmappedSequences = allSequences.filter((sequence) => !sequence.mapped);
  const ignored = getIgnoredSourceColumns(resolveInsertColumns(mapping, targetColumns), sourceColumns);

  return (
    <div className={styles.container}>
      <div className={styles.dangerBanner}>
        <AlertTriangle size={36} className={styles.dangerIcon} />
        <div className={styles.dangerContent}>
          <span className={styles.dangerTitle}>
            Acción destructiva: se eliminarán TODOS los registros de la tabla destino
          </span>
          <span className={styles.endpointLabel}>Tabla destino que será vaciada</span>
          <span className={styles.endpointServer}>{describeDbServer(targetConfig)}</span>
          <span className={styles.targetTable}>{workflow.confirmText}</span>
          <span className={styles.endpointLabel}>Se recargará desde la tabla origen</span>
          <span className={styles.endpointServer}>{describeDbServer(sourceConfig)}</span>
          <span className={styles.sourceTable}>
            {buildQualifiedTableLabel(sourceConfig.schema_name, sourceConfig.table_name)}
          </span>
        </div>
      </div>

      <div className={styles.notice}>
        <ShieldAlert size={18} className={styles.noticeIcon} />
        <span>
          <strong>No atómico:</strong> el vaciado y el primer lote de {FULL_REPLACE_BATCH_SIZE} sentencias se confirman
          juntos; si el primer lote falla, la tabla destino queda intacta. Si falla un lote posterior, la tabla destino
          quedará parcialmente cargada. Cerrar la pestaña, recargar la página o perder la conexión interrumpe la ejecución y puede dejar la tabla destino parcialmente cargada. Volver a ejecutar el reemplazo completo es seguro: vacía y recarga nuevamente.
        </span>
      </div>

      {ignored.length > 0 && (
        <AlertMessage
          type={AlertType.WARNING}
          text={`Columnas del origen sin mapear que se ignorarán: ${ignored.join(", ")}.`}
        />
      )}

      {allSequences.length > 0 && (
        <div className={styles.formGroup}>
          {unmappedSequences.length > 0 && (
            <>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={workflow.resetSequences}
                  onChange={(event) => workflow.setResetSequences(event.target.checked)}
                  disabled={workflow.isRunning}
                />
                <span>Reiniciar secuencias del destino</span>
              </label>
              <span className={styles.endpointLabel}>
                {workflow.resetSequences
                  ? `Se reiniciarán en 1: ${unmappedSequences.map((sequence) => sequence.qualifiedLabel).join(", ")}.`
                  : "Las secuencias del destino no se reiniciarán."}
              </span>
            </>
          )}
          <span className={styles.endpointLabel}>
            {`Se ajustarán tras el reemplazo: ${allSequences.map((sequence) => sequence.qualifiedLabel).join(", ")}.`}
          </span>
          <span className={styles.endpointLabel}>
            El reinicio en 1 solo aplica a ids generados por defecto (sin columna de origen). Las secuencias siempre se
            ajustan al terminar: el próximo id queda por encima del id más alto de la tabla y nunca por debajo de lo que
            la secuencia ya entregó, en cualquier fallo del reemplazo. Si otra tabla usa la misma secuencia, sus próximos
            ids colisionarán. El rol necesita permiso UPDATE sobre la secuencia (o ser propietario) y SELECT sobre la
            tabla destino (para calcular el id más alto); si el ajuste falla se informa como error. Para no reiniciar,
            conviene desmarcar esta opción.
          </span>
        </div>
      )}

      {workflow.sequenceDiscovery.unparsedDefaults.length > 0 && (
        <AlertMessage
          type={AlertType.WARNING}
          text={`No se pudo interpretar el valor por defecto de estas columnas; sus secuencias no se ajustarán: ${workflow.sequenceDiscovery.unparsedDefaults.join("; ")}.`}
        />
      )}

      <div className={styles.formGroup}>
        <label htmlFor="fullReplaceConfirmInput" className={styles.formLabel}>
          <span>
            Para confirmar, escriba <code className={styles.code}>{workflow.confirmText}</code>
          </span>
        </label>
        <div className={styles.inputWrapper}>
          <input
            id="fullReplaceConfirmInput"
            type="text"
            value={workflow.confirmValue}
            onChange={(event) => workflow.setConfirmValue(event.target.value)}
            placeholder={workflow.confirmText}
            className={`${styles.input} ${styles.inputDanger}`}
            autoComplete="off"
            spellCheck={false}
            disabled={workflow.isRunning}
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label htmlFor="fullReplacePasswordInput" className={styles.formLabel}>
          <Lock size={15} />
          <span>Contraseña de PostgreSQL del destino ({targetConfig.user})</span>
        </label>
        <div className={styles.inputWrapper}>
          <input
            id="fullReplacePasswordInput"
            type={workflow.showPassword ? "text" : "password"}
            value={workflow.password}
            onChange={(event) => workflow.setPassword(event.target.value)}
            placeholder="Ingrese su contraseña de PostgreSQL"
            className={styles.input}
            autoComplete="off"
            disabled={workflow.isRunning}
          />
          <button
            type="button"
            onClick={workflow.toggleShowPassword}
            className={styles.toggleEyeBtn}
            title={workflow.showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
            tabIndex={-1}
          >
            {workflow.showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>

      <div className={styles.actions}>
        <Button type="button" className={styles.runButton} disabled={!workflow.canRun} onClick={workflow.run}>
          <Trash2 size={16} />
          <span>{workflow.isRunning ? "Reemplazando..." : "Vaciar destino y recargar desde origen"}</span>
        </Button>
      </div>
    </div>
  );
};
