"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { RunMode } from "../domain/loadFlow";
import { AvanceStepCard } from "./AvanceStepCard";
import shared from "./AvanceShared.module.css";
import styles from "./AvanceBusyCard.module.css";

interface AvanceBusyCardProps {
  mode: RunMode | null;
}

const BUSY_TEXT: Readonly<Record<RunMode, string>> = {
  [RunMode.DRY_RUN]:
    "Probando la carga completa sin guardar. Otras cargas esperan mientras dure, incluido el reporte lento de zonas fuera de la central.",
  [RunMode.LOAD]:
    "Reemplazando el Avance. Otras cargas esperan mientras dure, y luego se generan los reportes.",
};

const PLANNING_TEXT = "Analizando los archivos contra la base de datos. No se escribe nada en este paso.";

export const AvanceBusyCard: React.FC<AvanceBusyCardProps> = ({ mode }) => (
  <AvanceStepCard title={mode === null ? "Revisión del plan de carga" : "Carga en curso"}>
    <div className={styles.content} role="status" aria-live="polite">
      <Loader2 size={24} className={shared.spin} />
      <span>{mode === null ? PLANNING_TEXT : BUSY_TEXT[mode]}</span>
    </div>
  </AvanceStepCard>
);
