import React from "react";
import { ShowOnMapButton } from "../../shared/map/ShowOnMapButton";
import styles from "./EjesCompact.module.css";

export interface EjesRefCellProps {
  primary: string;
  secondary: string;
  onShowOnMap?: () => void;
}

/** A reftramo in bold with its street on a small second line, and the map button when the row has a map. */
export const EjesRefCell: React.FC<EjesRefCellProps> = ({ primary, secondary, onShowOnMap }) => (
  <div className={styles.refCell}>
    {onShowOnMap !== undefined && <ShowOnMapButton onShow={onShowOnMap} />}
    <div className={styles.refText}>
      <strong className={styles.refPrimary}>{primary}</strong>
      <span className={styles.refSecondary}>{secondary}</span>
    </div>
  </div>
);
