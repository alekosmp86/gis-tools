"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import { SchemaTableCard } from "../SchemaTableCard";
import { SchemaDraftField } from "./SchemaDraftField";

const SCHEMA_LABEL = "Esquema";

export interface SlotTableCardProps<Role extends string> {
  role: Role;
  title: string;
  note: string;
  tableLabel: string;
  selectorKey?: string;
  schema: string;
  table: string;
  excluded: string[];
  hideListError: boolean;
  onSchemaChange: (schema: string) => void;
  onTableChange: (table: string, valid: boolean) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (role: Role, schema: string, table: string) => Promise<ResolvedColumn[]>;
}

export function SlotTableCard<Role extends string>({
  role,
  title,
  note,
  tableLabel,
  selectorKey,
  schema,
  table,
  excluded,
  hideListError,
  onSchemaChange,
  onTableChange,
  loadTables,
  checkColumns,
}: SlotTableCardProps<Role>) {
  return (
    <SchemaTableCard
      title={title}
      note={note}
      schema={<SchemaDraftField label={SCHEMA_LABEL} initial={schema} committed={schema} onCommit={onSchemaChange} />}
      table={
        <TableSelector
          key={selectorKey}
          label={tableLabel}
          schema={schema}
          value={table}
          onChange={(chosen) => onTableChange(chosen, false)}
          loadTables={loadTables}
          checkColumns={(chosen) => checkColumns(role, schema.trim(), chosen)}
          disabled={schema.trim() === ""}
          excludedTables={excluded}
          onValidityChange={(valid) => onTableChange(table, valid)}
          hideListError={hideListError}
          bare
        />
      }
    />
  );
}
