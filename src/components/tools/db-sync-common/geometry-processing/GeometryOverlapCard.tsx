import React, { useState } from "react";
import { ScanSearch } from "lucide-react";
import { OptionToggleCard } from "@/components/tools/db-sync-common/OptionToggleCard";
import { OverlapPolicy, type OverlapPolicy as OverlapPolicyType } from "@/core/types/geometryProcessing";
import styles from "./GeometryCards.module.css";

const MAX_MIN_AREA_M2 = 1e9;
const MIN_AREA_ERROR = `Ingrese un área entre 0 y ${MAX_MIN_AREA_M2.toLocaleString("es-AR")} m².`;

const POLICY_OPTIONS: ReadonlyArray<{ value: OverlapPolicyType; label: string }> = [
  { value: OverlapPolicy.BLOCK, label: "Bloquear" },
  { value: OverlapPolicy.REPORT, label: "Solo informar" },
];

const parseMinArea = (text: string): number | null => {
  if (text.trim() === "") return null;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 && value <= MAX_MIN_AREA_M2 ? value : null;
};

export interface GeometryOverlapCardProps {
  enabled: boolean;
  policy: OverlapPolicyType;
  minAreaM2: number;
  onToggle: (enabled: boolean) => void;
  onPolicyChange: (policy: OverlapPolicyType) => void;
  onMinAreaChange: (minAreaM2: number) => void;
}

export const GeometryOverlapCard: React.FC<GeometryOverlapCardProps> = ({
  enabled,
  policy,
  minAreaM2,
  onToggle,
  onPolicyChange,
  onMinAreaChange,
}) => {
  const [minAreaText, setMinAreaText] = useState(String(minAreaM2));
  const [syncedMinArea, setSyncedMinArea] = useState(minAreaM2);
  if (minAreaM2 !== syncedMinArea) {
    setSyncedMinArea(minAreaM2);
    if (parseMinArea(minAreaText) !== minAreaM2) setMinAreaText(String(minAreaM2));
  }
  const isMinAreaInvalid = parseMinArea(minAreaText) === null;

  const handleMinAreaChange = (text: string) => {
    setMinAreaText(text);
    const parsed = parseMinArea(text);
    if (parsed !== null) onMinAreaChange(parsed);
  };

  const handleMinAreaBlur = () => {
    if (isMinAreaInvalid) setMinAreaText(String(minAreaM2));
  };

  return (
    <OptionToggleCard
      tone="sky"
      icon={<ScanSearch size={18} />}
      title="Validar solapes"
      isEnabled={enabled}
      isActive={enabled}
      activeBadge="Activa"
      inactiveBadge="Inactiva"
      toggleLabel="Detectar solapes entre geometrías"
      onToggleEnabled={onToggle}
      description={
        <>
          Detecta solapes entre geometrías de registros distintos. Los bordes que se tocan no cuentan. Las geometrías
          inválidas se excluyen de la comprobación si no se repara.
        </>
      }
    >
      {enabled && (
        <div className={styles.controls}>
          <div className={styles.radioRow} role="radiogroup" aria-label="Política ante solapes">
            {POLICY_OPTIONS.map((option) => (
              <label key={option.value} className={styles.radioLabel}>
                <input
                  type="radio"
                  name="geometry-overlap-policy"
                  checked={policy === option.value}
                  onChange={() => onPolicyChange(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Área mínima de solape (m²)</span>
            <input
              type="number"
              min={0}
              max={MAX_MIN_AREA_M2}
              step="any"
              className={styles.input}
              value={minAreaText}
              aria-invalid={isMinAreaInvalid}
              onChange={(event) => handleMinAreaChange(event.target.value)}
              onBlur={handleMinAreaBlur}
            />
            {isMinAreaInvalid && (
              <span className={styles.fieldError} role="alert">
                {MIN_AREA_ERROR}
              </span>
            )}
          </label>
        </div>
      )}
    </OptionToggleCard>
  );
};
