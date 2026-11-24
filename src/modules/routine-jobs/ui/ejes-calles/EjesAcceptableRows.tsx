"use client";

import React from "react";
import { EjesAcceptButton } from "./EjesAcceptButton";
import { EjesAcceptToolbar } from "./EjesAcceptToolbar";
import { acceptCapReachedBy, acceptedKeysOfList, type EjesAcceptChange, type EjesAcceptList, type EjesAcceptView } from "./ejesAccept";
import { EJES_ACCEPT_TEXT } from "./ejesAcceptTexts";
import { RowsTable, type TableColumn } from "../shared/ReportParts";

export interface EjesAcceptableRowsProps<Row> {
  list: EjesAcceptList;
  rows: Row[];
  /** Every row the analysis counted for this list, listed or not. */
  total: number;
  columns: TableColumn<Row>[];
  rowKey: (row: Row) => string;
  /** A row that cannot be accepted (no key to send) is shown without its button and never sent. */
  acceptable?: (row: Row) => boolean;
  /** The text a row shows instead of its button when it is not acceptable: one text, or one per row. */
  notAcceptableText?: string | ((row: Row) => string);
  /** A row whose button waits for the user (a name to choose): shown disabled while not accepted, and left out of the bulk actions. */
  toggleDisabled?: (row: Row) => boolean;
  /** Takes over a row's toggle (a split is accepted through its own rule); absent, the change goes straight to the accept state. */
  onToggleRow?: (row: Row, accepted: boolean) => void;
  accept: EjesAcceptView;
  /** Filters shown on the toolbar row, before the bulk actions. */
  filters?: React.ReactNode;
  /** The "N aceptados de M" counter on the toolbar row. */
  counterText?: string;
  /** Adds the "Ver en mapa" button to each row when given. */
  onShowOnMap?: (row: Row) => void;
}

const ALWAYS_ACCEPTABLE = (): boolean => true;
const NEVER_DISABLED = (): boolean => false;

const notAcceptableTextOf = <Row,>(text: string | ((row: Row) => string), row: Row): string =>
  typeof text === "string" ? text : text(row);

/** A review list whose rows carry "Aceptar"; the accepted keys live in the wizard, so the list only reports the change. */
export function EjesAcceptableRows<Row>({
  list,
  rows,
  total,
  columns,
  rowKey,
  acceptable = ALWAYS_ACCEPTABLE,
  notAcceptableText = EJES_ACCEPT_TEXT.NOT_ACCEPTABLE,
  toggleDisabled = NEVER_DISABLED,
  onToggleRow,
  accept,
  filters,
  counterText,
  onShowOnMap,
}: EjesAcceptableRowsProps<Row>) {
  const current = acceptedKeysOfList(accept.keys, list);
  const accepted = new Set(current);
  const bulkRows = rows.filter((row) => acceptable(row) && !toggleDisabled(row));
  const listedKeys = bulkRows.map(rowKey);
  const pendingKeys = listedKeys.filter((key) => !accepted.has(key));
  const acceptedKeys = listedKeys.filter((key) => accepted.has(key));
  const change = (keys: string[], isAccepted: boolean): EjesAcceptChange => ({ list, keys, accepted: isAccepted });
  const withAccept: TableColumn<Row>[] = [
    ...columns,
    {
      header: EJES_ACCEPT_TEXT.COLUMN,
      cell: (row) => {
        if (!acceptable(row)) return notAcceptableTextOf(notAcceptableText, row);
        const key = rowKey(row);
        const isAccepted = accepted.has(key);
        const toggle = () => (onToggleRow === undefined ? accept.onChange(change([key], !isAccepted)) : onToggleRow(row, isAccepted));
        return <EjesAcceptButton accepted={isAccepted} disabled={!isAccepted && toggleDisabled(row)} onToggle={toggle} />;
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
        filters={filters}
        counterText={counterText}
      />
      <RowsTable columns={withAccept} rows={rows} rowKey={rowKey} onShowOnMap={onShowOnMap} />
    </>
  );
}
