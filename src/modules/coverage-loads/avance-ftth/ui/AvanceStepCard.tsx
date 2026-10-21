"use client";

import React, { useId } from "react";
import styles from "./AvanceStepCard.module.css";

interface AvanceStepCardProps {
  title: string;
  children: React.ReactNode;
}

export const AvanceStepCard: React.FC<AvanceStepCardProps> = ({ title, children }) => {
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
