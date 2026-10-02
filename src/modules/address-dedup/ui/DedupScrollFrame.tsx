"use client";

import React from "react";
import { useSyncedHorizontalScroll } from "./useSyncedHorizontalScroll";
import styles from "./DedupScrollFrame.module.css";

interface DedupScrollFrameProps {
  children: React.ReactNode;
}

/** Horizontal scrollbar above and below its content; the top one disappears when nothing overflows. */
export const DedupScrollFrame: React.FC<DedupScrollFrameProps> = ({ children }) => {
  const { topRef, spacerRef, contentRef, hasOverflow } = useSyncedHorizontalScroll();

  return (
    <div className={styles.frame}>
      <div
        ref={topRef}
        className={`${styles.topScroller} ${hasOverflow ? "" : styles.hidden}`}
        data-testid="dedup-scroll-top"
        aria-hidden="true"
        tabIndex={-1}
      >
        <div ref={spacerRef} className={styles.spacer} />
      </div>
      <div ref={contentRef} className={styles.scroller} data-testid="dedup-scroll-content">
        {children}
      </div>
    </div>
  );
};
