import React, { useMemo } from "react";
import { ArrowRight, AlertTriangle } from "lucide-react";
import type { AttributeFieldsCardProps } from "@/types/gis";
import styles from "./AttributeFieldsCard.module.css";

export const AttributeFieldsCard: React.FC<AttributeFieldsCardProps> = ({
  availableFields,
  selectedFields,
  shpAttrMap,
  onToggleField,
  onSelectAll,
  onClearAll,
}) => {
  const selectedFieldsSet = useMemo(() => new Set(selectedFields), [selectedFields]);

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeaderRow}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionBadge}>2</span>
          <h3 className={styles.sectionTitle}>
            Atributos Alfanuméricos a Comparar ({selectedFields.length} seleccionados)
          </h3>
        </div>

        <div className={styles.selectionHelpers}>
          <button type="button" onClick={onSelectAll} className={styles.linkBtn}>
            Seleccionar todos
          </button>
          <span className={styles.dotSeparator} />
          <button type="button" onClick={onClearAll} className={styles.linkBtn}>
            Limpiar selección
          </button>
        </div>
      </div>

      <p className={styles.sectionDesc}>
        Marque los campos que desea comparar valor por valor entre la base de datos y el archivo Shapefile.
      </p>

      <div className={styles.fieldsGrid}>
        {availableFields.map((field) => {
          const isChecked = selectedFieldsSet.has(field);
          const targetLower = field.toLowerCase();
          const target10Lower = targetLower.slice(0, 10);
          const matchedShpCol = shpAttrMap.get(targetLower) || shpAttrMap.get(target10Lower);

          return (
            <label
              key={field}
              className={`${styles.fieldCard} ${isChecked ? styles.fieldCardActive : ""}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggleField(field)}
              />
              <div className={styles.fieldInfo}>
                <span className={styles.fieldName}>{field}</span>
                <span className={styles.fieldMatch}>
                  {matchedShpCol ? (
                    <span className={styles.matchTag}>
                      <ArrowRight size={12} />
                      <span>SHP: {matchedShpCol}</span>
                    </span>
                  ) : (
                    <span className={styles.noMatchTag}>
                      <AlertTriangle size={12} />
                      <span>Sin campo SHP directo</span>
                    </span>
                  )}
                </span>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
};
