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
import { SHP_GEOMETRY_LABEL } from "@/core/services/shpReplaceSource";
import { SHP_GEOMETRY_SOURCE } from "@/core/types/shpReplace";
import { InsertDefaultsCard } from "./InsertDefaultsCard";
import { AUTO_MATCH_LABELS, isReviewMatch } from "./autoMatchLabels";
import styles from "./ColumnMappingStep.module.css";

const describeSourceColumn = (sourceColumn: string): string =>
  sourceColumn === SHP_GEOMETRY_SOURCE ? SHP_GEOMETRY_LABEL : sourceColumn;

interface AutoMatchChipProps {
  kind: string;
}

const AutoMatchChip: React.FC<AutoMatchChipProps> = ({ kind }) => (
  <span
    className={`${styles.autoChip} ${isReviewMatch(kind) ? styles.autoChipReview : ""}`}
    title={AUTO_MATCH_LABELS[kind]}
  >
    Auto
  </span>
);

export interface ColumnMappingStepProps {
  sourceColumns: string[];
  sourceDetails: DbColumnMetadata[];
  targetColumns: string[];
  targetDetails: DbColumnMetadata[];
  mapping: ReplaceColumnMapping;
  onSourceChange: (targetColumn: string, sourceColumn: string | null) => void;
  onDefaultChange: (targetColumn: string, fieldDefault: InsertFieldDefault) => void;
  fileDate?: Date | null;
  autoMatches?: Record<string, string>;
}

export const ColumnMappingStep: React.FC<ColumnMappingStepProps> = ({
  sourceColumns,
  sourceDetails,
  targetColumns,
  targetDetails,
  mapping,
  onSourceChange,
  onDefaultChange,
  fileDate,
  autoMatches,
}) => {
  const sourceTypes = new Map(sourceDetails.map((detail) => [detail.column_name, detail.data_type]));
  const targetDetailMap = new Map(targetDetails.map((detail) => [detail.column_name, detail]));
  const insertColumns = resolveInsertColumns(mapping, targetColumns);
  const missingRequired = findMissingRequiredColumns(insertColumns, targetDetails);
  const missingRequiredSet = new Set(missingRequired);
  const ignoredSource = getIgnoredSourceColumns(insertColumns, sourceColumns);
  const unmappedTargets = targetColumns.filter((column) => !mapping.sourceByTarget[column]);

  return (
    <div className={styles.container}>
      {autoMatches && (
        <span className={styles.autoSummary}>
          Se asignaron {Object.keys(autoMatches).length} de {targetColumns.length} columnas automáticamente. Revise las
          marcadas.
        </span>
      )}
      <div className={styles.list}>
        {targetColumns.map((targetColumn) => {
          const detail = targetDetailMap.get(targetColumn);
          const selectedSource = mapping.sourceByTarget[targetColumn] ?? "";
          const autoKind = selectedSource ? autoMatches?.[targetColumn] : undefined;
          const isRequired = detail ? !detail.is_nullable && detail.column_default == null : false;
          const isMissing = missingRequiredSet.has(targetColumn);
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
              <div className={styles.selectGroup}>
                <select
                  className={styles.select}
                  aria-label={`Columna origen para ${targetColumn}`}
                  value={selectedSource}
                  onChange={(event) => onSourceChange(targetColumn, event.target.value || null)}
                >
                  <option value="">— no mapear —</option>
                  {sourceColumns.map((sourceColumn) => (
                    <option key={sourceColumn} value={sourceColumn}>
                      {describeSourceColumn(sourceColumn)}
                      {sourceTypes.get(sourceColumn) ? ` (${sourceTypes.get(sourceColumn)})` : ""}
                    </option>
                  ))}
                </select>
                {autoKind && <AutoMatchChip kind={autoKind} />}
              </div>
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
        fileDate={fileDate}
      />

      {missingRequired.length > 0 && (
        <AlertMessage
          type={AlertType.ERROR}
          text={`Columnas NOT NULL sin valor por defecto que deben mapearse o recibir un valor fijo: ${missingRequired.join(", ")}.`}
        />
      )}

      {ignoredSource.length > 0 && (
        <span className={styles.ignored}>
          Columnas del origen ignoradas: {ignoredSource.map(describeSourceColumn).join(", ")}.
        </span>
      )}
    </div>
  );
};
