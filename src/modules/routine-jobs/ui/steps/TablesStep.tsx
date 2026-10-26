"use client";

import React, { useEffect, useEffectEvent, useState } from "react";
import type { ResolvedColumn, TableListing } from "@/core/types/tableCatalog";
import { AlertMessage } from "@/ui-kit/components/AlertMessage";
import { TableSelector } from "@/ui-kit/components/TableSelector";
import { FormField } from "@/ui-kit/components/ui/FormField";
import { AlertType, KeyboardKey } from "@/ui-kit/types/ui";
import { TABLE_ROLE, type TableRole } from "../../jobs/cargar-padrones/constants";
import { schemaCommitPlan } from "../schemaDraft";
import styles from "./WizardSteps.module.css";

const SCHEMA_LABEL = "Esquema";
const SCHEMA_HINT = "Escriba el esquema que contiene las tablas y después elija cada una.";
const CATALOG_ERROR_MESSAGE = "No se pudo consultar la base. Revise servidor, puerto, usuario y contraseña en el paso 1.";
const SCHEMA_COMMIT_DELAY_MS = 500;

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
  // react-doctor-disable-next-line react-doctor/no-derived-useState -- the draft starts from the committed schema once per visit to this step; committed changes reach the draft only through a new visit
  const [draft, setDraft] = useState(schema);
  const commitAfterPause = useEffectEvent((next: string) => onSchemaCommit(next));

  const commitDraft = () => {
    const plan = schemaCommitPlan(draft, committedSchema);
    if (plan.schema !== null) onSchemaCommit(plan.schema);
  };

  useEffect(() => {
    const next = schemaCommitPlan(draft, committedSchema).schema;
    if (next === null) return;
    const handle = setTimeout(() => commitAfterPause(next), SCHEMA_COMMIT_DELAY_MS);
    return () => clearTimeout(handle);
  }, [draft, committedSchema]);

  return (
    <div className={styles.stack}>
      <div className={styles.row}>
        <FormField
          label={SCHEMA_LABEL}
          value={draft}
          onChange={setDraft}
          onBlur={commitDraft}
          onKeyDown={(event) => {
            if (event.key === KeyboardKey.ENTER) commitDraft();
          }}
        />
      </div>
      <p className={styles.hint}>{SCHEMA_HINT}</p>

      <div className={styles.grid}>
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
