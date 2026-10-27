"use client";

import React from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import { AlertType } from "@/ui-kit/types/ui";
import { TABLE_ROLE, type TableRole } from "../../jobs/cargar-padrones/constants";
import { SchemaDraftField } from "./SchemaDraftField";
import styles from "./WizardSteps.module.css";

const SCHEMA_LABEL = "Esquema";
const SCHEMA_HINT = "Escriba el esquema que contiene las tablas y después elija cada una.";
const CATALOG_ERROR_MESSAGE = "No se pudo consultar la base. Revise servidor, puerto, usuario y contraseña en el paso 1.";

const SELECTORS: ReadonlyArray<{ role: TableRole; label: string }> = [
  { role: TABLE_ROLE.RURAL, label: "Tabla rural" },
  { role: TABLE_ROLE.URBANO, label: "Tabla urbana" },
  { role: TABLE_ROLE.TARGET, label: "Tabla destino" },
];

const isBlank = (value: string): boolean => value.trim() === "";

export interface TablesStepProps {
  /** Starting value of the schema draft; the field then keeps its own draft. */
  schema: string;
  committedSchema: string;
  tables: Record<TableRole, string>;
  excluded: Record<TableRole, string[]>;
  onSchemaCommit: (schema: string) => void;
  onTableChange: (role: TableRole, table: string, valid: boolean) => void;
  loadTables: (schema: string) => Promise<TableListing>;
  checkColumns: (role: TableRole, table: string) => Promise<ResolvedColumn[]>;
  blockingReason: string | null;
  catalogError: string | null;
  onLoadError?: (error: unknown) => void;
}

export const TablesStep: React.FC<TablesStepProps> = ({
  schema,
  committedSchema,
  tables,
  excluded,
  onSchemaCommit,
  onTableChange,
  loadTables,
  checkColumns,
  blockingReason,
  catalogError,
  onLoadError,
}) => {
  return (
    <div className={styles.stack}>
      <div className={styles.schemaBlock}>
        <SchemaDraftField label={SCHEMA_LABEL} initial={schema} committed={committedSchema} onCommit={onSchemaCommit} />
        <p className={styles.schemaHint}>{SCHEMA_HINT}</p>
      </div>

      <div className={styles.tablesGrid}>
        {SELECTORS.map(({ role, label }) => (
          <TableSelector
            key={role}
            label={label}
            schema={committedSchema}
            value={tables[role]}
            onChange={(table) => onTableChange(role, table, false)}
            loadTables={loadTables}
            checkColumns={(table) => checkColumns(role, table)}
            disabled={isBlank(committedSchema)}
            excludedTables={excluded[role]}
            onValidityChange={(valid) => onTableChange(role, tables[role], valid)}
            onLoadError={onLoadError}
            hideListError={catalogError !== null}
          />
        ))}
      </div>

      {catalogError !== null && (
        <div role="alert">
          <AlertMessage type={AlertType.ERROR} text={`${CATALOG_ERROR_MESSAGE} ${catalogError}`} />
        </div>
      )}
      {blockingReason !== null && <AlertMessage type={AlertType.WARNING} text={blockingReason} />}
    </div>
  );
};
