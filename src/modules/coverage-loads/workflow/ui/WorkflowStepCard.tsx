"use client";

import React, { useId } from "react";
import styles from "./WorkflowStepCard.module.css";

interface WorkflowStepCardProps {
  title: string;
  children: React.ReactNode;
}

export const WorkflowStepCard: React.FC<WorkflowStepCardProps> = ({ title, children }) => {
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
