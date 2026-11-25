"use client";

import React from "react";
import { SelectField } from "@/ui-kit/components/ui/SelectField";
import type { EjesTwinPick, EjesTwinUndecidedRow } from "../../jobs/ejes-ide/types";
import { RowsTable, type TableColumn } from "../shared/ReportParts";
import { textOrNoData } from "../shared/reportFormat";
import { twinPickOf, type EjesTwinPickChange } from "./ejesAccept";
import { EJES_TWIN_PICK_TEXT } from "./ejesTwinPickTexts";
import { copyChangeOf, copyOptionsOf, selectedCopyValueOf } from "./ejesTwinPickView";
import acceptStyles from "./EjesAccept.module.css";
import styles from "./TwinUndecidedSection.module.css";

export interface TwinUndecidedSectionProps {
  rows: EjesTwinUndecidedRow[];
  picks: readonly EjesTwinPick[];
  onChange: (change: EjesTwinPickChange) => void;
  /** Adds the "Ver en mapa" button to each row when given. */
  onShowOnMap?: (row: EjesTwinUndecidedRow) => void;
}

interface TwinCopyCellProps {
  row: EjesTwinUndecidedRow;
  pick: EjesTwinPick | undefined;
  onChange: (change: EjesTwinPickChange) => void;
}

const TwinCopyCell: React.FC<TwinCopyCellProps> = ({ row, pick, onChange }) => (
  <div className={styles.copyCell}>
    <SelectField
      label={EJES_TWIN_PICK_TEXT.COLUMN_COPY}
      value={selectedCopyValueOf(row.copies, pick)}
      options={copyOptionsOf(row.copies)}
      onChange={(value) => onChange({ ref: row.ref, copy: copyChangeOf(row.copies, value) })}
    />
  </div>
);

const columnsOf = (picks: readonly EjesTwinPick[], onChange: (change: EjesTwinPickChange) => void): TableColumn<EjesTwinUndecidedRow>[] => [
  { header: EJES_TWIN_PICK_TEXT.COLUMN_REF, cell: (row) => row.ref },
  { header: EJES_TWIN_PICK_TEXT.COLUMN_ID, cell: (row) => textOrNoData(row.idcalle) },
  { header: EJES_TWIN_PICK_TEXT.COLUMN_NAME, cell: (row) => textOrNoData(row.name) },
  { header: EJES_TWIN_PICK_TEXT.COLUMN_POINTS, cell: (row) => String(row.points) },
  { header: EJES_TWIN_PICK_TEXT.COLUMN_WAITING, cell: (row) => String(row.waiting) },
  {
    header: EJES_TWIN_PICK_TEXT.COLUMN_COPY,
    cell: (row) => <TwinCopyCell row={row} pick={twinPickOf(picks, row.ref)} onChange={onChange} />,
  },
];

export const TwinUndecidedSection: React.FC<TwinUndecidedSectionProps> = ({ rows, picks, onChange, onShowOnMap }) => (
  <>
    <p className={acceptStyles.note}>{EJES_TWIN_PICK_TEXT.LIST_HELP}</p>
    <RowsTable columns={columnsOf(picks, onChange)} rows={rows} rowKey={(row) => row.ref} onShowOnMap={onShowOnMap} />
  </>
);
