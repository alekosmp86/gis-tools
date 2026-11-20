import React from "react";
import { ShowOnMapButton } from "../../shared/map/ShowOnMapButton";
import styles from "./EjesCompact.module.css";

export interface EjesRefCellProps {
  primary: string;
  secondary: string;
  onShowOnMap?: () => void;
  /** A short mark beside the reftramo, such as the manual split's "Manual". */
  badge?: string;
}

/** A reftramo in bold with its street on a small second line, and the map button when the row has a map. */
export const EjesRefCell: React.FC<EjesRefCellProps> = ({ primary, secondary, onShowOnMap, badge }) => (
  <div className={styles.refCell}>
    {onShowOnMap !== undefined && <ShowOnMapButton onShow={onShowOnMap} />}
    <div className={styles.refText}>
      <strong className={styles.refPrimary}>
        {primary}
        {badge !== undefined && <span className={styles.refBadge}>{badge}</span>}
      </strong>
      <span className={styles.refSecondary}>{secondary}</span>
    </div>
  </div>
);
