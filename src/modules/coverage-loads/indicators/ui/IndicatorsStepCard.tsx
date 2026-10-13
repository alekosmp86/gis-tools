"use client";

import React, { useId } from "react";
import styles from "./IndicatorsStepCard.module.css";

interface IndicatorsStepCardProps {
  title: string;
  children: React.ReactNode;
}

export const IndicatorsStepCard: React.FC<IndicatorsStepCardProps> = ({ title, children }) => {
  const titleId = useId();

  return (
    <section className={`glass-panel ${styles.card}`} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      {children}
    </section>
  );
};
