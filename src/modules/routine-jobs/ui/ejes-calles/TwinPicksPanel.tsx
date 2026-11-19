"use client";

import React from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/ui-kit/components/ui/Button";
import { ButtonVariant } from "@/ui-kit/types/ui";
import type { EjesTwinPick } from "../../jobs/ejes-calles/types";
import { RowsTable, SectionTitle, type TableColumn } from "../shared/ReportParts";
import sharedStyles from "../shared/ReportShared.module.css";
import { twinPicksCapReached } from "./ejesAccept";
import acceptStyles from "./EjesAccept.module.css";
import { appliedTextOf, EJES_TWIN_PICK_TEXT } from "./ejesTwinPickTexts";
import { copyLabelOf } from "./ejesTwinPickView";

const ICON_SIZE = 15;

export interface TwinPicksPanelProps {
  picks: readonly EjesTwinPick[];
  applied: number;
  canAnalyze: boolean;
  onAnalyze: () => void;
  onRemove: (ref: string) => void;
}

const columnsOf = (onRemove: (ref: string) => void): TableColumn<EjesTwinPick>[] => [
  { header: EJES_TWIN_PICK_TEXT.COLUMN_REF, cell: (pick) => pick.ref },
  { header: EJES_TWIN_PICK_TEXT.PICK_COLUMN_CHOSEN, cell: (pick) => copyLabelOf(pick) },
  {
    header: EJES_TWIN_PICK_TEXT.PICK_COLUMN_ACTION,
    cell: (pick) => (
      <Button variant={ButtonVariant.SECONDARY} onClick={() => onRemove(pick.ref)}>
        <X size={ICON_SIZE} />
        <span>{EJES_TWIN_PICK_TEXT.REMOVE}</span>
      </Button>
    ),
  },
];

export const TwinPicksPanel: React.FC<TwinPicksPanelProps> = ({ picks, applied, canAnalyze, onAnalyze, onRemove }) => (
  <section className={sharedStyles.section}>
    <SectionTitle>{EJES_TWIN_PICK_TEXT.PICKS_TITLE}</SectionTitle>
    <div className={acceptStyles.toolbar}>
      <span className={acceptStyles.badge}>{appliedTextOf(applied)}</span>
      <div className={acceptStyles.actions}>
        <Button onClick={onAnalyze} disabled={!canAnalyze}>
          <RefreshCw size={ICON_SIZE} />
          <span>{EJES_TWIN_PICK_TEXT.ANALYZE}</span>
        </Button>
      </div>
    </div>
    {picks.length === 0 ? (
      <p className={sharedStyles.hint}>{EJES_TWIN_PICK_TEXT.PICKS_EMPTY}</p>
    ) : (
      <RowsTable columns={columnsOf(onRemove)} rows={[...picks]} rowKey={(pick) => pick.ref} />
    )}
    {twinPicksCapReached(picks) && <p className={acceptStyles.note}>{EJES_TWIN_PICK_TEXT.CAP_NOTE}</p>}
  </section>
);
