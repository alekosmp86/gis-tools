"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import {
  columnRows,
  describeListing,
  isCurrentAnswer,
  isSelectionValid,
  shouldShowListError,
  type ColumnRow,
  type SelectorLoadState,
  type TableOption,
} from "./tableSelectorLogic";
import styles from "./TableSelector.module.css";

const PLACEHOLDER_LABEL = "Elija una tabla";
const CHECKING_COLUMNS_MESSAGE = "Comprobando columnas...";
const CHECK_FAILED_MESSAGE = "No se pudieron comprobar las columnas de la tabla.";
const LOAD_FAILED_MESSAGE = "No se pudieron listar las tablas.";

type ListAnswer = { schema: string; listing: TableListing } | { schema: string; error: string };
type ColumnAnswer = { table: string; columns: ResolvedColumn[] } | { table: string; error: string };

export interface TableSelectorProps {
  label: string;
  schema: string;
  value: string;
  onChange: (table: string) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (table: string) => Promise<ResolvedColumn[]>;
  disabled?: boolean;
  excludedTables?: readonly string[];
  onValidityChange?: (valid: boolean, columns: ResolvedColumn[]) => void;
  onLoadError?: (error: unknown) => void;
  hideListError?: boolean;
}

const messageOf = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim() !== "" ? error.message : fallback;

function listStateOf(schema: string, answer: ListAnswer | null): SelectorLoadState {
  if (schema.trim() === "") return { phase: "idle" };
  if (!answer || !isCurrentAnswer(answer.schema, schema)) return { phase: "loading", schema };
  return "error" in answer
    ? { phase: "error", error: answer.error }
    : { phase: "ready", schema, listing: answer.listing };
}

function withCurrentValue(options: TableOption[], value: string, excludedTables: readonly string[]): TableOption[] {
  if (value === "" || options.some((option) => option.name === value)) return options;
  return [{ name: value, label: value, disabled: excludedTables.includes(value) }, ...options];
}

export const TableSelector: React.FC<TableSelectorProps> = ({
  label,
  schema,
  value,
  onChange,
  loadTables,
  checkColumns,
  disabled = false,
  excludedTables = [],
  onValidityChange,
  onLoadError,
  hideListError,
}) => {
  const selectId = useId();
  const [listAnswer, setListAnswer] = useState<ListAnswer | null>(null);
  const [columnAnswer, setColumnAnswer] = useState<ColumnAnswer | null>(null);
  const handlers = useRef({ loadTables, checkColumns, onValidityChange, onLoadError });

  useEffect(() => {
    handlers.current = { loadTables, checkColumns, onValidityChange, onLoadError };
  });

  useEffect(() => {
    if (schema.trim() === "") return;
    let active = true;
    handlers.current.loadTables(schema).then(
      (listing) => {
        if (active) setListAnswer({ schema, listing });
      },
      (error: unknown) => {
        if (!active) return;
        setListAnswer({ schema, error: messageOf(error, LOAD_FAILED_MESSAGE) });
        handlers.current.onLoadError?.(error);
      },
    );
    return () => {
      active = false;
    };
  }, [schema]);

  useEffect(() => {
    if (value === "") {
      handlers.current.onValidityChange?.(false, []);
      return;
    }
    let active = true;
    handlers.current.checkColumns(value).then(
      (columns) => {
        if (!active) return;
        setColumnAnswer({ table: value, columns });
        handlers.current.onValidityChange?.(isSelectionValid(columns), columns);
      },
      (error: unknown) => {
        if (!active) return;
        setColumnAnswer({ table: value, error: messageOf(error, CHECK_FAILED_MESSAGE) });
        handlers.current.onValidityChange?.(false, []);
      },
    );
    return () => {
      active = false;
    };
  }, [value]);

  const listState = listStateOf(schema, listAnswer);
  const listView = describeListing(listState, excludedTables);
  const options = withCurrentValue(listView.options, value, excludedTables);
  const isListBlocking = listState.phase === "error" || listState.phase === "ready";
  const showListMessage = listState.phase === "error" ? shouldShowListError(listState.phase, hideListError) : true;

  return (
    <div className={styles.container}>
      <label className={styles.label} htmlFor={selectId}>
        {label}
      </label>
      <select
        id={selectId}
        className={styles.select}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{PLACEHOLDER_LABEL}</option>
        {options.map((option) => (
          <option key={option.name} value={option.name} disabled={option.disabled}>
            {option.label}
          </option>
        ))}
      </select>
      {listView.message !== null &&
        showListMessage &&
        (isListBlocking ? (
          <AlertMessage
            type={listState.phase === "error" ? AlertType.ERROR : AlertType.WARNING}
            text={listView.message}
          />
        ) : (
          <p className={styles.hint} role="status">
            {listView.message}
          </p>
        ))}
      {value !== "" && <ColumnCheck answer={columnAnswer} table={value} />}
    </div>
  );
};

function ColumnCheck({ answer, table }: { answer: ColumnAnswer | null; table: string }) {
  if (!answer || !isCurrentAnswer(answer.table, table)) {
    return (
      <p className={styles.hint} role="status">
        {CHECKING_COLUMNS_MESSAGE}
      </p>
    );
  }
  if ("error" in answer) return <AlertMessage type={AlertType.ERROR} text={answer.error} />;
  return <ColumnList rows={columnRows(answer.columns)} />;
}

function ColumnList({ rows }: { rows: ColumnRow[] }) {
  return (
    <ul className={styles.columns}>
      {rows.map((row) => (
        <li key={row.logical} className={styles.column}>
          <span className={styles.columnName}>{row.logical}</span>
          <span className={row.ok ? styles.badgeOk : styles.badgeBad}>{row.statusLabel}</span>
          <span className={styles.columnDetail}>{row.detail}</span>
        </li>
      ))}
    </ul>
  );
}
