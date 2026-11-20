"use client";

import React from "react";
import { X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { EjesManualSplit, EjesManualSplitIgnored } from "../../../jobs/ejes-calles/types";
import { RowsTable, SectionTitle, type TableColumn } from "../../shared/ReportParts";
import sharedStyles from "../../shared/ReportShared.module.css";
import { manualSplitsCapReached } from "../ejesAccept";
import acceptStyles from "../EjesAccept.module.css";
import { EJES_MANUAL_SPLIT_TEXT, MANUAL_SPLIT_IGNORED_TEXT, manualAppliedTextOf } from "../ejesAcceptTexts";

const ICON_SIZE = 15;

export interface ManualSplitsPanelProps {
  splits: readonly EjesManualSplit[];
  /** The manual splits the last analysis applied. */
  applied: number;
  /** The manual splits the last analysis ignored, with the reason. */
  ignored: readonly EjesManualSplitIgnored[];
  onRemove: (oldRef: string) => void;
}

const stateTextOf = (ignored: readonly EjesManualSplitIgnored[], oldRef: string): string => {
  const found = ignored.find((entry) => entry.oldRef === oldRef);
  return found === undefined ? "" : MANUAL_SPLIT_IGNORED_TEXT[found.reason];
};

const columnsOf = (ignored: readonly EjesManualSplitIgnored[], onRemove: (oldRef: string) => void): TableColumn<EjesManualSplit>[] => [
  { header: EJES_MANUAL_SPLIT_TEXT.PANEL_COLUMN_OLD, cell: (split) => split.oldRef },
  { header: EJES_MANUAL_SPLIT_TEXT.PANEL_COLUMN_PIECES, cell: (split) => split.newRefs.join(", ") },
  { header: EJES_MANUAL_SPLIT_TEXT.PANEL_COLUMN_STATE, cell: (split) => stateTextOf(ignored, split.oldRef) },
  {
    header: EJES_MANUAL_SPLIT_TEXT.PANEL_COLUMN_ACTION,
    cell: (split) => (
      <Button variant={ButtonVariant.SECONDARY} onClick={() => onRemove(split.oldRef)}>
        <X size={ICON_SIZE} />
        <span>{EJES_MANUAL_SPLIT_TEXT.REMOVE}</span>
      </Button>
    ),
  },
];

/** The manual splits the user chose on the map: each old section with its new sections, and what the last analysis made of it. */
export const ManualSplitsPanel: React.FC<ManualSplitsPanelProps> = ({ splits, applied, ignored, onRemove }) => (
  <section className={sharedStyles.section}>
    <SectionTitle>{EJES_MANUAL_SPLIT_TEXT.PANEL_TITLE}</SectionTitle>
    <div className={acceptStyles.toolbar}>
      <span className={acceptStyles.badge}>{manualAppliedTextOf(applied)}</span>
    </div>
    {splits.length === 0 ? (
      <p className={sharedStyles.hint}>{EJES_MANUAL_SPLIT_TEXT.PANEL_EMPTY}</p>
    ) : (
      <RowsTable columns={columnsOf(ignored, onRemove)} rows={[...splits]} rowKey={(split) => split.oldRef} />
    )}
    {manualSplitsCapReached(splits) && <p className={acceptStyles.note}>{EJES_MANUAL_SPLIT_TEXT.PANEL_CAP_NOTE}</p>}
  </section>
);
