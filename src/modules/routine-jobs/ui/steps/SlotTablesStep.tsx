"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { AlertType } from "@/ui-kit/types/ui";
import { SchemaTableSection } from "../SchemaTableSection";
import { SlotTableCard } from "./SlotTableCard";
import styles from "./WizardSteps.module.css";

const CATALOG_ERROR_MESSAGE = "No se pudo consultar la base. Revise la conexión.";

export interface SlotCopy<Slot extends string, Role extends string> {
  key: Slot;
  role: Role;
  title: string;
  note: string;
  tableLabel: string;
}

export interface SlotDraft {
  schema: string;
  table: string;
}

export interface SlotTablesStepProps<Slot extends string, Role extends string> {
  copies: readonly SlotCopy<Slot, Role>[];
  slots: Record<Slot, SlotDraft>;
  excluded: Record<Slot, string[]>;
  onSchemaChange: (key: Slot, schema: string) => void;
  onTableChange: (key: Slot, table: string, valid: boolean) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (role: Role, schema: string, table: string) => Promise<ResolvedColumn[]>;
  blockingReason: string | null;
  catalogError: string | null;
}

export function SlotTablesStep<Slot extends string, Role extends string>({
  copies,
  slots,
  excluded,
  onSchemaChange,
  onTableChange,
  loadTables,
  checkColumns,
  blockingReason,
  catalogError,
}: SlotTablesStepProps<Slot, Role>) {
  return (
    <div className={styles.stack}>
      <SchemaTableSection>
        {copies.map((copy) => (
          <SlotTableCard
            key={copy.key}
            role={copy.role}
            title={copy.title}
            note={copy.note}
            tableLabel={copy.tableLabel}
            schema={slots[copy.key].schema}
            table={slots[copy.key].table}
            excluded={excluded[copy.key]}
            hideListError={catalogError !== null}
            onSchemaChange={(schema) => onSchemaChange(copy.key, schema)}
            onTableChange={(table, valid) => onTableChange(copy.key, table, valid)}
            loadTables={loadTables}
            checkColumns={checkColumns}
          />
        ))}
      </SchemaTableSection>
      {catalogError !== null && (
        <div role="alert">
          <AlertMessage type={AlertType.ERROR} text={`${CATALOG_ERROR_MESSAGE} ${catalogError}`} />
        </div>
      )}
      {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
    </div>
  );
}
