"use client";

import React from "react";
import { EjesAcceptButton } from "./EjesAcceptButton";
import { EjesAcceptToolbar } from "./EjesAcceptToolbar";
import { acceptCapReachedBy, type EjesAcceptChange, type EjesAcceptList, type EjesAcceptView } from "./ejesAccept";
import { EJES_ACCEPT_TEXT } from "./ejesAcceptTexts";
import { RowsTable, type TableColumn } from "../shared/ReportParts";

export interface EjesAcceptableRowsProps<Row> {
  list: EjesAcceptList;
  rows: Row[];
  /** Every row the analysis counted for this list, listed or not. */
  total: number;
  columns: TableColumn<Row>[];
  rowKey: (row: Row) => string;
  onShowOnMap?: (row: Row) => void;
  /** A row that cannot be accepted (no key to send) is shown without its button and never sent. */
  acceptable?: (row: Row) => boolean;
  /** The text a row shows instead of its button when it is not acceptable. */
  notAcceptableText?: string;
  /** The text of one row that cannot be accepted, when it differs from the others; wins over `notAcceptableText`. */
  notAcceptableTextOf?: (row: Row) => string;
  /** Takes over a row's toggle (a split is accepted through its own rule); absent, the change goes straight to the accept state. */
  onToggleRow?: (row: Row, accepted: boolean) => void;
  accept: EjesAcceptView;
}

const ALWAYS_ACCEPTABLE = (): boolean => true;

/** A review list whose rows carry "Aceptar"; the accepted keys live in the wizard, so the list only reports the change. */
export function EjesAcceptableRows<Row>({
  list,
  rows,
  total,
  columns,
  rowKey,
  onShowOnMap,
  acceptable = ALWAYS_ACCEPTABLE,
  notAcceptableText = EJES_ACCEPT_TEXT.NOT_ACCEPTABLE,
  notAcceptableTextOf,
  onToggleRow,
  accept,
}: EjesAcceptableRowsProps<Row>) {
  const current = accept.keys[list];
  const accepted = new Set(current);
  const acceptableRows = rows.filter(acceptable);
  const listedKeys = acceptableRows.map(rowKey);
  const pendingKeys = listedKeys.filter((key) => !accepted.has(key));
  const acceptedKeys = listedKeys.filter((key) => accepted.has(key));
  const change = (keys: string[], isAccepted: boolean): EjesAcceptChange => ({ list, keys, accepted: isAccepted });
  const withAccept: TableColumn<Row>[] = [
    ...columns,
    {
      header: EJES_ACCEPT_TEXT.COLUMN,
      cell: (row) => {
        if (!acceptable(row)) return notAcceptableTextOf?.(row) ?? notAcceptableText;
        const key = rowKey(row);
        const isAccepted = accepted.has(key);
        const toggle = () => (onToggleRow === undefined ? accept.onChange(change([key], !isAccepted)) : onToggleRow(row, isAccepted));
        return <EjesAcceptButton accepted={isAccepted} onToggle={toggle} />;
      },
    },
  ];
  return (
    <>
      <EjesAcceptToolbar
        listed={rows.length}
        total={total}
        canAcceptAll={pendingKeys.length > 0}
        canRejectAll={acceptedKeys.length > 0}
        capped={acceptCapReachedBy(current, pendingKeys)}
        onAcceptAll={() => accept.onChange(change(listedKeys, true))}
        onRejectAll={() => accept.onChange(change(listedKeys, false))}
      />
      <RowsTable columns={withAccept} rows={rows} rowKey={rowKey} onShowOnMap={onShowOnMap} />
    </>
  );
}
