import React from "react";
import { PlusSquare, AlertTriangle, CheckCircle2, Code2, Sparkles } from "lucide-react";
import type { DbColumnMetadata } from "@/types/db";
import type { InsertFieldDefault } from "@/types/comparison";
import styles from "./InsertDefaultsCard.module.css";

interface InsertDefaultsCardProps {
  unmappedColumns: string[];
  columnDetails?: DbColumnMetadata[];
  defaults: Record<string, InsertFieldDefault>;
  onChangeDefault: (fieldName: string, fieldDefault: InsertFieldDefault) => void;
}

export const InsertDefaultsCard: React.FC<InsertDefaultsCardProps> = ({
  unmappedColumns,
  columnDetails = [],
  defaults,
  onChangeDefault,
}) => {
  if (unmappedColumns.length === 0) {
    return null;
  }

  const detailMap = new Map<string, DbColumnMetadata>();
  columnDetails.forEach((col) => detailMap.set(col.column_name, col));

  return (
    <div className={`glass-panel ${styles.card}`}>
      <div className={styles.header}>
        <div className={styles.iconBox}>
          <PlusSquare size={20} />
        </div>
        <div>
          <h3 className={styles.title}>Valores por Defecto para Inserciones (INSERT)</h3>
          <p className={styles.subtitle}>
            Configure valores para columnas de base de datos no mapeadas al insertar nuevos registros.
            Los campos <strong>NOT NULL</strong> sin valor por defecto en PostgreSQL requieren un valor asignado.
          </p>
        </div>
      </div>

      <div className={styles.list}>
        {unmappedColumns.map((colName) => {
          const detail = detailMap.get(colName);
          const current = defaults[colName] || {
            fieldName: colName,
            value: "",
            useRawExpression: false,
          };

          const isRequired = detail ? !detail.is_nullable && !detail.column_default : false;
          const hasDbDefault = detail?.column_default != null;

          return (
            <div
              key={colName}
              className={`${styles.itemRow} ${isRequired ? styles.requiredRow : ""}`}
            >
              <div className={styles.colInfo}>
                <div className={styles.nameGroup}>
                  <span className={styles.colName}>{colName}</span>
                  {detail && <span className={styles.dataType}>{detail.data_type}</span>}
                </div>

                <div className={styles.badges}>
                  {isRequired && (
                    <span className={styles.badgeRequired}>
                      <AlertTriangle size={12} />
                      NOT NULL (Requerido)
                    </span>
                  )}
                  {hasDbDefault && (
                    <span className={styles.badgeDbDefault}>
                      <CheckCircle2 size={12} />
                      DEFAULT: {detail.column_default}
                    </span>
                  )}
                  {!isRequired && !hasDbDefault && (
                    <span className={styles.badgeNullable}>NULLABLE</span>
                  )}
                </div>
              </div>

              <div className={styles.inputGroup}>
                <div className={styles.inputWrapper}>
                  <input
                    type="text"
                    className={styles.valueInput}
                    placeholder={
                      hasDbDefault
                        ? `Usar DB default (${detail.column_default})`
                        : isRequired
                        ? "Ej. 'ACTIVO' o NOW()"
                        : "NULL / Omitir"
                    }
                    value={current.value}
                    onChange={(e) =>
                      onChangeDefault(colName, { ...current, value: e.target.value })
                    }
                  />
                </div>

                <label className={styles.expressionToggle} title="Interpretar como expresión SQL sin comillas (ej. NOW(), CURRENT_USER)">
                  <input
                    type="checkbox"
                    checked={current.useRawExpression}
                    onChange={(e) =>
                      onChangeDefault(colName, {
                        ...current,
                        useRawExpression: e.target.checked,
                      })
                    }
                  />
                  <Code2 size={14} />
                  <span>Expr. SQL</span>
                </label>

                {/* Quick Auto-fill Suggestion Helpers */}
                {isRequired && current.value === "" && (
                  <div className={styles.quickFillButtons}>
                    {detail?.data_type.includes("timestamp") || detail?.data_type.includes("date") ? (
                      <button
                        type="button"
                        className={styles.quickBtn}
                        onClick={() =>
                          onChangeDefault(colName, {
                            fieldName: colName,
                            value: "NOW()",
                            useRawExpression: true,
                          })
                        }
                      >
                        <Sparkles size={12} />
                        NOW()
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={styles.quickBtn}
                        onClick={() =>
                          onChangeDefault(colName, {
                            fieldName: colName,
                            value: "SISTEMA",
                            useRawExpression: false,
                          })
                        }
                      >
                        <Sparkles size={12} />
                        &apos;SISTEMA&apos;
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
