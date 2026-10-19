import React from "react";
import { Info, Lightbulb, TriangleAlert } from "lucide-react";
import { WikiCalloutKind } from "@/core/wiki/callouts";
import styles from "./WikiCallout.module.css";

const CALLOUT_PRESENTATION = {
  [WikiCalloutKind.NOTE]: { label: "Nota", Icon: Info, className: styles.note },
  [WikiCalloutKind.TIP]: { label: "Consejo", Icon: Lightbulb, className: styles.tip },
  [WikiCalloutKind.WARNING]: { label: "Advertencia", Icon: TriangleAlert, className: styles.warning },
} as const;

export interface WikiCalloutProps {
  kind: WikiCalloutKind;
  children: React.ReactNode;
}

/** Highlighted aside for a `[!NOTE]` / `[!TIP]` / `[!WARNING]` blockquote. */
export const WikiCallout: React.FC<WikiCalloutProps> = ({ kind, children }) => {
  const { label, Icon, className } = CALLOUT_PRESENTATION[kind];

  return (
    <aside className={`${styles.callout} ${className}`}>
      <div className={styles.title}>
        <Icon size={16} />
        <span>{label}</span>
      </div>
      <div className={styles.body}>{children}</div>
    </aside>
  );
};
