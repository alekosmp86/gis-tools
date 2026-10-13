"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import { ShpStepCard } from "./ShpStepCard";
import shared from "./ShpShared.module.css";
import styles from "./ShpBusyCard.module.css";

interface ShpBusyCardProps {
  title: string;
  message: string;
}

export const ShpBusyCard: React.FC<ShpBusyCardProps> = ({ title, message }) => (
  <ShpStepCard title={title}>
    <div className={styles.content} role="status" aria-live="polite">
      <Loader2 size={24} className={shared.spin} />
      <span>{message}</span>
    </div>
  </ShpStepCard>
);
