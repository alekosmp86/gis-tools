"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { IndicatorsStepCard } from "./IndicatorsStepCard";
import shared from "./IndicatorsShared.module.css";
import styles from "./IndicatorsBusyCard.module.css";

export const IndicatorsBusyCard: React.FC = () => (
  <IndicatorsStepCard title="3. Revisión del plan de carga">
    <div className={styles.content} role="status" aria-live="polite">
      <Loader2 size={24} className={shared.spin} />
      <span>Analizando los archivos contra la base de datos. No se escribe nada en este paso.</span>
    </div>
  </IndicatorsStepCard>
);
