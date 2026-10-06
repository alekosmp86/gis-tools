import React from "react";
import { Trash2, type LucideIcon } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import styles from "./LoadedFileHeader.module.css";

export type LoadedFileHeaderVariant = "csv" | "shapefile";

const VARIANT_CLASS: Record<LoadedFileHeaderVariant, string> = {
  csv: styles.csv,
  shapefile: styles.shapefile,
};

export interface LoadedFileHeaderProps {
  variant: LoadedFileHeaderVariant;
  icon: LucideIcon;
  fileName: string;
  onDiscard: () => void;
  children: React.ReactNode;
}

export const LoadedFileHeader: React.FC<LoadedFileHeaderProps> = ({
  variant,
  icon: Icon,
  fileName,
  onDiscard,
  children,
}) => (
  <div className={`${styles.loadedHeader} ${VARIANT_CLASS[variant]}`}>
    <div className={styles.fileMeta}>
      <Icon size={28} className={styles.successIcon} />
      <div>
        <div className={styles.fileName}>{fileName}</div>
        <div className={styles.fileSub}>{children}</div>
      </div>
    </div>

    <Button variant="ghost" onClick={onDiscard}>
      <Trash2 size={16} color="var(--accent-rose)" />
      <span className={styles.discardText}>Descartar archivo</span>
    </Button>
  </div>
);
