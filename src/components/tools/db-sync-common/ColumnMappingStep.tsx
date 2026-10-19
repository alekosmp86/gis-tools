import React from "react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import {
  findMissingRequiredColumns,
  getIgnoredSourceColumns,
  hasTypeConflict,
  resolveInsertColumns,
  type ReplaceColumnMapping,
} from "@/core/services/replaceColumnMapping";
import type { DbColumnMetadata } from "@/core/types/db";
import type { InsertFieldDefault } from "@/core/types/comparison";
import { InsertDefaultsCard } from "./InsertDefaultsCard";
import styles from "./ColumnMappingStep.module.css";

export interface ColumnMappingStepProps {
  sourceColumns: string[];
  sourceDetails: DbColumnMetadata[];
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
  mapping: ReplaceColumnMapping;
  onSourceChange: (targetColumn: string, sourceColumn: string | null) => void;
  onDefaultChange: (targetColumn: string, fieldDefault: InsertFieldDefault) => void;
}

export const ColumnMappingStep: React.FC<ColumnMappingStepProps> = ({
  sourceColumns,
  sourceDetails,
  targetColumns,
  targetDetails,
  mapping,
  onSourceChange,
  onDefaultChange,
}) => {
  const sourceTypes = new Map(sourceDetails.map((detail) => [detail.column_name, detail.data_type]));
  const targetDetailMap = new Map(targetDetails.map((detail) => [detail.column_name, detail]));
  const insertColumns = resolveInsertColumns(mapping, targetColumns);
  const missingRequired = findMissingRequiredColumns(insertColumns, targetDetails);
  const ignoredSource = getIgnoredSourceColumns(insertColumns, sourceColumns);
  const unmappedTargets = targetColumns.filter((column) => !mapping.sourceByTarget[column]);

  return (
    <div className={styles.container}>
      <div className={styles.list}>
        {targetColumns.map((targetColumn) => {
          const detail = targetDetailMap.get(targetColumn);
          const selectedSource = mapping.sourceByTarget[targetColumn] ?? "";
          const isRequired = detail ? !detail.is_nullable && detail.column_default == null : false;
          const isMissing = missingRequired.includes(targetColumn);
          const conflict = selectedSource
            ? hasTypeConflict(sourceTypes.get(selectedSource), detail?.data_type)
            : false;

          return (
            <div key={targetColumn} className={`${styles.row} ${isMissing ? styles.rowRequired : ""}`}>
              <div className={styles.targetInfo}>
                <span className={styles.targetName}>{targetColumn}</span>
                <span className={styles.targetType}>{detail?.data_type ?? "tipo desconocido"}</span>
                {isRequired && <span className={styles.requiredBadge}>NOT NULL (requerido)</span>}
              </div>
              <select
                className={styles.select}
                aria-label={`Columna origen para ${targetColumn}`}
                value={selectedSource}
                onChange={(event) => onSourceChange(targetColumn, event.target.value || null)}
              >
                <option value="">— no mapear —</option>
                {sourceColumns.map((sourceColumn) => (
                  <option key={sourceColumn} value={sourceColumn}>
                    {sourceColumn}
                    {sourceTypes.get(sourceColumn) ? ` (${sourceTypes.get(sourceColumn)})` : ""}
                  </option>
                ))}
              </select>
              {conflict && (
                <span className={styles.conflict}>
                  Posible conflicto de tipos: {sourceTypes.get(selectedSource)} → {detail?.data_type}
                </span>
              )}
            </div>
          );
        })}
      </div>

      <InsertDefaultsCard
        unmappedColumns={unmappedTargets}
        columnDetails={targetDetails}
        defaults={mapping.defaults}
        onChangeDefault={onDefaultChange}
      />

      {missingRequired.length > 0 && (
        <AlertMessage
          type={AlertType.ERROR}
          text={`Columnas NOT NULL sin valor por defecto que deben mapearse o recibir un valor fijo: ${missingRequired.join(", ")}.`}
        />
      )}

      {ignoredSource.length > 0 && (
        <span className={styles.ignored}>Columnas del origen ignoradas: {ignoredSource.join(", ")}.</span>
      )}
    </div>
  );
};
