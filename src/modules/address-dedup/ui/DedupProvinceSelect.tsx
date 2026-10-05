"use client";

import React, { useId } from "react";
import { Loader2, MapPin, RefreshCw } from "lucide-react";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { Button } from "@/ui-kit/components/ui/Button";
import { AlertType, ButtonVariant } from "@/ui-kit/types/ui";
import type { ProvinceOption } from "../types";
import styles from "./DedupProvinceSelect.module.css";

interface DedupProvinceSelectProps {
  provinces: ReadonlyArray<ProvinceOption>;
  value: string;
  isLoading: boolean;
  canLoad: boolean;
  errorText: string | null;
  onChange: (value: string) => void;
  onLoad: () => void;
}

export const DedupProvinceSelect: React.FC<DedupProvinceSelectProps> = ({
  provinces,
  value,
  isLoading,
  canLoad,
  errorText,
  onChange,
  onLoad,
}) => {
  const selectId = useId();

  return (
    <div className={styles.field}>
      <label htmlFor={selectId} className={styles.label}>
        <MapPin size={14} />
        <span>Departamento</span>
      </label>
      <div className={styles.row}>
        <select
          id={selectId}
          className={styles.select}
          value={value}
          disabled={isLoading || provinces.length === 0}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Seleccione un departamento</option>
          {provinces.map((province) => (
            <option key={province.id} value={String(province.id)}>
              {province.name}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant={ButtonVariant.SECONDARY}
          isDisabled={isLoading || !canLoad}
          onClick={onLoad}
        >
          {isLoading ? <Loader2 size={15} className={styles.spin} /> : <RefreshCw size={15} />}
          Cargar departamentos
        </Button>
      </div>
      {errorText && <AlertMessage type={AlertType.ERROR} text={errorText} />}
    </div>
  );
};
