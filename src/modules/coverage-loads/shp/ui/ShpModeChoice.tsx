"use client";

import React from "react";
import { JOB_MODE } from "../job/types.ts";
import type { JobMode } from "../job/types.ts";
import styles from "./ShpModeChoice.module.css";

interface ShpModeChoiceProps {
  mode: JobMode;
  availableModes: ReadonlyArray<JobMode>;
  table: string;
  onChange: (mode: JobMode) => void;
}

const MODE_TITLES: Readonly<Record<JobMode, string>> = {
  [JOB_MODE.TEST]: "Prueba",
  [JOB_MODE.LOAD]: "Carga",
};

const modeDescription = (mode: JobMode, table: string): string =>
  mode === JOB_MODE.TEST
    ? `Procesa el archivo y compara con la tabla actual, sin modificar public.${table}.`
    : `Reemplaza todo el contenido de public.${table} con el archivo.`;

export const ShpModeChoice: React.FC<ShpModeChoiceProps> = ({ mode, availableModes, table, onChange }) => (
  <fieldset className={styles.group}>
    <legend className={styles.legend}>Modo</legend>
    {availableModes.map((option) => (
      <label key={option} className={styles.option}>
        <input type="radio" name="shp-mode" checked={mode === option} onChange={() => onChange(option)} />
        <span className={styles.text}>
          <span className={styles.title}>{MODE_TITLES[option]}</span>
          <span className={styles.description}>{modeDescription(option, table)}</span>
        </span>
      </label>
    ))}
  </fieldset>
);
