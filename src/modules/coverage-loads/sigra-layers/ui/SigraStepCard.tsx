"use client";

import React, { useId } from "react";
import styles from "./SigraStepCard.module.css";

interface SigraStepCardProps {
  title: string;
  children: React.ReactNode;
}

export const SigraStepCard: React.FC<SigraStepCardProps> = ({ title, children }) => {
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
