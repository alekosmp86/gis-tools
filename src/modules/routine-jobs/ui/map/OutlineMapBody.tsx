"use client";

import React, { useState } from "react";
import styles from "./OutlineMapBody.module.css";

interface OutlineSelection {
  subject: object;
  outlineIndex: number | null;
}

export interface OutlineMapBodyProps {
  /** The subject on screen: the selection belongs to it, so moving to another subject starts with none. */
  subject: object;
  /** Shown instead of the map when it cannot be drawn (for example no connection password); null when the map can be drawn. */
  notice: string | null;
  renderMap: (selectedOutlineIndex: number | null, onSelectOutline: (outlineIndex: number | null) => void) => React.ReactNode;
  renderDetails: (selectedOutlineIndex: number | null) => React.ReactNode;
  /** Controls of the subject, shown above its details. */
  aside?: React.ReactNode;
}

/**
 * The map beside the details of the outline clicked on it. The selection is one outline, by its index, and belongs to
 * the subject it was made on: moving to another subject starts with no selection while the map keeps its cache.
 */
export function OutlineMapBody({ subject, notice, renderMap, renderDetails, aside }: OutlineMapBodyProps) {
  const [selection, setSelection] = useState<OutlineSelection>({ subject, outlineIndex: null });
  const selectedOutlineIndex = selection.subject === subject ? selection.outlineIndex : null;
  const selectOutline = (outlineIndex: number | null) => setSelection({ subject, outlineIndex });
  return (
    <div className={styles.body}>
      <div className={styles.mapColumn}>
        {notice === null ? renderMap(selectedOutlineIndex, selectOutline) : <p className={styles.passwordNotice}>{notice}</p>}
      </div>
      <div className={styles.detailsColumn}>
        {aside}
        {renderDetails(selectedOutlineIndex)}
      </div>
    </div>
  );
}
