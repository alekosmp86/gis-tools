"use client";

import React from "react";
import { Loader2 } from "lucide-react";
import shared from "./SigraShared.module.css";
import styles from "./SigraBusyNotice.module.css";

interface SigraBusyNoticeProps {
  text: string;
}

export const SigraBusyNotice: React.FC<SigraBusyNoticeProps> = ({ text }) => (
  <div className={styles.content} role="status" aria-live="polite">
    <Loader2 size={20} className={shared.spin} />
    <span>{text}</span>
  </div>
);
