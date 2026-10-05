"use client";

import React, { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { formatNumber } from "@/core/common/ValueFormatter";
import { REMOVAL_LABELS } from "../data/removalLabels";
import {
  buildRemovalPlanCsv,
  buildRemovalPlanFilename,
  buildTargetUrnText,
} from "../domain/removalPlanExport";
import type { RemovalPlanTarget } from "../removalTypes";
import { downloadBlob } from "./downloadBlob";
import styles from "./DedupRemovalTargetList.module.css";

interface DedupRemovalTargetListProps {
  targets: ReadonlyArray<RemovalPlanTarget>;
  provinceId: number;
  fingerprint: string;
}

const CSV_MIME_TYPE = "text/csv;charset=utf-8";

/** One read-only textarea, not a node per urn, so a list of thousands renders without a stall. */
export const DedupRemovalTargetList: React.FC<DedupRemovalTargetListProps> = ({
  targets,
  provinceId,
  fingerprint,
}) => {
  const [isCopied, setIsCopied] = useState(false);

  if (targets.length === 0) return null;

  const handleCopy = () => {
    void navigator.clipboard.writeText(buildTargetUrnText(targets)).then(() => setIsCopied(true));
  };

  const handleDownload = () => {
    const csv = new Blob([buildRemovalPlanCsv(targets)], { type: CSV_MIME_TYPE });
    downloadBlob(csv, buildRemovalPlanFilename(provinceId, fingerprint));
  };

  return (
    <section className={styles.section}>
      <header className={styles.header}>
        <h4 className={styles.title}>
          {REMOVAL_LABELS.TARGETS_TITLE} (<span data-testid="removal-targets-count">{formatNumber(targets.length)}</span>)
        </h4>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            onClick={handleCopy}
            onBlur={() => setIsCopied(false)}
          >
            {isCopied ? <Check size={14} /> : <Copy size={14} />}
            {isCopied ? REMOVAL_LABELS.TARGETS_COPIED_BUTTON : REMOVAL_LABELS.TARGETS_COPY_BUTTON}
          </button>
          <button type="button" className={styles.action} onClick={handleDownload}>
            <Download size={14} />
            {REMOVAL_LABELS.TARGETS_DOWNLOAD_BUTTON}
          </button>
        </div>
      </header>
      <textarea
        className={styles.list}
        aria-label={REMOVAL_LABELS.TARGETS_LIST_LABEL}
        readOnly
        spellCheck={false}
        value={targets.map((target) => `${target.urn}\t${target.fuente}`).join("\n")}
      />
    </section>
  );
};
