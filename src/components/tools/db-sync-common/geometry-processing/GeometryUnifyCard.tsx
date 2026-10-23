import React from "react";
import { Merge, Plus, X } from "lucide-react";
import { OptionToggleCard } from "@/components/tools/db-sync-common/OptionToggleCard";
import { KeyOrigin } from "@/core/services/geometryKeySuggestion";
import styles from "./GeometryCards.module.css";

const SUGGESTION_LABEL: Record<KeyOrigin, string | null> = {
  [KeyOrigin.REMEMBERED]: "Sugerida: recordada",
  [KeyOrigin.UNIQUE_KEY]: "Sugerida: clave única de la tabla",
  [KeyOrigin.NONE]: null,
};

export interface GeometryUnifyCardProps {
  enabled: boolean;
  keyFields: readonly string[];
  dbfFields: readonly string[];
  suggestionOrigin: KeyOrigin;
  onToggle: (enabled: boolean) => void;
  onKeyFieldsChange: (keyFields: string[]) => void;
}

export const GeometryUnifyCard: React.FC<GeometryUnifyCardProps> = ({
  enabled,
  keyFields,
  dbfFields,
  suggestionOrigin,
  onToggle,
  onKeyFieldsChange,
}) => {
  const selectedFields = new Set(keyFields);
  const availableFields = dbfFields.filter((field) => !selectedFields.has(field));
  const suggestionLabel = SUGGESTION_LABEL[suggestionOrigin];

  return (
    <OptionToggleCard
      tone="amber"
      icon={<Merge size={18} />}
      title="Unificar por clave"
      isEnabled={enabled}
      isActive={enabled}
      activeBadge="Activa"
      inactiveBadge="Inactiva"
      toggleLabel="Unificar registros con la misma clave"
      onToggleEnabled={onToggle}
      description={
        <>
          Se agrupan los registros con los mismos valores en la clave en un único MultiPolígono (las partes se reúnen, no
          se disuelven). Si otras columnas mapeadas difieren dentro de un grupo, se informará en el análisis.
        </>
      }
    >
      {enabled && (
        <div className={styles.controls}>
          <div className={styles.chips}>
            {keyFields.map((field) => (
              <span key={field} className={styles.chip}>
                {field}
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={`Quitar ${field} de la clave`}
                  onClick={() => onKeyFieldsChange(keyFields.filter((item) => item !== field))}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            {keyFields.length === 0 && <span className={styles.warning}>Seleccione al menos un campo clave.</span>}
          </div>
          <div className={styles.addRow}>
            <select
              className={styles.select}
              aria-label="Agregar campo clave"
              value=""
              disabled={availableFields.length === 0}
              onChange={(event) => {
                if (event.target.value) onKeyFieldsChange([...keyFields, event.target.value]);
              }}
            >
              <option value="">Agregar campo clave…</option>
              {availableFields.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
            <Plus size={14} className={styles.addIcon} />
            {suggestionLabel && <span className={styles.hint}>{suggestionLabel}</span>}
          </div>
        </div>
      )}
    </OptionToggleCard>
  );
};
