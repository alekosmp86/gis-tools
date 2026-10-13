"use client";

import React, { useId } from "react";
import styles from "./ShpStepCard.module.css";

interface ShpStepCardProps {
  title: string;
  children: React.ReactNode;
}

export const ShpStepCard: React.FC<ShpStepCardProps> = ({ title, children }) => {
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
