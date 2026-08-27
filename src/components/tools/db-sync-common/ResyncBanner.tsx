import React from "react";
import { RefreshCw } from "lucide-react";
import { ProgressBar } from "@/components/shared/ProgressBar";
import type { ResyncBannerProps } from "@/types/comparison";
import styles from "./ResyncBanner.module.css";

export const ResyncBanner: React.FC<ResyncBannerProps> = ({
  isReanalyzing,
  progress,
}) => {
  if (!isReanalyzing) return null;

  return (
    <div className={styles.resyncBanner}>
      <div className={styles.resyncTextGroup}>
        <RefreshCw size={18} className={styles.spin} />
        <span>Sincronizando y re-analizando base de datos en segundo plano...</span>
      </div>
      {progress.phase !== "" && (
        <div className={styles.resyncProgress}>
          <ProgressBar
            phase={progress.phase}
            current={progress.current}
            total={progress.total}
            pct={progress.pct}
          />
        </div>
      )}
    </div>
  );
};
