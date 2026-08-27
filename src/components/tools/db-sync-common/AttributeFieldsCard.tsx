import React from "react";
import { ArrowRight, AlertTriangle, Link2, Check } from "lucide-react";
import type { AttributeFieldsCardProps } from "@/types/comparison";
import styles from "./AttributeFieldsCard.module.css";

export const AttributeFieldsCard: React.FC<AttributeFieldsCardProps> = ({
  availableFields,
  selectedFields,
  attributeMap,
  fileAttributes,
  onToggleField,
  onMapField,
  onSelectAll,
  onClearAll,
}) => {
  const selectedFieldsSet = new Set(selectedFields);

  return (
    <div className={styles.sectionCard}>
      <div className={styles.sectionHeaderRow}>
        <div className={styles.sectionTitleRow}>
          <span className={styles.sectionBadge}>2</span>
          <h3 className={styles.sectionTitle}>
            Atributos a Comparar y Mapeo 1-a-1 ({selectedFields.length} seleccionados)
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
        Marque las columnas de la base de datos que desea comparar y asigne la columna correspondiente del archivo fuente (CSV o Shapefile).
      </p>

      <div className={styles.mappingList}>
        {availableFields.map((dbField) => {
          const isChecked = selectedFieldsSet.has(dbField);
          const mappedFileAttr = attributeMap[dbField] || "";
          const isMapped = Boolean(mappedFileAttr);

          return (
            <div
              key={dbField}
              className={`${styles.mappingRow} ${isChecked ? styles.mappingRowActive : ""}`}
            >
              {/* Checkbox and DB Column Name */}
              <div className={styles.dbColumnCol}>
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => onToggleField(dbField)}
                    className={styles.checkbox}
                  />
                  <span className={styles.dbFieldName}>{dbField}</span>
                </label>
              </div>

              {/* Arrow Indicator */}
              <div className={styles.arrowCol}>
                <ArrowRight size={16} className={isChecked ? styles.arrowActive : styles.arrowDim} />
              </div>

              {/* Source File Attribute Select Dropdown */}
              <div className={styles.fileAttrCol}>
                <div className={styles.selectWrapper}>
                  <select
                    value={mappedFileAttr}
                    onChange={(e) => onMapField(dbField, e.target.value)}
                    disabled={!isChecked}
                    className={`${styles.attrSelect} ${!isMapped ? styles.attrSelectUnmapped : ""}`}
                  >
                    <option value="">-- Sin mapear --</option>
                    {fileAttributes.map((attr) => (
                      <option key={attr} value={attr}>
                        {attr}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Mapping Status Badge */}
              <div className={styles.statusCol}>
                {isChecked && isMapped ? (
                  <span className={styles.mappedBadge}>
                    <Check size={13} />
                    <span>Mapeado ({mappedFileAttr})</span>
                  </span>
                ) : isChecked ? (
                  <span className={styles.unmappedBadge}>
                    <AlertTriangle size={13} />
                    <span>Seleccione campo fuente</span>
                  </span>
                ) : (
                  <span className={styles.ignoredBadge}>
                    <Link2 size={13} />
                    <span>No comparado</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
